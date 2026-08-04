"""Rapport fiscal — préremplissage depuis l'onboarding, pièces annexes, archivage.

Trois ajouts, trois risques distincts :

  1. **Préremplissage** : le profil déclaré à l'onboarding doit alimenter le contexte de
     calcul, sans jamais inventer une valeur absente ni écraser une correction de
     l'utilisateur.
  2. **Contrats et dépenses** : ils éclairent le rapport mais ne doivent JAMAIS toucher à
     l'assiette. Un contrat signé n'est pas un euro reçu ; en micro, une dépense ne se déduit
     pas — l'abattement forfaitaire la remplace. Les compter fausserait l'impôt dans les
     deux sens.
  3. **Archivage** : un rapport est une photo. Le relire plus tard doit rendre les chiffres
     du jour de sa génération, pas ceux d'aujourd'hui.
"""

from __future__ import annotations

from typing import Any, Dict, List

import mongomock
import pytest

from app.agents.rapport_fiscal import orchestrateur as O
from app.agents.rapport_fiscal import sources, store
from app.agents.rapport_fiscal.contexte_profil import (
    champs_bloquants,
    contexte_depuis_profil,
    origine_des_champs,
)
from app.agents.rapport_fiscal.pdf import rapport_to_pdf
from app.agents.rapport_fiscal.schemas import ContexteFiscalRapport, DemandeRapport
from app.schemas.orchestrator import UserProfile

UID = "u1"
DEBUT, FIN = "2026-01-01", "2026-12-31"


@pytest.fixture(autouse=True)
def mongo(monkeypatch):
    client = mongomock.MongoClient()
    db = client["testdb"]
    monkeypatch.setattr(O, "get_db", lambda: db)
    monkeypatch.setattr(sources, "get_db", lambda: db)
    monkeypatch.setattr(store, "get_db", lambda: db)
    monkeypatch.setattr(store, "_initialized", False)
    monkeypatch.setattr(O, "_factures_avec_existence_fiscale", lambda uid: _factures())
    return db


_FACTURES: List[Dict[str, Any]] = []


def _factures() -> List[Dict[str, Any]]:
    return _FACTURES


@pytest.fixture(autouse=True)
def _vider_factures():
    _FACTURES.clear()
    yield
    _FACTURES.clear()


def _ajouter_facture(numero: str, net: float, emission: str = "2026-03-01"):
    _FACTURES.append({
        "id": f"id-{numero}", "numero": numero, "net_a_payer": net,
        "total_ht": net, "total_ttc": net, "date_emission": emission,
        "date_echeance": "2026-03-31", "client": {"nom": "Client SARL"},
        "lignes": [{"designation": "x", "quantite": 1, "prix_unitaire_ht": net,
                    "categorie": "prestation"}],
    })


def _ajouter_virement(db, doc_id: str, montant: float, motif: str, date_iso="2026-03-15"):
    db["virements"].insert_one({
        "user_id": UID, "document_id": doc_id,
        "transfer": {"amount": montant, "direction": "recu", "execution_date": date_iso,
                     "motif": motif, "sender_name": "Client SARL"},
    })


def _ajouter_contrat(db, doc_id: str, **contrat):
    base = {
        "contract_type": "partenariat", "title": "Partenariat annuel",
        "start_date": "2026-01-01", "end_date": "2026-12-31",
        "amount": 12000.0, "amount_eur": 12000.0,
        "parties": [{"name": "Marque SA", "role": "sponsor"}],
    }
    base.update(contrat)
    db["contrats"].insert_one({"user_id": UID, "document_id": doc_id, "contract": base})


def _ajouter_depense(db, doc_id: str, montant: float, date_iso="2026-04-01", **extra):
    facture = {
        "issuer_name": "Fournisseur SARL", "invoice_number": "F-2026-1",
        "issue_date": date_iso, "total_ttc": montant, "amount_eur": montant,
    }
    facture.update(extra)
    db["invoices"].insert_one({
        "user_id": UID, "document_id": doc_id, "invoice": facture,
        "expense_category": "materiel",
    })


def _generer(contexte=None):
    return O.generer(UID, DemandeRapport(
        date_debut=DEBUT, date_fin=FIN, contexte=contexte or ContexteFiscalRapport(),
    ))


# -- 1. Préremplissage depuis l'onboarding ------------------------------------
def _profil_complet(**extra) -> UserProfile:
    base = dict(
        siren="812345678", denomination="Studio Nova", recommended_regime="micro-BNC",
        fiscal_category="BNC", bnc_caisse="CIPAV", family_status="marie",
        fiscal_parts=2.0, other_household_income=18000.0, rfr_n_minus_2=32000.0,
        acre_active=True, versement_liberatoire=True, location_zone="metropole",
    )
    base.update(extra)
    return UserProfile(**base)


def test_le_contexte_est_prerempli_depuis_l_onboarding():
    ctx = contexte_depuis_profil(_profil_complet())

    assert ctx.parts_fiscales == 2.0
    assert ctx.autres_revenus == 18000.0
    assert ctx.rfr_n2 == 32000.0
    assert ctx.en_couple is True
    assert ctx.caisse_bnc == "CIPAV"
    assert ctx.acre_active is True
    assert ctx.option_versement_liberatoire is True
    assert ctx.categorie_par_defaut == "BNC"
    assert ctx.dom is False


def test_un_champ_non_renseigne_reste_vide():
    """Le préremplissage ne comble pas les trous : le moteur refusera ce qu'il ne peut pas."""
    ctx = contexte_depuis_profil(UserProfile())
    assert ctx.parts_fiscales is None
    assert ctx.autres_revenus is None
    assert ctx.rfr_n2 is None


def test_le_dom_declare_est_repercute():
    assert contexte_depuis_profil(_profil_complet(location_zone="dom")).dom is True


@pytest.mark.parametrize("situation,attendu", [
    ("marie", True), ("pacse", True), ("celibataire", False), (None, False),
])
def test_la_situation_familiale_determine_le_couple(situation, attendu):
    assert contexte_depuis_profil(_profil_complet(family_status=situation)).en_couple is attendu


def test_la_categorie_se_deduit_du_tax_category_a_defaut():
    """`fiscal_category` absent : on retombe sur la classification, moins précise."""
    profil = _profil_complet(fiscal_category=None, tax_category="BIC")
    assert contexte_depuis_profil(profil).categorie_par_defaut == "BIC_SERVICE"


def test_l_origine_distingue_non_renseigne_et_sans_reponse():
    """« Je ne sais pas » n'est pas la même chose qu'une question jamais posée."""
    profil = _profil_complet(rfr_n_minus_2=None, unknown_fields=["rfr_n_minus_2"])
    origine = origine_des_champs(profil)

    assert origine["rfr_n2"] == "sans_reponse"
    assert origine["parts_fiscales"] == "onboarding"
    assert origine_des_champs(UserProfile())["rfr_n2"] == "non_renseigne"


def test_les_champs_bloquants_disent_ce_qui_ne_sera_pas_calcule():
    bloquants = champs_bloquants(UserProfile())
    champs = {b["champ"] for b in bloquants}

    assert "foyer_fiscal" in champs
    assert "rfr_n_minus_2" in champs
    assert all(b["consequence"] for b in bloquants), "chaque manque dit ce qu'il coûte"


def test_un_profil_complet_ne_bloque_rien():
    assert champs_bloquants(_profil_complet()) == []


def test_la_correction_de_l_utilisateur_fait_autorite(mongo):
    """Le préremplissage propose ; le contexte transmis dispose."""
    _ajouter_facture("FA-2026-000001", 30000.0)
    _ajouter_virement(mongo, "v1", 30000.0, "FA-2026-000001")

    corrige = contexte_depuis_profil(_profil_complet())
    corrige.parts_fiscales = 3.0  # l'utilisateur corrige à l'écran
    rapport = _generer(corrige)

    assert rapport.simulation["detail_avec_micro"]["parts"] == 3.0


# -- 2. Contrats : ils éclairent, ils ne comptent pas -------------------------
def test_un_contrat_n_entre_jamais_dans_le_chiffre_d_affaires(mongo):
    """Un contrat signé engage, il n'encaisse pas. L'y inclure gonflerait l'impôt."""
    _ajouter_contrat(mongo, "c1", amount=50000.0, amount_eur=50000.0)
    rapport = _generer()

    assert rapport.ca_retenu == 0.0
    assert rapport.sources.contrats_en_cours == 1
    assert rapport.sources.revenu_contractuel_engage_eur == 50000.0
    assert rapport.simulation["base_imposable"] == 0.0, "le contrat ne crée aucune base"


def test_un_contrat_hors_periode_est_ignore(mongo):
    _ajouter_contrat(mongo, "c1", start_date="2024-01-01", end_date="2024-12-31")
    assert _generer().sources.contrats_en_cours == 0


def test_un_contrat_a_duree_indeterminee_reste_visible(mongo):
    """Sans date de fin, l'exclure ferait disparaître les contrats les plus structurants."""
    _ajouter_contrat(mongo, "c1", end_date=None, is_open_ended=True)
    assert _generer().sources.contrats_en_cours == 1


def test_un_contrat_de_travail_est_signale_comme_hors_micro(mongo):
    """Un salaire se déclare en traitements et salaires, pas en chiffre d'affaires."""
    _ajouter_contrat(mongo, "c1", contract_type="travail", amount=24000.0, amount_eur=24000.0)
    rapport = _generer()

    alerte = next(a for a in rapport.alertes if "contrat" in a.titre.lower()
                  and "travail" in a.titre.lower())
    assert "salaire" in alerte.message.lower()
    assert rapport.ca_retenu == 0.0


def test_un_salaire_n_est_pas_du_revenu_contractuel_engage(mongo):
    """Salaire et prestation ne se déclarent pas au même endroit : les additionner égarerait."""
    _ajouter_contrat(mongo, "c1", contract_type="sponsoring", amount_eur=24000.0)
    _ajouter_contrat(mongo, "c2", contract_type="travail", amount_eur=18000.0)

    src = _generer().sources
    assert src.contrats_en_cours == 2, "les deux restent visibles"
    assert src.revenu_contractuel_engage_eur == 24000.0, "le salaire est exclu du total"


def test_le_montant_en_devise_est_repris_en_euros(mongo):
    """Un contrat en devise doit être comparable aux autres : `amount_eur` prime."""
    _ajouter_contrat(mongo, "c1", amount=10000.0, currency="USD", amount_eur=9200.0)
    assert _generer().sources.revenu_contractuel_engage_eur == 9200.0


def test_les_contrats_d_un_autre_utilisateur_sont_invisibles(mongo):
    mongo["contrats"].insert_one({
        "user_id": "quelqu-un-d-autre", "document_id": "cX",
        "contract": {"start_date": "2026-01-01", "end_date": "2026-12-31", "amount_eur": 9999.0},
    })
    assert _generer().sources.contrats_en_cours == 0


# -- 3. Dépenses : informatives, jamais déductibles ---------------------------
def test_une_depense_ne_reduit_pas_la_base_imposable(mongo):
    """En micro, l'abattement forfaitaire REMPLACE la déduction des frais réels."""
    _ajouter_facture("FA-2026-000001", 30000.0)
    _ajouter_virement(mongo, "v1", 30000.0, "FA-2026-000001")
    _ajouter_depense(mongo, "d1", 8000.0)

    rapport = _generer()
    sans_depense = 30000.0

    assert rapport.ca_retenu == sans_depense, "le CA n'est pas amputé des dépenses"
    assert rapport.sources.total_depenses_eur == 8000.0
    # La base imposable dépend du seul CA : 34 % d'abattement en BNC.
    assert rapport.simulation["lignes"][0]["ca"] == sans_depense


def test_les_depenses_sont_signalees_comme_non_deductibles(mongo):
    _ajouter_depense(mongo, "d1", 1200.0)
    rapport = _generer()

    alerte = next(a for a in rapport.alertes if "dépense" in a.titre.lower())
    assert "ne réduisent pas votre impôt" in alerte.message


def test_une_depense_hors_periode_est_ignoree(mongo):
    _ajouter_depense(mongo, "d1", 500.0, date_iso="2025-04-01")
    assert _generer().sources.depenses_capturees == 0


def test_le_decompte_des_pieces_est_expose(mongo):
    _ajouter_facture("FA-2026-000001", 1000.0)
    _ajouter_virement(mongo, "v1", 1000.0, "FA-2026-000001")
    _ajouter_contrat(mongo, "c1")
    _ajouter_depense(mongo, "d1", 200.0)

    src = _generer().sources
    assert (src.factures_emises, src.virements_analyses) == (1, 1)
    assert (src.contrats_en_cours, src.depenses_capturees) == (1, 1)


# -- 4. Archivage -------------------------------------------------------------
def test_un_rapport_enregistre_se_relit(mongo):
    _ajouter_facture("FA-2026-000001", 5000.0)
    _ajouter_virement(mongo, "v1", 5000.0, "FA-2026-000001")

    rapport = _generer()
    store.enregistrer(rapport)

    relu = store.obtenir(UID, rapport.id)
    assert relu is not None
    assert relu["ca_retenu"] == 5000.0


def test_la_liste_va_du_plus_recent_au_plus_ancien(mongo):
    for i in range(3):
        rapport = _generer()
        rapport.genere_le = f"2026-0{i + 1}-01T10:00:00+00:00"
        store.enregistrer(rapport)

    dates = [r["genere_le"] for r in store.lister(UID)]
    assert dates == sorted(dates, reverse=True)


def test_un_rapport_archive_garde_ses_chiffres(mongo):
    """C'est une photo : corriger une facture après coup ne doit pas la réécrire."""
    _ajouter_facture("FA-2026-000001", 5000.0)
    _ajouter_virement(mongo, "v1", 5000.0, "FA-2026-000001")
    store.enregistrer(_generer())

    _ajouter_facture("FA-2026-000002", 9000.0)
    _ajouter_virement(mongo, "v2", 9000.0, "FA-2026-000002")

    archive = store.lister(UID)[0]
    assert archive["ca_retenu"] == 5000.0, "l'archive ne suit pas les données du jour"
    assert _generer().ca_retenu == 14000.0, "un nouveau rapport, lui, voit tout"


def test_les_rapports_d_un_autre_utilisateur_sont_invisibles(mongo):
    store.enregistrer(_generer())
    assert store.lister("quelqu-un-d-autre") == []


def test_la_suppression_ne_touche_que_le_bon_rapport(mongo):
    a, b = _generer(), _generer()
    store.enregistrer(a)
    store.enregistrer(b)

    assert store.supprimer(UID, a.id) is True
    assert store.supprimer(UID, a.id) is False, "déjà supprimé"
    assert {r["id"] for r in store.lister(UID)} == {b.id}


def test_la_route_contexte_n_est_pas_avalee_par_la_route_par_identifiant():
    """`/contexte` doit être déclaré AVANT `/{rapport_id}`, sinon il est lu comme un id.

    FastAPI résout dans l'ordre de déclaration : inverser les deux ferait répondre « rapport
    introuvable » au préremplissage, sans que rien ne semble cassé côté serveur.
    """
    from app.api.rapport_fiscal import router

    chemins = [r.path for r in router.routes]
    assert chemins.index("/api/rapport-fiscal/contexte") < chemins.index(
        "/api/rapport-fiscal/{rapport_id}"
    )


def test_le_pdf_d_un_rapport_archive_se_rend(mongo):
    from app.agents.rapport_fiscal.schemas import RapportFiscal

    _ajouter_facture("FA-2026-000001", 4000.0)
    _ajouter_virement(mongo, "v1", 4000.0, "FA-2026-000001")
    _ajouter_contrat(mongo, "c1")
    _ajouter_depense(mongo, "d1", 900.0)

    rapport = _generer()
    store.enregistrer(rapport)

    relu = RapportFiscal.model_validate(store.obtenir(UID, rapport.id))
    assert rapport_to_pdf(relu)[:4] == b"%PDF"
