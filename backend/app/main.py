from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.core import ai_act
from app.api import (
    ai_act as ai_act_api,
    auth,
    capture,
    declaration,
    echeancier,
    veille,
    expert_comptable,
    facture,
    guidance,
    orchestrator,
    product_assistant,
    rapport,
    declarations as declarations_api,
    rapport_fiscal,
    referral,
    simulation,
    verification,
)

app = FastAPI(title="LedgerMind Backend")


def _cors_origins() -> list[str]:
    """Parse FRONTEND_ORIGIN (comma-separated) and mirror localhost ↔ 127.0.0.1."""
    origins: set[str] = set()
    for raw in settings.frontend_origin.split(","):
        origin = raw.strip().rstrip("/")
        if not origin:
            continue
        origins.add(origin)
        if "://localhost" in origin:
            origins.add(origin.replace("://localhost", "://127.0.0.1", 1))
        elif "://127.0.0.1" in origin:
            origins.add(origin.replace("://127.0.0.1", "://localhost", 1))
    return sorted(origins)


@app.middleware("http")
async def marquage_ia(request, call_next):
    """Pose les en-têtes de transparence IA sur toute réponse de l'API.

    Tout ce que ce backend renvoie est produit par des systèmes d'IA. Un client qui
    consomme l'API sans passer par notre interface — intégration tierce, robot d'indexation,
    agrégateur — n'a que ces en-têtes pour savoir que la charge utile est synthétique : le
    marquage visible, lui, vit dans le frontend et ne l'atteint jamais.

    `/health` en est exclu : ce n'est pas du contenu, et un moniteur n'a rien à en déduire.
    """
    reponse = await call_next(request)
    if request.url.path != "/health":
        reponse.headers.update(ai_act.entetes_http())
    return reponse


app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    # Vite may bind :3001/:5173/… when :3000 is taken; browsers also treat
    # localhost and 127.0.0.1 as different origins.
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=["*"],
    allow_headers=["*"],
    # Sans cette liste, le navigateur masque les en-têtes de transparence au JavaScript de
    # la page : `allow_headers` couvre la requête, pas la lecture de la réponse.
    expose_headers=list(ai_act.entetes_http().keys()),
)

app.include_router(ai_act_api.router)
app.include_router(auth.router)
app.include_router(referral.router)
app.include_router(capture.router)
app.include_router(verification.router)
app.include_router(orchestrator.router)
# Espace « pas encore immatriculé » : chat conversationnel, mémoire, feuille de route.
app.include_router(guidance.router)
# Assistant public de la landing page : documentation produit Pinecone, distincte du RAG fiscal.
app.include_router(product_assistant.router)
# Espace immatriculé (SIREN vérifié) : facture, rapport d'activité, déclaration préparée,
# recherche d'expert-comptable (déclenchée depuis la déclaration).
app.include_router(facture.router)
app.include_router(rapport.router)
app.include_router(rapport_fiscal.router)
app.include_router(declarations_api.router)
app.include_router(declaration.router)
app.include_router(expert_comptable.router)
app.include_router(echeancier.router)
app.include_router(veille.router)
# Scénarios « et si… » : expose le moteur `app.agents.impots` à l'écran de simulation.
app.include_router(simulation.router)


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
