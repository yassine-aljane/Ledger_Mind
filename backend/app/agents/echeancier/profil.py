"""Lecture/écriture du profil vérifié (branche intake) pour le moteur d'échéances.

Les nouveaux champs de calendrier fiscal sont demandés à la volée depuis l'agenda, jamais insérés
dans la séquence d'onboarding (`intake/questions.py`) : ils ne concernent que ce moteur, pas la
classification fiscale de base, et ne doivent pas rallonger l'onboarding de tous les utilisateurs.
"""

from __future__ import annotations

from fastapi import HTTPException

from app.core.session_store import async_get_session, async_save_session
from app.schemas.auth import UserPublic
from app.schemas.orchestrator import UserProfile


def profil_verifie(user: UserPublic) -> UserProfile:
    brut = user.agent_context.intake.profile
    if not brut:
        raise HTTPException(
            status_code=409,
            detail="Vérifiez d'abord votre SIREN : aucune identité d'entreprise vérifiée n'est "
                   "associée à ce compte.",
        )
    profil = UserProfile.model_validate(brut)
    if profil.verification_status != "verified":
        raise HTTPException(
            status_code=409,
            detail="Le calendrier fiscal n'est disponible qu'après vérification de votre SIREN.",
        )
    return profil


async def mettre_a_jour_parametres(user: UserPublic, valeurs: dict) -> UserProfile:
    session_id = user.agent_context.intake.last_session_id
    if not session_id:
        raise HTTPException(status_code=409, detail="Aucune session vérifiée associée à ce compte.")
    state = await async_get_session(session_id)
    if state is None:
        raise HTTPException(status_code=409, detail="Session introuvable.")
    for champ, valeur in valeurs.items():
        if valeur is not None:
            setattr(state.profile, champ, valeur)
    await async_save_session(session_id, state)
    return state.profile
