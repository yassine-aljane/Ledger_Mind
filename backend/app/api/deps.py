"""FastAPI auth dependencies."""

from __future__ import annotations

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import jwt

from app.config import settings
from app.core.security import decode_access_token
from app.core.users import async_get_user_by_id
from app.schemas.auth import UserPublic

_bearer = HTTPBearer(auto_error=False)


def _lire_jeton(request: Request, creds: HTTPAuthorizationCredentials | None) -> str | None:
    """Jeton de la requête : cookie `httpOnly` d'abord, en-tête `Authorization` ensuite.

    Le cookie est la voie normale du navigateur — il est inaccessible à JavaScript, donc hors de
    portée d'un script injecté dans la page. L'en-tête reste accepté pour les appels hors
    navigateur (scripts, tests, intégrations), qui ne subissent pas ce risque puisqu'il n'y a
    aucune page où injecter quoi que ce soit.
    """
    cookie = request.cookies.get(settings.auth_cookie_name)
    if cookie:
        return cookie
    if creds is not None and creds.credentials:
        return creds.credentials
    return None


async def get_current_user_optional(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> UserPublic | None:
    jeton = _lire_jeton(request, creds)
    if not jeton:
        return None
    try:
        payload = decode_access_token(jeton)
        user_id = str(payload.get("sub") or "")
        if not user_id:
            return None
        return await async_get_user_by_id(user_id)
    except jwt.PyJWTError:
        return None


async def get_current_user(
    user: UserPublic | None = Depends(get_current_user_optional),
) -> UserPublic:
    if user is None:
        raise HTTPException(status_code=401, detail="Authentification requise.")
    return user
