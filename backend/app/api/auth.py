"""Auth API — register / login / logout / me / agent context (MongoDB, no Supabase)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response

from app.api.deps import get_current_user
from app.config import settings
from app.core.security import create_access_token
from app.core.users import async_authenticate_user, async_create_user
from app.schemas.auth import (
    AuthResponse,
    LoginRequest,
    RegisterRequest,
    UserAgentContext,
    UserPublic,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _poser_cookie(response: Response, token: str) -> None:
    """Dépose le jeton de session en cookie `httpOnly`.

    `httponly=True` est le point essentiel : le jeton devient illisible depuis JavaScript, donc
    inexploitable par un script injecté dans la page — contrairement à un stockage local, que
    n'importe quel script de la page peut lire. Les autres attributs dépendent du déploiement et
    se règlent par variables d'environnement (voir `app/config.py`).
    """
    response.set_cookie(
        key=settings.auth_cookie_name,
        value=token,
        max_age=settings.auth_token_days * 24 * 3600,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite=settings.auth_cookie_samesite,
        domain=settings.auth_cookie_domain or None,
        path="/",
    )


@router.post("/register", response_model=AuthResponse)
async def register(payload: RegisterRequest, response: Response):
    try:
        user = await async_create_user(
            email=str(payload.email),
            password=payload.password,
            name=payload.name,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    token = create_access_token(user_id=user.id, email=user.email)
    _poser_cookie(response, token)
    return AuthResponse(user=user)


@router.post("/login", response_model=AuthResponse)
async def login(payload: LoginRequest, response: Response):
    user = await async_authenticate_user(
        email=str(payload.email),
        password=payload.password,
    )
    if user is None:
        raise HTTPException(status_code=401, detail="Email ou mot de passe incorrect.")
    token = create_access_token(user_id=user.id, email=user.email)
    _poser_cookie(response, token)
    return AuthResponse(user=user)


@router.post("/logout", status_code=204)
async def logout(response: Response):
    """Retire le cookie de session.

    Indispensable depuis que le jeton est `httpOnly` : le navigateur ne peut plus l'effacer
    lui-même, seul le serveur qui l'a posé peut le retirer. Les attributs passés ici doivent
    correspondre à ceux du dépôt, sinon le navigateur ne reconnaît pas le cookie à supprimer.
    """
    response.delete_cookie(
        key=settings.auth_cookie_name,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite=settings.auth_cookie_samesite,
        domain=settings.auth_cookie_domain or None,
        path="/",
    )
    return None


@router.get("/me", response_model=UserPublic)
async def me(user: UserPublic = Depends(get_current_user)):
    return user


@router.get("/context", response_model=UserAgentContext)
async def agent_context(user: UserPublic = Depends(get_current_user)):
    """Return intake + guidance context snapshots for next features."""
    return user.agent_context
