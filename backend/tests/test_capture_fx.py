"""Unification des devises en euros : choix de la source et traçabilité.

Couvre ce que l'intégration doit préserver :
  • la BCE reste prioritaire pour les devises qu'elle publie — le repli élargi
    ne doit jamais lui voler une conversion (les taux diffèrent de quelques
    dixièmes de pour cent, ce qui se voit en comptabilité) ;
  • une devise hors périmètre BCE (TND, MAD…) passe bien par le repli, sinon
    la pièce resterait sans contre-valeur ;
  • la provenance suit le taux jusqu'en base, y compris via le cache ;
  • rien n'est inventé : sans date, sans devise ou sans source, le montant en
    euros reste absent plutôt qu'approximé (FR-08).

Aucun appel réseau : les deux sources sont remplacées par des doublures.
"""

from __future__ import annotations

import mongomock
import pytest

from app.agents.capture.app import fx
from app.agents.capture.app.db import Database


@pytest.fixture
def db() -> Database:
    return Database(mongomock.MongoClient(), "testdb")


@pytest.fixture
def sources(monkeypatch):
    """Doublures des deux sources + journal des appels."""
    appels: list[str] = []
    reponses = {"bce": None, "repli": None}

    def fake_ecb(code, on_date):
        appels.append(f"bce:{code}")
        return reponses["bce"]

    def fake_fallback(code, on_date):
        appels.append(f"repli:{code}")
        return reponses["repli"]

    monkeypatch.setattr(fx, "_rate_from_ecb", fake_ecb)
    monkeypatch.setattr(fx, "_rate_from_fallback", fake_fallback)
    return appels, reponses


def test_euro_ne_declenche_aucun_appel(db, sources):
    appels, _ = sources
    assert fx.get_eur_rate(db, "EUR", "2025-05-02") == (1.0, fx.SOURCE_ECB)
    assert appels == []


def test_bce_prioritaire_quand_elle_couvre_la_devise(db, sources):
    appels, reponses = sources
    reponses["bce"] = 0.8816
    reponses["repli"] = 0.88538  # ne doit pas être retenu

    rate, source = fx.get_eur_rate(db, "USD", "2025-05-02")

    assert (rate, source) == (0.8816, fx.SOURCE_ECB)
    assert appels == ["bce:USD"], "le repli ne doit pas être sollicité"


def test_repli_pour_une_devise_hors_perimetre_bce(db, sources):
    appels, reponses = sources
    reponses["bce"] = None          # la BCE ne publie pas le TND
    reponses["repli"] = 0.29705041

    rate, source = fx.get_eur_rate(db, "TND", "2025-05-02")

    assert (rate, source) == (0.29705041, fx.SOURCE_FALLBACK)
    assert appels == ["bce:TND", "repli:TND"]


def test_devise_inconnue_des_deux_sources(db, sources):
    _, reponses = sources
    reponses["bce"] = None
    reponses["repli"] = None
    assert fx.get_eur_rate(db, "XXX", "2025-05-02") == (None, None)


def test_le_cache_evite_un_second_appel_et_garde_la_provenance(db, sources):
    appels, reponses = sources
    reponses["bce"] = None
    reponses["repli"] = 0.29705041

    fx.get_eur_rate(db, "TND", "2025-05-02")
    appels.clear()
    rate, source = fx.get_eur_rate(db, "TND", "2025-05-02")

    assert (rate, source) == (0.29705041, fx.SOURCE_FALLBACK)
    assert appels == [], "le second appel doit être servi par le cache"


def test_entree_de_cache_anterieure_au_suivi_de_provenance(db, sources):
    """Sans champ `source`, le taux ne peut venir que de la BCE : seule source d'alors."""
    db.fx_rates.insert_one({"currency": "CHF", "date": "2025-05-02", "rate": 1.05})
    assert fx.get_eur_rate(db, "CHF", "2025-05-02") == (1.05, fx.SOURCE_ECB)


def test_conversion_du_montant_et_arrondi(db, sources):
    _, reponses = sources
    reponses["bce"] = None
    reponses["repli"] = 0.29705041

    montant_eur, taux, source = fx.enrich_amount_eur(db, 13860.15, "TND", "2025-05-02")

    assert montant_eur == 4117.16          # arrondi au centime
    assert taux == 0.29705041
    assert source == fx.SOURCE_FALLBACK


@pytest.mark.parametrize(
    "montant,devise,date",
    [
        (100.0, "TND", None),   # date absente : aucun taux historique possible
        (100.0, None, "2025-05-02"),
        (None, "TND", "2025-05-02"),
    ],
)
def test_rien_n_est_invente_quand_une_donnee_manque(db, sources, montant, devise, date):
    _, reponses = sources
    reponses["bce"] = 0.9
    reponses["repli"] = 0.9
    assert fx.enrich_amount_eur(db, montant, devise, date) == (None, None, None)
