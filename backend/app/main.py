from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.api import auth, guidance, orchestrator, verification

app = FastAPI(title="LedgerMind Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(verification.router)
app.include_router(orchestrator.router)
# Espace « pas encore immatriculé » : chat conversationnel, mémoire, feuille de route.
app.include_router(guidance.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
