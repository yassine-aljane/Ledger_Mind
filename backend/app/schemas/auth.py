"""Auth schemas + durable agent context for intake / guidance."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class BranchAgentContext(BaseModel):
    """Snapshot of one agent branch, kept on the user for next features."""

    last_session_id: str | None = None
    phase: str | None = None
    updated_at: str | None = None
    completeness: float | None = None
    recommended_regime: str | None = None
    # Lightweight dumps — full session remains in `sessions`
    profile: dict[str, Any] | None = None
    diagnostic_profile: dict[str, Any] | None = None
    roadmap: dict[str, Any] | None = None


class UserAgentContext(BaseModel):
    intake: BranchAgentContext = Field(default_factory=BranchAgentContext)
    guidance: BranchAgentContext = Field(default_factory=BranchAgentContext)


class UserPublic(BaseModel):
    id: str
    email: str
    name: str
    created_at: str
    agent_context: UserAgentContext = Field(default_factory=UserAgentContext)


class RegisterRequest(BaseModel):
    email: str = Field(min_length=3)
    password: str = Field(min_length=6)
    name: str = Field(min_length=1)


class LoginRequest(BaseModel):
    email: str = Field(min_length=3)
    password: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    user: UserPublic
