"""Rapport fiscal de bout en bout — vraies factures, vrais virements, vraie base.

Les autres suites remplacent les deux sources de données par des doubles. Utile pour isoler la
logique, mais aveugle à ce qui compte ici : les documents réellement écrits par l'agent de
facturation et par l'agent capture ont-ils la forme que le rapprochement attend ?

Ce fichier ne remplace donc RIEN d'autre que MongoDB : les factures passent par
`facture.generator` + `facture.store`, les virements ont la forme produite par l'agent capture.
Un renommage de champ chez l'un des deux agents doit casser ici, et nulle part ailleurs.
"""

from __future__ import annotations

from datetime import date

import mongomock
import pytest

from app.agents.facture import generator, store as facture_store
from app.agents.facture.schemas import ClientFacture, FactureRequest, LigneFacture
from app.agents.rapport_fiscal import orchestrateur as O
from app.agents.rapport_fiscal.pdf import rapport_to_pdf
from app.agents.rapport_fiscal.schemas import ContexteFiscalRapport, DemandeRapport
from app.schemas.orchestrator import UserProfile

UID = "u1"


@pytest.fixture(autouse=True)
def mongo(monkeypatch):
    """Base isolée. `store` et `orchestrateur` importent `get_db` chacun de leur côté :
    le nom est lié dans leur propre module, c'est donc là qu'il faut patcher."""
    client = mongomock.MongoClient()
    db = client["testdb"]
    monkeypatch.setattr(facture_store, "get_db", lambda: db)
    monkeypatch.setattr(facture_store, "_initialized", False)
    monkeypatch.setattr(O, "get_db", lambda: db)
    return db


def _profil() -> UserProfile:
    return UserProfile(
        siren="812345678", denomination="Studio Nova",
        registry_address="14 rue des Lilas, 69003 Lyon",
        is_entrepreneur_individuel=True, recommended_regime="micro-BNC",
    )


def _emettre(numero: str, montant: float, categorie: str = "prestation"):
    """Émet une vraie facture par le générateur, puis l'enregistre par le vrai store."""
    requete = FactureRequest(
        client=ClientFacture(nom="Client SARL", est_professionnel=True,
                             adresse="8 quai Perrache, Lyon", siret="90123456700012"),
        lignes=[LigneFacture(designation="Prestation", quantite=1,
                             prix_unitaire_ht=montant, categorie=categorie)],
    )
    facture = generator.generer_facture(UID, numero, _profil(), requete)
    facture_store.enregistrer(facture)
    return facture


def _encaisser(db, doc_id: str, montant: float, motif: str, date_iso: str, direction="recu"):
    """Insère un virement dans la forme produite par l'agent capture."""
    db["virements"].insert_one({
        "user_id": UID,
        "document_id": doc_id,
        "transfer": {
            "amount": montant, "currency": "EUR", "direction": direction,
            "execution_date": date_iso, "value_date": date_iso,
            "motif": motif, "transfer_reference": None, "sender_name": "Client SARL",
        },
    })


def _rapport(contexte=None):
    return O.generer(UID, DemandeRapport(
        date_debut="2026-01-01", date_fin="2026-12-31",
        contexte=contexte or ContexteFiscalRapport(),
    ))


# -- Le chemin réel ----------------------------------------------------------
def test_une_facture_reelle_payee_entre_dans_le_ca(mongo):
    facture = _emettre("FA-2026-000001", 1000.0)
    _encaisser(mongo, "v1", facture.net_a_payer, f"Virement {facture.numero}", "2026-03-15")

    rapport = _rapport()
    assert rapport.ca_retenu == facture.net_a_payer
    assert rapport.rapprochement.ca_encaisse_certain == facture.net_a_payer
    assert rapport.rapprochement.encaissements[0].facture_numero == facture.numero


def test_le_numero_produit_par_le_generateur_est_reconnu_par_le_rapprochement(mongo):
    """Le format des numéros est un contrat entre deux agents : s'il change, ceci casse."""
    facture = _emettre("FA-2026-000042", 750.0)
    _encaisser(mongo, "v1", facture.net_a_payer, f"paiement {facture.numero} merci", "2026-04-01")

    rapport = _rapport()
    assert rapport.rapprochement.encaissements[0].methode == "numero_facture"


def test_un_brouillon_ne_reclame_aucun_encaissement(mongo):
    """Un brouillon n'a pas d'existence fiscale : il ne doit pas apparaître en impayé."""
    facture_store.enregistrer(generator.construire_document(UID, _profil(), FactureRequest(
        client=ClientFacture(nom="Client SARL", est_professionnel=True),
        lignes=[LigneFacture(designation="x", quantite=1, prix_unitaire_ht=5000.0)],
    )))
    rapport = _rapport()
    assert rapport.ca_retenu == 0.0
    assert rapport.rapprochement.factures_impayees == []


def test_une_facture_emise_non_payee_ressort_en_impayee(mongo):
    facture = _emettre("FA-2026-000001", 2000.0)
    rapport = _rapport()

    assert rapport.ca_retenu == 0.0, "émise n'est pas encaissée"
    impayee = rapport.rapprochement.factures_impayees[0]
    assert impayee.numero == facture.numero
    assert impayee.reste_du == facture.net_a_payer


def test_un_virement_sortant_reel_n_entre_pas_dans_le_ca(mongo):
    facture = _emettre("FA-2026-000001", 900.0)
    _encaisser(mongo, "v1", facture.net_a_payer, f"{facture.numero}", "2026-03-15",
               direction="emis")

    rapport = _rapport()
    assert rapport.ca_retenu == 0.0
    assert len(rapport.rapprochement.virements_non_retenus) == 1


def test_les_virements_d_un_autre_utilisateur_sont_invisibles(mongo):
    """Cloisonnement : un CA qui fuit d'un compte à l'autre serait une faute grave."""
    facture = _emettre("FA-2026-000001", 1000.0)
    mongo["virements"].insert_one({
        "user_id": "quelqu-un-d-autre", "document_id": "vX",
        "transfer": {"amount": facture.net_a_payer, "direction": "recu",
                     "execution_date": "2026-03-15", "motif": facture.numero},
    })
    assert _rapport().ca_retenu == 0.0


def test_activite_mixte_de_bout_en_bout(mongo):
    vente = _emettre("FA-2026-000001", 20000.0, categorie="vente")
    presta = _emettre("FA-2026-000002", 10000.0, categorie="prestation")
    _encaisser(mongo, "v1", vente.net_a_payer, vente.numero, "2026-02-01")
    _encaisser(mongo, "v2", presta.net_a_payer, presta.numero, "2026-05-01")

    rapport = _rapport()
    assert {l["categorie"] for l in rapport.simulation["lignes"]} == {"BIC_VENTE", "BNC"}


def test_le_facture_apparait_a_cote_de_l_encaisse(mongo):
    """Un seul rapport : le facturé est un indicateur, l'encaissé reste l'assiette."""
    _emettre("FA-2026-000001", 3000.0)
    rapport = _rapport()

    assert rapport.ca_retenu == 0.0, "emise mais non payee"
    assert rapport.ca_facture_periode == 3000.0
    assert rapport.rapprochement is not None


def test_le_pdf_se_rend_sur_des_donnees_reelles(mongo):
    facture = _emettre("FA-2026-000001", 4000.0)
    _encaisser(mongo, "v1", facture.net_a_payer, facture.numero, "2026-03-15")
    _encaisser(mongo, "v2", 500.0, "VIREMENT SANS REFERENCE", "2026-06-01")
    _emettre("FA-2026-000002", 1500.0)

    rapport = _rapport(contexte=ContexteFiscalRapport(parts_fiscales=1.0, autres_revenus=0.0))
    assert rapport_to_pdf(rapport)[:4] == b"%PDF"


def test_une_facture_reellement_assujettie_ne_gonfle_pas_le_ca_de_sa_tva(mongo):
    """Le piège : en franchise en base, HT == TTC, et l'erreur reste invisible.

    Ici la facture porte réellement 20 % de TVA. Le client vire le TTC, mais l'assiette du
    micro-fiscal et du micro-social est le HT — la TVA collectée n'a jamais été un revenu.
    """
    requete = FactureRequest(
        client=ClientFacture(nom="Client SARL", est_professionnel=True,
                             adresse="8 quai Perrache, Lyon", siret="90123456700012"),
        lignes=[LigneFacture(designation="Prestation", quantite=1,
                             prix_unitaire_ht=1000.0, taux_tva=0.20)],
    )
    facture = generator.construire_document(
        UID, _profil(), requete, numero="FA-2026-000001", statut="emise",
        date_emission=date(2026, 3, 1), en_franchise=False,
    )
    facture_store.enregistrer(facture)
    assert facture.total_ttc > facture.total_ht, "la facture porte bien de la TVA"

    _encaisser(mongo, "v1", facture.net_a_payer, facture.numero, "2026-03-15")
    rapport = _rapport()

    assert rapport.ca_retenu == facture.total_ht
    ligne = rapport.rapprochement.encaissements[0]
    assert ligne.montant == facture.total_ttc, "le relevé bancaire montre le TTC"
    assert rapport.rapprochement.factures_impayees == [], "elle est pourtant soldée"


def test_sans_aucune_donnee_le_rapport_se_produit_quand_meme(mongo):
    rapport = _rapport()
    assert rapport.ca_retenu == 0.0
    # Zéro est un résultat : le moteur tourne et renvoie des montants nuls.
    assert rapport.simulation["cotisations_sociales"] == 0.0
    assert rapport_to_pdf(rapport)[:4] == b"%PDF"
