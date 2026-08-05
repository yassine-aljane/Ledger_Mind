"""Les cadeaux en nature entrent dans l'assiette — rapport fiscal ET brouillon de déclaration.

Un cadeau de marque rémunère une prestation déjà rendue : c'est une recette, pas un cadeau au
sens fiscal. Il ne transite par AUCUN compte bancaire, donc le rapprochement facture ↔ virement
ne peut pas le voir. S'il n'est pas ajouté explicitement, tout le reste est calculé sur une base
amputée : abattement, cotisations, CFP, impôt, plafond du régime et seuils de franchise de TVA.

Ce que cette suite protège :

  • le CA retenu du rapport fiscal comprend les avantages en nature, et le moteur d'impôt les
    reçoit — un même cadeau doit augmenter cotisations ET base imposable ;
  • ils comptent comme des PRESTATIONS : le créateur ne cède aucune marchandise, il est payé
    en biens pour un service. Les ranger en vente leur appliquerait l'abattement de 71 % ;
  • ils pèsent sur les seuils de franchise de TVA — c'est le cas où l'omission fait le plus de
    dégâts : croire le seuil loin alors qu'il est franchi ;
  • un cadeau non convertible en euros ou sans date n'est JAMAIS compté en silence : il est
    écarté et signalé, dans le rapport comme dans le brouillon de déclaration ;
  • la case 2042-C-PRO porte le montant BRUT, avantages compris, et garde la trace de ce qui
    vient d'une facture et de ce qui vient d'une dotation.
"""

from __future__ import annotations

from datetime import date

import mongomock
import pytest

from app.agents import cadeaux_fiscaux
from app.agents.declaration import store as declaration_store
from app.agents.declaration.generator import generer_declaration
from app.agents.declaration.pdf import declaration_to_pdf
from app.agents.facture import generator as facture_generator
from app.agents.facture import store as facture_store
from app.agents.facture.schemas import ClientFacture, FactureRequest, LigneFacture
from app.agents.rapport_fiscal import orchestrateur as O
from app.agents.rapport_fiscal.pdf import rapport_to_pdf
from app.agents.rapport_fiscal.schemas import ContexteFiscalRapport, DemandeRapport
from app.schemas.orchestrator import UserProfile

UID = "u-cadeaux"
DEBUT, FIN = date(2026, 1, 1), date(2026, 12, 31)


@pytest.fixture(autouse=True)
def mongo(monkeypatch):
    """Base isolée. Chaque module lie `get_db` dans son propre espace de noms."""
    client = mongomock.MongoClient()
    db = client["testdb"]
    monkeypatch.setattr(facture_store, "get_db", lambda: db)
    monkeypatch.setattr(facture_store, "_initialized", False)
    monkeypatch.setattr(declaration_store, "get_db", lambda: db)
    monkeypatch.setattr(cadeaux_fiscaux, "get_db", lambda: db)
    monkeypatch.setattr(O, "get_db", lambda: db)
    return db


def _profil() -> UserProfile:
    return UserProfile(
        siren="812345678", denomination="Studio Nova",
        registry_address="14 rue des Lilas, 69003 Lyon",
        is_entrepreneur_individuel=True, recommended_regime="micro-BNC",
    )


def _cadeau(db, *, valeur_eur=None, valeur_ttc=500.0, devise="EUR",
            date_reception="2026-03-12", description="sac", marque="Maison Ora",
            document_id="doc-cadeau-1"):
    db["cadeaux"].insert_one({
        "user_id": UID,
        "document_id": document_id,
        "document_type": "cadeau",
        "cadeau": {
            "description": description, "marque": marque,
            "date_reception": date_reception,
            "valeur_ttc": valeur_ttc, "devise": devise, "valeur_eur": valeur_eur,
            "contrepartie": "1 post + 2 stories",
        },
    })


def _facture_encaissee(db, numero: str, montant: float, categorie: str = "prestation"):
    """Une facture émise ET son virement, pour obtenir du CA réellement encaissé."""
    requete = FactureRequest(
        client=ClientFacture(nom="Client SARL", est_professionnel=True),
        lignes=[LigneFacture(designation="Prestation", quantite=1,
                             prix_unitaire_ht=montant, categorie=categorie)],
    )
    facture = facture_generator.generer_facture(UID, numero, _profil(), requete)
    facture_store.enregistrer(facture)
    db["virements"].insert_one({
        "document_id": f"v-{numero}",
        "user_id": UID,
        "transfer": {
            "amount": montant, "currency": "EUR", "direction": "recu",
            "execution_date": "2026-03-20", "motif": f"Paiement {numero}",
            "sender_name": "Client SARL",
        },
    })


def _rapport(**contexte):
    demande = DemandeRapport(
        date_debut=DEBUT.isoformat(), date_fin=FIN.isoformat(),
        contexte=ContexteFiscalRapport(**contexte), enregistrer=False,
    )
    return O.generer(UID, demande, _profil())


# -- Collecte ----------------------------------------------------------------
def test_un_cadeau_en_euros_est_retenu_a_sa_valeur(mongo):
    _cadeau(mongo, valeur_ttc=500.0, devise="EUR")
    collecte = cadeaux_fiscaux.collecter(UID, DEBUT, FIN)
    assert collecte.total_eur == pytest.approx(500.0)
    assert collecte.nb_retenus == 1
    assert not collecte.a_signaler


def test_une_devise_etrangere_sans_contre_valeur_est_ecartee_pas_assimilee(mongo):
    """300 USD ne valent pas 300 € : les compter à leur valeur faciale fausserait l'assiette."""
    _cadeau(mongo, valeur_ttc=300.0, devise="USD", valeur_eur=None)
    collecte = cadeaux_fiscaux.collecter(UID, DEBUT, FIN)
    assert collecte.total_eur == pytest.approx(0.0)
    assert len(collecte.non_convertis) == 1
    assert collecte.a_signaler


def test_une_devise_etrangere_convertie_entre_a_sa_contre_valeur(mongo):
    _cadeau(mongo, valeur_ttc=300.0, devise="USD", valeur_eur=276.5)
    collecte = cadeaux_fiscaux.collecter(UID, DEBUT, FIN)
    assert collecte.total_eur == pytest.approx(276.5)
    assert not collecte.non_convertis


def test_sans_date_de_reception_le_cadeau_n_est_rattache_a_aucune_periode(mongo):
    _cadeau(mongo, date_reception=None)
    collecte = cadeaux_fiscaux.collecter(UID, DEBUT, FIN)
    assert collecte.total_eur == pytest.approx(0.0)
    assert len(collecte.sans_date) == 1


def test_un_cadeau_hors_periode_n_est_ni_compte_ni_signale(mongo):
    """Il relève d'un autre exercice : ce n'est pas une pièce incomplète."""
    _cadeau(mongo, date_reception="2025-11-04")
    collecte = cadeaux_fiscaux.collecter(UID, DEBUT, FIN)
    assert collecte.total_eur == pytest.approx(0.0)
    assert not collecte.a_signaler


# -- Rapport fiscal : l'assiette ---------------------------------------------
def test_le_ca_retenu_comprend_les_avantages_en_nature(mongo):
    _facture_encaissee(mongo, "FA-2026-000001", 1000.0)
    _cadeau(mongo, valeur_ttc=500.0)

    rapport = _rapport()
    assert rapport.ca_encaisse_numeraire == pytest.approx(1000.0)
    assert rapport.recettes_en_nature == pytest.approx(500.0)
    assert rapport.ca_retenu == pytest.approx(1500.0)


def test_le_moteur_d_impot_recoit_bien_le_cadeau(mongo):
    """Cotisations et base imposable doivent bouger : sinon le cadeau n'a pas été transmis."""
    _facture_encaissee(mongo, "FA-2026-000001", 1000.0)
    sans = _rapport()
    _cadeau(mongo, valeur_ttc=500.0)
    avec = _rapport()

    assert avec.simulation["ca_total"] == pytest.approx(sans.simulation["ca_total"] + 500.0)
    assert avec.simulation["cotisations_sociales"] > sans.simulation["cotisations_sociales"]
    assert avec.simulation["base_imposable"] > sans.simulation["base_imposable"]


def test_un_cadeau_est_une_prestation_jamais_une_vente(mongo):
    """Le créateur ne cède aucune marchandise : il est rémunéré en biens pour un service."""
    _cadeau(mongo, valeur_ttc=500.0)
    rapport = _rapport()
    ventilation = rapport.rapprochement.ca_par_categorie
    assert "vente" not in ventilation
    # La nature « prestation » est bien celle qui porte le montant, côté seuils de TVA.
    natures = {ligne["nature"] for ligne in rapport.tva["lignes"] if ligne["ca"] > 0}
    assert natures == {"prestation"}


def test_les_cadeaux_pesent_sur_les_seuils_de_franchise_de_tva(mongo):
    """Le cas où l'omission coûte le plus cher : croire le seuil loin alors qu'il est franchi."""
    _facture_encaissee(mongo, "FA-2026-000001", 37_000.0)
    sans = _rapport()
    assert sans.tva["depasse_base"] is False

    _cadeau(mongo, valeur_ttc=2_000.0)
    avec = _rapport()
    assert avec.tva["depasse_base"] is True


def test_l_ecart_facture_encaisse_ignore_les_avantages_en_nature(mongo):
    """Un cadeau n'a jamais été facturé : le compter creuserait un écart sans impayé."""
    _facture_encaissee(mongo, "FA-2026-000001", 1000.0)
    _cadeau(mongo, valeur_ttc=500.0)
    rapport = _rapport()
    assert rapport.ca_facture_periode == pytest.approx(rapport.ca_encaisse_numeraire)


def test_le_rapport_dit_qu_il_a_compte_les_cadeaux(mongo):
    _cadeau(mongo, valeur_ttc=500.0)
    rapport = _rapport()
    assert rapport.sources.cadeaux_declares == 1
    assert rapport.sources.recettes_en_nature_eur == pytest.approx(500.0)
    assert any("nature" in a.titre.lower() for a in rapport.alertes)


def test_un_cadeau_ecarte_est_signale_dans_le_rapport(mongo):
    _cadeau(mongo, valeur_ttc=300.0, devise="USD", valeur_eur=None)
    rapport = _rapport()
    assert rapport.recettes_en_nature == pytest.approx(0.0)
    assert len(rapport.sources.cadeaux_ecartes) == 1
    assert any("non compté" in a.titre for a in rapport.alertes)


def test_le_pdf_du_rapport_se_genere_avec_des_cadeaux(mongo):
    _facture_encaissee(mongo, "FA-2026-000001", 1000.0)
    _cadeau(mongo, valeur_ttc=500.0)
    assert rapport_to_pdf(_rapport()).startswith(b"%PDF")


# -- Brouillon de déclaration 2042-C-PRO -------------------------------------
def test_la_case_5hq_comprend_les_avantages_en_nature(mongo):
    _facture_encaissee(mongo, "FA-2026-000001", 1000.0)
    _cadeau(mongo, valeur_ttc=500.0)

    declaration = generer_declaration(UID, DEBUT, FIN)
    case = next(l for l in declaration.lignes if l.case == "5HQ")
    assert case.montant == pytest.approx(1500.0)
    assert case.montant_facture == pytest.approx(1000.0)
    assert case.montant_nature == pytest.approx(500.0)
    assert case.cadeaux_ids == ["doc-cadeau-1"]
    assert declaration.total_ca_declare == pytest.approx(1500.0)
    assert declaration.total_recettes_nature == pytest.approx(500.0)


def test_un_createur_paye_uniquement_en_dotations_a_bien_une_case(mongo):
    """Sans facture, l'ancienne version ne produisait AUCUNE ligne : la recette disparaissait."""
    _cadeau(mongo, valeur_ttc=800.0)
    declaration = generer_declaration(UID, DEBUT, FIN)
    assert [l.case for l in declaration.lignes] == ["5HQ"]
    assert declaration.lignes[0].montant == pytest.approx(800.0)


def test_la_provenance_de_la_case_cite_le_cadeau(mongo):
    _facture_encaissee(mongo, "FA-2026-000001", 1000.0)
    _cadeau(mongo, valeur_ttc=500.0, description="sac", marque="Maison Ora")
    declaration = generer_declaration(UID, DEBUT, FIN)
    provenance = next(l for l in declaration.lignes if l.case == "5HQ").provenance
    assert "FA-2026-000001" in provenance
    assert "Maison Ora" in provenance


def test_les_cotisations_du_brouillon_portent_sur_le_ca_avantages_compris(mongo):
    _facture_encaissee(mongo, "FA-2026-000001", 1000.0)
    sans = generer_declaration(UID, DEBUT, FIN)
    _cadeau(mongo, valeur_ttc=500.0)
    avec = generer_declaration(UID, DEBUT, FIN)
    assert avec.cotisations_urssac_estimees > sans.cotisations_urssac_estimees


def test_le_brouillon_dit_ce_qu_il_ne_contient_pas(mongo):
    _facture_encaissee(mongo, "FA-2026-000001", 1000.0)
    _cadeau(mongo, valeur_ttc=300.0, devise="USD", valeur_eur=None, marque="Brand X")
    declaration = generer_declaration(UID, DEBUT, FIN)
    assert declaration.total_recettes_nature == pytest.approx(0.0)
    assert len(declaration.cadeaux_ecartes) == 1
    assert "Brand X" in declaration.cadeaux_ecartes[0]


def test_le_pdf_de_la_declaration_se_genere_avec_des_cadeaux(mongo):
    _facture_encaissee(mongo, "FA-2026-000001", 1000.0)
    _cadeau(mongo, valeur_ttc=500.0)
    _cadeau(mongo, valeur_ttc=300.0, devise="USD", valeur_eur=None,
            document_id="doc-cadeau-2", marque="Brand X")
    assert declaration_to_pdf(generer_declaration(UID, DEBUT, FIN)).startswith(b"%PDF")
