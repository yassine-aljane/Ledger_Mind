"""FastAPI auth dependencies."""

from __future__ import annotations

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import jwt

from app.core.security import decode_access_token
from app.core.users import async_get_user_by_id
from app.schemas.auth import UserPublic

_bearer = HTTPBearer(auto_error=False)


async def get_current_user_optional(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> UserPublic | None:
    if creds is None or not creds.credentials:
        return None
    try:
        payload = decode_access_token(creds.credentials)
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
