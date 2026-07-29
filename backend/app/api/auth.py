"""Auth API — register / login / me / agent context (MongoDB, no Supabase)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_current_user
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


@router.post("/register", response_model=AuthResponse)
async def register(payload: RegisterRequest):
    try:
        user = await async_create_user(
            email=str(payload.email),
            password=payload.password,
            name=payload.name,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    token = create_access_token(user_id=user.id, email=user.email)
    return AuthResponse(access_token=token, user=user)


@router.post("/login", response_model=AuthResponse)
async def login(payload: LoginRequest):
    user = await async_authenticate_user(
        email=str(payload.email),
        password=payload.password,
    )
    if user is None:
        raise HTTPException(status_code=401, detail="Email ou mot de passe incorrect.")
    token = create_access_token(user_id=user.id, email=user.email)
    return AuthResponse(access_token=token, user=user)


@router.get("/me", response_model=UserPublic)
async def me(user: UserPublic = Depends(get_current_user)):
    return user


@router.get("/context", response_model=UserAgentContext)
async def agent_context(user: UserPublic = Depends(get_current_user)):
    """Return intake + guidance context snapshots for next features."""
    return user.agent_context
