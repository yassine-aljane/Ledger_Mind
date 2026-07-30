"""Rapport d'activité par période — consolidation déterministe, signaux prudents, PDF.

Couvre ce que l'intégration doit préserver :
  • les chiffres viennent des factures émises de la période, jamais d'une estimation LLM ;
  • la ventilation prestations/ventes reflète la catégorie de chaque ligne de facture ;
  • le seuil et le taux de cotisations viennent du moteur déterministe existant (aucune
    duplication, aucune valeur codée en dur ici) ;
  • un signal de conformité reste une QUESTION, jamais une accusation ;
  • l'appréciation ne fait que mettre en récit des chiffres déjà figés (LLM mocké ici).

MongoDB est simulé par `mongomock`.
"""

from __future__ import annotations

from datetime import date

import mongomock
import pytest

from app.agents.facture import store as facture_store
from app.agents.facture.generator import generer_facture
from app.agents.facture.schemas import ClientFacture, FactureRequest, LigneFacture
from app.agents.rapport import appreciation, consolidation, signaux, store as rapport_store
from app.agents.rapport.generator import generer_rapport
from app.agents.rapport.schemas import PeriodeRequest
from app.core import conversation_store
from app.schemas.orchestrator import UserProfile

UID = "user-rapport-test"


@pytest.fixture(autouse=True)
def mongo(monkeypatch):
    client = mongomock.MongoClient()
    db = client["ledgermind_test"]
    monkeypatch.setattr(facture_store, "get_db", lambda: db)
    monkeypatch.setattr(rapport_store, "get_db", lambda: db)
    monkeypatch.setattr(conversation_store, "get_db", lambda: db)
    yield


@pytest.fixture(autouse=True)
def llm_mock(monkeypatch):
    """L'appréciation ne doit pas dépendre d'un vrai appel réseau dans les tests."""
    async def _fake(system, prompt, **kw):
        return "Appréciation de test."
    monkeypatch.setattr(appreciation, "chat_text", _fake)
    yield


def _profil_micro() -> UserProfile:
    return UserProfile(
        siren="123456789", denomination="Julie Martin", is_entrepreneur_individuel=True,
        registry_address="12 rue des Lilas, 75011 Paris", recommended_regime="micro-BNC",
        verification_status="verified",
    )


def _emettre_facture(designation: str, montant: float, categorie: str) -> None:
    req = FactureRequest(
        client=ClientFacture(nom="Client Test", est_professionnel=True),
        lignes=[LigneFacture(designation=designation, prix_unitaire_ht=montant, categorie=categorie)],
    )
    numero = facture_store.prochain_numero(UID)
    f = generer_facture(UID, numero, _profil_micro(), req)
    facture_store.enregistrer(f)


def test_ventilation_prestations_ventes_depuis_les_factures():
    _emettre_facture("Création de contenu", 1500, "prestation")
    _emettre_facture("Vente de merch", 800, "vente")

    # Les factures sont émises avec la date du jour (voir generator.py) : la période testée
    # doit l'englober, pas une plage codée en dur qui ne correspondrait à aucun exercice réel.
    aujourdhui = date.today()
    brut = consolidation.consolider(UID, aujourdhui, aujourdhui)
    assert brut["total_ht"] == 2300.0
    assert brut["ht_prestations"] == 1500.0
    assert brut["ht_ventes"] == 800.0
    assert brut["nb_factures"] == 2


def test_periode_hors_bornes_exclue():
    _emettre_facture("Hors période", 999, "prestation")
    brut = consolidation.consolider(UID, date(2020, 1, 1), date(2020, 1, 31))
    assert brut["nb_factures"] == 0
    assert brut["total_ht"] == 0.0


def test_signal_ecart_declaratif_est_une_question_jamais_une_accusation():
    brut = {"total_ht": 20000.0}
    sig = signaux.detecter_signaux(brut, ca_declare_annuel=10000.0)
    assert len(sig) == 1
    texte = sig[0].question.lower()
    for mot_interdit in ("fraude", "infraction", "illégal", "suspect"):
        assert mot_interdit not in texte
    assert "?" in sig[0].question


def test_aucun_signal_si_coherent_avec_le_declare():
    brut = {"total_ht": 9000.0}
    assert signaux.detecter_signaux(brut, ca_declare_annuel=10000.0) == []


@pytest.mark.asyncio
async def test_rapport_complet_chiffres_et_appreciation():
    _emettre_facture("Création de contenu", 1500, "prestation")
    _emettre_facture("Vente de merch", 800, "vente")
    conversation_store.patch_profil(UID, {"ca_estime": 12000, "remuneration_nature": 150})

    req = PeriodeRequest(date_debut=date(2026, 1, 1), date_fin=date(2026, 12, 31))
    rapport = await generer_rapport(UID, req, objectif="Passer en société")

    assert rapport.nb_factures == 2
    assert rapport.total_ht == 2300.0
    assert rapport.ventilation_prestations_ht == 1500.0
    assert rapport.ventilation_ventes_ht == 800.0
    assert rapport.avantages_nature == 150
    assert rapport.categorie_fiscale == "mixte"
    assert rapport.seuil_applicable > 0
    assert rapport.cotisations_estimees > 0
    assert rapport.appreciation == "Appréciation de test."
    assert len(rapport.sources) >= 1
    assert all(s.startswith("http") for s in rapport.sources)


@pytest.mark.asyncio
async def test_pdf_se_genere_sans_erreur():
    _emettre_facture("Création de contenu", 1500, "prestation")
    req = PeriodeRequest(date_debut=date(2026, 1, 1), date_fin=date(2026, 12, 31))
    rapport = await generer_rapport(UID, req)

    from app.agents.rapport.pdf import rapport_to_pdf
    pdf = rapport_to_pdf(rapport)
    assert pdf[:5] == b"%PDF-"
    assert len(pdf) > 500
