"""Déclaration fiscale préparée — cases vérifiées à la source, traçabilité, jamais transmise.

Couvre ce que l'intégration doit préserver :
  • les cases (5HQ, 5KO) viennent d'une source officielle citée, jamais de mémoire ;
  • « mixte » dans ce moteur signifie BNC prestations + BIC vente — RÉGRESSION : la première
    version de ce module utilisait à tort 5KP (BIC services) pour la part prestations d'une
    activité mixte, alors que le moteur existant (`categorie_activite`) ne route jamais vers
    "bic_services" et traite la part prestations d'un mixte comme du BNC (5HQ) ;
  • chaque case porte la trace exacte des factures qui la composent ;
  • le statut passe de "brouillon" à "revue" seulement sur action explicite de l'utilisateur,
    jamais automatiquement ;
  • le PDF se génère sans erreur.
"""

from __future__ import annotations

from datetime import date

import mongomock
import pytest

from app.agents.declaration import store as declaration_store
from app.agents.declaration.generator import generer_declaration
from app.agents.declaration.pdf import declaration_to_pdf
from app.agents.facture import store as facture_store
from app.agents.facture.generator import generer_facture
from app.agents.facture.schemas import ClientFacture, FactureRequest, LigneFacture
from app.schemas.orchestrator import UserProfile

UID = "user-declaration-test"


@pytest.fixture(autouse=True)
def mongo(monkeypatch):
    client = mongomock.MongoClient()
    db = client["ledgermind_test"]
    monkeypatch.setattr(facture_store, "get_db", lambda: db)
    monkeypatch.setattr(declaration_store, "get_db", lambda: db)
    yield


def _profil() -> UserProfile:
    return UserProfile(
        siren="123456789", denomination="Julie Martin", is_entrepreneur_individuel=True,
        registry_address="12 rue des Lilas, 75011 Paris", recommended_regime="micro-BNC",
        verification_status="verified",
    )


def _emettre(designation: str, montant: float, categorie: str) -> str:
    req = FactureRequest(
        client=ClientFacture(nom="Client Test", est_professionnel=True),
        lignes=[LigneFacture(designation=designation, prix_unitaire_ht=montant, categorie=categorie)],
    )
    numero = facture_store.prochain_numero(UID)
    f = generer_facture(UID, numero, _profil(), req)
    facture_store.enregistrer(f)
    return numero


def test_prestations_pures_case_5hq_bnc():
    """Une activité 100 % prestations (BNC) déclare en case 5HQ."""
    _emettre("Création de contenu", 2000, "prestation")
    aujourdhui = date.today()
    decl = generer_declaration(UID, aujourdhui, aujourdhui)
    assert decl.categorie == "bnc"
    assert len(decl.lignes) == 1
    assert decl.lignes[0].case == "5HQ"
    assert decl.lignes[0].montant == 2000.0


def test_vente_pure_case_5ko_bic():
    _emettre("Vente de produits", 5000, "vente")
    aujourdhui = date.today()
    decl = generer_declaration(UID, aujourdhui, aujourdhui)
    assert decl.categorie == "bic_vente"
    assert len(decl.lignes) == 1
    assert decl.lignes[0].case == "5KO"


def test_mixte_prestations_en_5hq_pas_5kp():
    """RÉGRESSION : la part prestations d'une activité mixte est du BNC (5HQ), jamais 5KP
    (BIC services) — le moteur ne produit jamais cette catégorie en pratique."""
    _emettre("Création de contenu", 1500, "prestation")
    _emettre("Vente merch", 800, "vente")
    aujourdhui = date.today()
    decl = generer_declaration(UID, aujourdhui, aujourdhui)

    assert decl.categorie == "mixte"
    cases = {l.case: l.montant for l in decl.lignes}
    assert cases == {"5HQ": 1500.0, "5KO": 800.0}
    assert "5KP" not in cases


def test_tracabilite_facture_par_case():
    num1 = _emettre("Création de contenu", 1500, "prestation")
    num2 = _emettre("Vente merch", 800, "vente")
    aujourdhui = date.today()
    decl = generer_declaration(UID, aujourdhui, aujourdhui)

    case_5hq = next(l for l in decl.lignes if l.case == "5HQ")
    case_5ko = next(l for l in decl.lignes if l.case == "5KO")
    assert num1 in case_5hq.provenance
    assert num2 in case_5ko.provenance


def test_source_case_officielle_citee():
    _emettre("Prestation", 1000, "prestation")
    decl = generer_declaration(UID, date.today(), date.today())
    assert decl.source_formulaire.startswith("https://www.impots.gouv.fr")


def test_statut_brouillon_puis_revue_sur_action_explicite():
    _emettre("Prestation", 1000, "prestation")
    decl = generer_declaration(UID, date.today(), date.today())
    assert decl.statut == "brouillon"
    assert decl.revue_le is None

    declaration_store.enregistrer(decl)
    revue = declaration_store.marquer_revue(UID, decl.id)
    assert revue["statut"] == "revue"
    assert revue["revue_le"] is not None


def test_jamais_transmis_avertissement_present():
    _emettre("Prestation", 1000, "prestation")
    decl = generer_declaration(UID, date.today(), date.today())
    assert "PAS UNE DÉCLARATION TRANSMISE" in decl.avertissement


def test_pdf_se_genere_sans_erreur():
    _emettre("Création de contenu", 1500, "prestation")
    _emettre("Vente merch", 800, "vente")
    decl = generer_declaration(UID, date.today(), date.today())
    pdf = declaration_to_pdf(decl)
    assert pdf[:5] == b"%PDF-"
    assert len(pdf) > 500
