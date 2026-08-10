"""Branch B (no SIREN) orchestrator + diagnostic agent tests."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.agents.guidance.agent import ask_next_question, finalize_diagnostic
from app.agents.guidance.chat import _accompagnement_repli, accompagnement_valide
from app.agents.guidance.questions import next_missing_field
from app.agents.guidance.understand import extraire_profil_regex
from app.schemas.orchestrator import DiagnosticProfile, OrchestratorState, UserProfile


def test_regex_extract_activite_et_ca():
    out = extraire_profil_regex("Je fais du YouTube, environ 3000 € par mois, pas de vente de produits")
    assert out.get("activite") == "YouTube"
    assert out.get("ca_estime_annuel") == 36000.0
    assert out.get("vend_produits") is False


def test_questions_order_core_fields():
    diag = DiagnosticProfile()
    assert next_missing_field(diag) == "activite"
    diag.activite = "YouTube"
    assert next_missing_field(diag) == "ca_estime_annuel"
    diag.ca_estime_annuel = 20000
    assert next_missing_field(diag) == "vend_produits"


def test_ask_complete_when_profile_ready():
    diag = DiagnosticProfile(
        activite="YouTube",
        ca_estime_annuel=20000,
        vend_produits=False,
        recoit_cadeaux=False,
        situation_actuelle="salarié",
        anciennete="Plus d'un an",
    )
    result = ask_next_question(diag)
    assert result.is_complete is True


def test_accompagnement_repli_est_personnalise_et_actionnable():
    roadmap = {
        "bandeau": {"titre": "Micro-entreprise"},
        "etapes": [{"titre": "Vérifier la nature de l'activité et le code APE"}],
    }

    texte = _accompagnement_repli(
        {"activite": "création de contenu", "situation_actuelle": "salarié"},
        roadmap,
    )

    assert "création de contenu" in texte
    assert "Micro-entreprise" in texte
    assert "Vérifier la nature de l'activité et le code APE" in texte
    assert accompagnement_valide(texte) == (True, "")


def test_accompagnement_trop_generique_est_refuse():
    assert accompagnement_valide("Voici votre feuille de route. Avancez à votre rythme.") == (
        False,
        "moins de 3 phrases",
    )


@pytest.mark.asyncio
async def test_finalize_sets_skipped_and_roadmap():
    diag = DiagnosticProfile(
        activite="YouTube",
        ca_estime_annuel=20000,
        vend_produits=False,
        recoit_cadeaux=False,
    )
    with patch(
        "app.agents.guidance.agent.rediger_accompagnement",
        new_callable=AsyncMock,
        return_value="Voici votre feuille de route personnalisée.",
    ):
        result = await finalize_diagnostic(diag)
    assert result.profile.verification_status == "skipped"
    assert result.roadmap is not None
    assert result.roadmap["parcours"] == "micro"
    assert result.profile.recommended_regime
    assert len(result.profile.recommended_actions) > 0


@pytest.mark.asyncio
async def test_start_diagnostic_without_siret():
    store: dict[str, OrchestratorState] = {}

    async def fake_create(*, user_id: str | None = None) -> str:
        sid = "test-diagnostic-session"
        store[sid] = OrchestratorState(
            session_id=sid,
            phase="verification",
            profile=UserProfile(),
            user_id=user_id,
        )
        return sid

    async def fake_get(sid: str):
        return store.get(sid)

    async def fake_save(sid: str, state: OrchestratorState):
        store[sid] = state

    with (
        patch("app.agents.orchestrator.async_create_session", side_effect=fake_create),
        patch("app.agents.orchestrator.async_get_session", side_effect=fake_get),
        patch("app.agents.orchestrator.async_save_session", side_effect=fake_save),
    ):
        from app.agents.orchestrator import start_orchestrator

        resp = await start_orchestrator(
            None,
            skip_verification=True,
            branch="guidance",
        )

    assert resp.session_id == "test-diagnostic-session"
    assert resp.phase == "diagnostic_questions"
    assert resp.ui_action == "ask_question"
    assert resp.message
    assert store["test-diagnostic-session"].branch == "guidance"
    assert store["test-diagnostic-session"].profile.verification_status == "skipped"


@pytest.mark.asyncio
async def test_start_without_siret_rejected_for_branch_a():
    from app.agents.orchestrator import start_orchestrator

    with pytest.raises(ValueError, match="SIRET"):
        await start_orchestrator(None)


@pytest.mark.asyncio
async def test_diagnostic_completion_produces_roadmap():
    store: dict[str, OrchestratorState] = {}
    sid = "diag-complete"

    store[sid] = OrchestratorState(
        session_id=sid,
        phase="diagnostic_questions",
        branch="guidance",
        skip_verification=True,
        profile=UserProfile(verification_status="skipped"),
        diagnostic_profile=DiagnosticProfile(
            activite="YouTube",
            ca_estime_annuel=20000,
            vend_produits=False,
            recoit_cadeaux=False,
            situation_actuelle="salarié",
            # missing anciennete → last question
        ),
        last_question="Depuis combien de temps… ?",
        last_question_field="anciennete",
    )

    async def fake_get(s: str):
        return store.get(s)

    async def fake_save(s: str, state: OrchestratorState):
        store[s] = state

    with (
        patch("app.agents.orchestrator.async_get_session", side_effect=fake_get),
        patch("app.agents.orchestrator.async_save_session", side_effect=fake_save),
        patch(
            "app.agents.guidance.agent.rediger_accompagnement",
            new_callable=AsyncMock,
            return_value="Feuille de route prête.",
        ),
        patch(
            "app.agents.guidance.understand.chat_json",
            new_callable=AsyncMock,
            return_value={
                "status": "ok",
                "assistant_message": None,
                "updates": {"anciennete": "Plus d'un an"},
            },
        ),
    ):
        from app.agents.orchestrator import orchestrator_turn

        resp = await orchestrator_turn(sid, "Plus d'un an")

    assert resp.ui_action == "show_roadmap"
    assert resp.phase == "diagnostic_roadmap"
    assert resp.roadmap is not None
    assert store[sid].roadmap is not None
    assert store[sid].profile.verification_status == "skipped"
