from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.api import auth, capture, guidance, orchestrator, referral, verification

app = FastAPI(title="LedgerMind Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(referral.router)
app.include_router(capture.router)
app.include_router(verification.router)
app.include_router(orchestrator.router)
# Espace « pas encore immatriculé » : chat conversationnel, mémoire, feuille de route.
app.include_router(guidance.router)


_scheduler = None


@app.on_event("startup")
async def _startup() -> None:
    """Planifie la veille réglementaire si elle est activée (désactivée par défaut).

    Elle n'est jamais sur le chemin critique : son absence ne change rien au reste de l'app.
    """
    global _scheduler
    from app.veille import scheduler

    _scheduler = scheduler.start_scheduler()


@app.get("/health")
async def health():
    return {"status": "ok"}
