"""Personnalisation de la veille réglementaire dans le Centre d'Actions (profil -> concerne).

`concerne_pour_profil` déduit des étiquettes ("influenceur"/"freelance"/"tous") à partir de
l'activité déclarée, utilisées pour filtrer le dernier rapport de veille (`scheduler.dernier_rapport()`)
sans jamais en cacher une actualité générale ("tous" toujours inclus).
"""

from __future__ import annotations

from app.agents.echeancier.profil import concerne_pour_profil
from app.schemas.orchestrator import UserProfile


def test_activite_sponsoring_est_taguee_influenceur():
    profil = UserProfile(activity_types=["Sponsoring", "UGC"])
    tags = concerne_pour_profil(profil)
    assert "influenceur" in tags
    assert "tous" in tags
    assert "freelance" not in tags


def test_activite_prestation_conseil_est_taguee_freelance():
    profil = UserProfile(activity_types=["Prestation de conseil"])
    tags = concerne_pour_profil(profil)
    assert "freelance" in tags
    assert "tous" in tags
    assert "influenceur" not in tags


def test_activite_inconnue_ou_absente_reste_tous_seulement():
    assert concerne_pour_profil(UserProfile()) == ["tous"]
    assert concerne_pour_profil(UserProfile(activity_types=["Vente d'objets artisanaux"])) == ["tous"]


def test_activite_mixte_cumule_les_deux_etiquettes():
    profil = UserProfile(
        activity_types=["Partenariat rémunéré"],
        secondary_activity_types=["Freelance graphisme"],
    )
    tags = concerne_pour_profil(profil)
    assert set(tags) == {"tous", "influenceur", "freelance"}
