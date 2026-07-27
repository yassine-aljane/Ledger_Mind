from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import verification, onboarding, orchestrator

app = FastAPI(title="LedgerMind Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_methods=["*"],
    allow_headers=["*"],
)

# DEPRECATED: superseded by orchestrator.router, kept for backward compat
app.include_router(verification.router)
# DEPRECATED: superseded by orchestrator.router, kept for backward compat
app.include_router(onboarding.router)
app.include_router(orchestrator.router)

@app.get("/health")
async def health():
    return {"status": "ok"}