"""Les cadeaux reçus en contrepartie d'un service sont du CHIFFRE D'AFFAIRES.

Fiscalement ce ne sont pas des cadeaux : un partenariat rémunéré en produits est un revenu en
nature, déclarable à sa valeur marchande. Il entre au livre des recettes comme un
encaissement — alors qu'aucun euro n'a transité par le compte bancaire.

Ce que ces tests protègent, dans le rapport fiscal ET dans les déclarations :

  • un cadeau valorisé **augmente** l'assiette, donc les cotisations et l'impôt ;
  • il **ne passe pas** par le rapprochement bancaire — il n'y a aucun virement à rapprocher ;
  • il relève de la **prestation**, jamais de la vente : le créateur n'a rien vendu ;
  • un cadeau **sans valeur retenue** n'est pas compté, mais n'est jamais tu — le taire
    minorerait la déclaration en silence ;
  • une **estimation** issue d'une photo ne vaut pas déclaration : seule la valeur retenue
    par l'utilisateur compte.
"""

from __future__ import annotations

from typing import Any, Dict, List

import mongomock
import pytest

from app.agents.declarations import generateur as D
from app.agents.declarations import sources as pieces_decl
from app.agents.declarations.schemas import ContexteDeclaratif, DemandeDeclarations
from app.agents.rapport_fiscal import orchestrateur as O
from app.agents.rapport_fiscal import sources
from app.agents.rapport_fiscal.schemas import ContexteFiscalRapport, DemandeRapport

UID = "u1"
_FACTURES: List[Dict[str, Any]] = []


@pytest.fixture(autouse=True)
def base(monkeypatch):
    client = mongomock.MongoClient()
    db = client["testdb"]
    _FACTURES.clear()
    for module in (O, sources, pieces_decl):
        monkeypatch.setattr(module, "get_db", lambda: db)
    monkeypatch.setattr(O, "_factures_avec_existence_fiscale", lambda uid: _FACTURES)
    monkeypatch.setattr(D.facture_store, "lister_emises", lambda uid: _FACTURES)
    monkeypatch.setattr(D.pieces, "virements", lambda uid: list(db["virements"].find({}, {"_id": 0})))
    yield db


def _cadeau(db, doc_id: str, valeur: float | None, date_iso: str = "2026-08-10",
            marque: str = "Marque SA", **extra):
    cadeau = {
        "description": "Sac en cuir", "marque": marque, "date_reception": date_iso,
        "valeur_ttc": valeur, "devise": "EUR", "valeur_eur": valeur,
        "contrepartie": "1 post + 2 stories",
    }
    cadeau.update(extra)
    db["cadeaux"].insert_one({"user_id": UID, "document_id": doc_id, "cadeau": cadeau})


def _facture(numero: str, net: float, categorie: str = "prestation"):
    _FACTURES.append({
        "id": f"id-{numero}", "numero": numero, "net_a_payer": net,
        "total_ht": net, "total_ttc": net, "date_emission": "2026-08-01",
        "date_echeance": "2026-08-31", "client": {"nom": "Client"},
        "lignes": [{"designation": "x", "quantite": 1, "prix_unitaire_ht": net,
                    "categorie": categorie}],
    })


def _virement(db, doc_id: str, montant: float, motif: str):
    db["virements"].insert_one({
        "user_id": UID, "document_id": doc_id,
        "transfer": {"amount": montant, "amount_eur": montant, "direction": "recu",
                     "execution_date": "2026-08-10", "motif": motif,
                     "sender_name": "Client"},
    })


def _rapport(contexte=None, debut="2026-08-01", fin="2026-08-31"):
    return O.generer(UID, DemandeRapport(
        date_debut=debut, date_fin=fin, contexte=contexte or ContexteFiscalRapport(),
    ))


def _declarations(contexte=None, debut="2026-08-01", fin="2026-08-31"):
    return D.generer_declarations(UID, DemandeDeclarations(
        date_debut=debut, date_fin=fin,
        contexte=contexte or ContexteDeclaratif(), enregistrer=False,
    ))


# -- Le cadeau entre dans l'assiette -----------------------------------------
def test_un_cadeau_valorise_augmente_le_chiffre_d_affaires(base):
    """Sans lui, le CA déclaré serait minoré du montant de l'avantage reçu."""
    _cadeau(base, "c1", 450.0)
    rapport = _rapport()

    assert rapport.ca_retenu == 450.0
    assert rapport.ca_avantages_en_nature == 450.0
    assert rapport.ca_encaisse_bancaire == 0.0


def test_le_cadeau_s_ajoute_aux_encaissements_bancaires(base):
    _facture("FA-2026-000001", 1000.0)
    _virement(base, "v1", 1000.0, "FA-2026-000001")
    _cadeau(base, "c1", 450.0)

    rapport = _rapport()
    assert rapport.ca_encaisse_bancaire == 1000.0
    assert rapport.ca_avantages_en_nature == 450.0
    assert rapport.ca_retenu == 1450.0


def test_le_cadeau_augmente_reellement_les_cotisations(base):
    """L'assiette sociale porte sur le CA plein : l'avantage en nature y entre."""
    _facture("FA-2026-000001", 1000.0)
    _virement(base, "v1", 1000.0, "FA-2026-000001")
    sans = _rapport().simulation["cotisations_sociales"]

    _cadeau(base, "c1", 1000.0)
    avec = _rapport().simulation["cotisations_sociales"]

    assert avec == pytest.approx(sans * 2, abs=0.01), "le CA a doublé, les cotisations aussi"


def test_le_cadeau_ne_passe_pas_par_le_rapprochement_bancaire(base):
    """Il n'y a aucun virement à rapprocher : l'y chercher le ferait disparaître."""
    _cadeau(base, "c1", 450.0)
    rapport = _rapport()

    assert rapport.rapprochement.ca_encaisse == 0.0, "rien à rapprocher"
    assert rapport.rapprochement.encaissements == []
    assert rapport.ca_retenu == 450.0, "et pourtant il compte"


def test_le_cadeau_releve_de_la_prestation_jamais_de_la_vente(base):
    """Le créateur n'a rien vendu : il a reçu un objet en paiement d'un service."""
    _cadeau(base, "c1", 450.0)
    rapport = _rapport(ContexteFiscalRapport(categorie_par_defaut="BNC"))

    assert rapport.rapprochement.ca_par_categorie.get("vente") is None
    assert [l["categorie"] for l in rapport.simulation["lignes"]] == ["BNC"]


# -- Les bornes de période et de valeur --------------------------------------
def test_un_cadeau_hors_periode_n_est_pas_compte(base):
    _cadeau(base, "c1", 450.0, date_iso="2026-03-15")
    assert _rapport().ca_retenu == 0.0


def test_un_cadeau_sans_valeur_n_est_pas_compte_mais_est_signale(base):
    """Le taire minorerait la déclaration sans que rien ne l'indique."""
    _cadeau(base, "c1", None, valeur_estimee=300.0)
    rapport = _rapport()

    assert rapport.ca_retenu == 0.0
    assert len(rapport.sources.cadeaux_a_valoriser) == 1
    alerte = next(a for a in rapport.alertes if "sans valeur retenue" in a.titre)
    assert alerte.niveau == "critique"
    assert "minore" in alerte.message


def test_une_estimation_seule_ne_vaut_pas_declaration(base):
    """Une photo ne donne jamais un prix certain : la déclarer engagerait à tort l'utilisateur."""
    _cadeau(base, "c1", None, valeur_estimee=1200.0, confiance="faible")
    assert _rapport().ca_retenu == 0.0


def test_un_cadeau_a_valeur_nulle_est_traite_comme_non_valorise(base):
    _cadeau(base, "c1", 0.0)
    rapport = _rapport()
    assert rapport.ca_retenu == 0.0
    assert len(rapport.sources.cadeaux_a_valoriser) == 1


def test_la_valeur_en_euros_prime_sur_la_devise_d_origine(base):
    """Un cadeau valorisé en devise doit être comparable aux autres recettes."""
    _cadeau(base, "c1", 500.0, devise="USD", valeur_eur=460.0)
    assert _rapport().ca_retenu == 460.0


def test_les_cadeaux_d_un_autre_utilisateur_sont_invisibles(base):
    base["cadeaux"].insert_one({
        "user_id": "quelqu-un-d-autre", "document_id": "cX",
        "cadeau": {"date_reception": "2026-08-10", "valeur_ttc": 9999.0,
                   "valeur_eur": 9999.0},
    })
    assert _rapport().ca_retenu == 0.0


# -- Traçabilité -------------------------------------------------------------
def test_le_rapport_expose_chaque_cadeau_retenu(base):
    _cadeau(base, "c1", 450.0, marque="Marque A")
    _cadeau(base, "c2", 120.0, marque="Marque B")

    src = _rapport().sources
    assert src.cadeaux_recus == 2
    assert src.total_cadeaux_eur == 570.0
    assert {c.marque for c in src.cadeaux} == {"Marque A", "Marque B"}
    assert all(c.contrepartie for c in src.cadeaux), "ce qui est attendu en échange est tracé"


def test_le_rapport_previent_que_ces_montants_sont_hors_banque(base):
    _cadeau(base, "c1", 450.0)
    alerte = next(a for a in _rapport().alertes if "avantages en nature" in a.titre)

    assert alerte.niveau == "vigilance"
    assert "AUCUN relevé bancaire" in alerte.message


def test_la_base_de_calcul_mentionne_les_avantages_en_nature(base):
    _cadeau(base, "c1", 450.0)
    assert "avantages en nature" in _rapport().base_de_calcul


def test_sans_cadeau_la_base_de_calcul_reste_inchangee(base):
    _facture("FA-2026-000001", 1000.0)
    _virement(base, "v1", 1000.0, "FA-2026-000001")
    base_texte = _rapport().base_de_calcul

    assert "avantages en nature" not in base_texte
    assert "CA ENCAISSÉ" in base_texte


# -- Les déclarations utilisent la MÊME assiette ------------------------------
def test_les_declarations_comptent_aussi_les_cadeaux(base):
    """Deux assiettes différentes entre rapport et déclaration seraient incohérentes."""
    _facture("FA-2026-000001", 1000.0)
    _virement(base, "v1", 1000.0, "FA-2026-000001")
    _cadeau(base, "c1", 450.0)

    jeu = _declarations()
    assert jeu.ca_encaisse == 1450.0
    assert jeu.total_cadeaux_eur == 450.0
    assert _rapport().ca_retenu == jeu.ca_encaisse, "une seule assiette, deux écrans"


def test_le_cadeau_apparait_dans_la_case_urssaf_des_prestations(base):
    _cadeau(base, "c1", 450.0)
    jeu = _declarations(ContexteDeclaratif(categorie_par_defaut="BNC"))
    urssaf = next(b for b in jeu.brouillons if b.type == "ca_urssaf")
    lignes = [c for c in urssaf.champs if c.libelle.startswith("Chiffre d'affaires")]

    # vente, BIC services, BNC — l'avantage en nature va sur la ligne des prestations.
    assert [c.valeur for c in lignes] == [0.0, 0.0, 450.0]


def test_le_cadeau_entre_dans_la_case_de_la_declaration_de_revenus(base):
    _cadeau(base, "c1", 450.0)
    jeu = _declarations(ContexteDeclaratif(categorie_par_defaut="BNC"))
    revenus = next(b for b in jeu.brouillons if b.type == "revenus_2042")

    assert revenus.champs[0].case == "5HQ"
    assert revenus.champs[0].valeur == 450.0


def test_les_declarations_expliquent_la_part_en_nature(base):
    _cadeau(base, "c1", 450.0)
    explication = " ".join(_declarations().hypotheses)

    assert "avantages en nature" in explication
    assert "AUCUN relevé bancaire" in explication


def test_les_declarations_signalent_les_cadeaux_non_valorises(base):
    _cadeau(base, "c1", None)
    jeu = _declarations()

    assert len(jeu.cadeaux_a_valoriser) == 1
    assert "minoré" in " ".join(jeu.hypotheses)


def test_un_cadeau_seul_ne_fait_pas_croire_a_une_periode_vide(base):
    """Le message « aucun encaissement » ne doit pas s'afficher si un cadeau a été reçu."""
    _cadeau(base, "c1", 450.0)
    explication = " ".join(_declarations().hypotheses)

    assert "Aucun encaissement sur cette période" not in explication
