"""
Filet de secours déterministe (`extract_answer.py`) utilisé quand le LLM d'extraction est
indisponible (ex: quota API épuisé). Régression : des réponses libres mais valables décrivant
concrètement la situation (vocabulaire des exemples de la question) doivent être comprises,
pas seulement les "oui"/"non" explicites.
"""

from app.agents.intake.tools.extract_answer import apply_updates
from app.schemas.orchestrator import UserProfile


def test_reponse_descriptive_commerciale_remplit_le_champ_bool():
    profile = UserProfile()
    result = apply_updates(
        profile,
        {},
        target_field="main_activity_commercial",
        last_answer="partenariat rémunéré",
    )
    assert result.main_activity_commercial is True


def test_reponse_descriptive_vente_remplit_le_champ_bool():
    profile = UserProfile()
    result = apply_updates(
        profile,
        {},
        target_field="main_activity_commercial",
        last_answer="vente et monétisation directe",
    )
    assert result.main_activity_commercial is True


def test_reponse_negative_descriptive_remplit_false():
    profile = UserProfile()
    result = apply_updates(
        profile,
        {},
        target_field="has_secondary_activity",
        last_answer="non, aucune activité secondaire",
    )
    assert result.has_secondary_activity is False


def test_reponse_ambigue_ne_force_pas_le_champ():
    profile = UserProfile()
    result = apply_updates(
        profile,
        {},
        target_field="main_activity_commercial",
        last_answer="je ne sais pas trop",
    )
    assert result.main_activity_commercial is None
