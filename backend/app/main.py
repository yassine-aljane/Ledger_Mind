import re

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

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


_LOCALHOST_REGEX = r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"

# Méthodes qui modifient un état : ce sont elles, et elles seules, qu'une requête forgée depuis un
# autre site chercherait à déclencher. Une lecture ne présente pas le même risque.
_METHODES_ECRITURE = {"POST", "PUT", "PATCH", "DELETE"}

# Calculées une fois : la liste est figée au démarrage, la relire à chaque requête ne servirait
# qu'à reparser la configuration.
_ORIGINES = frozenset(_cors_origins())
_LOCALHOST = re.compile(_LOCALHOST_REGEX)


def _origine_autorisee(origine: str) -> bool:
    return origine in _ORIGINES or _LOCALHOST.match(origine) is not None


@app.middleware("http")
async def verifier_origine(request: Request, call_next):
    """Rejette les écritures venues d'une origine non autorisée (protection CSRF).

    Depuis que la session vit dans un cookie, le navigateur l'attache TOUT SEUL à chaque appel —
    y compris à un appel déclenché par un site malveillant. C'est le revers du cookie : il
    supprime le vol de jeton par script injecté, mais ouvre la porte à la requête forgée.

    L'attribut `SameSite` est la première barrière ; elle disparaît si le déploiement impose
    `samesite=none` (front et back sur des domaines différents). Cette vérification, elle, tient
    dans les deux cas et ne coûte rien : le navigateur pose `Origin` sur toute requête d'écriture
    et interdit à une page de le falsifier.

    Une requête sans `Origin` n'est pas bloquée : ce sont les appels hors navigateur (scripts,
    tests, `curl`), qui ne peuvent pas être forgés à l'insu de quelqu'un — il n'y a pas de session
    ambiante à détourner.
    """
    if request.method in _METHODES_ECRITURE:
        origine = request.headers.get("origin")
        if origine and not _origine_autorisee(origine):
            return JSONResponse(status_code=403, content={"detail": "Origine non autorisée."})
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    # Vite may bind :3001/:5173/… when :3000 is taken; browsers also treat
    # localhost and 127.0.0.1 as different origins.
    allow_origin_regex=_LOCALHOST_REGEX,
    allow_methods=["*"],
    allow_headers=["*"],
    # Sans ceci, le navigateur refuse d'envoyer le cookie de session sur un appel inter-origine —
    # front et back n'étant pas sur le même port, c'est le cas de TOUS les appels authentifiés.
    # À noter : `allow_credentials` est incompatible avec une origine `*`, d'où la liste explicite
    # ci-dessus, qu'il faut tenir à jour en production (FRONTEND_ORIGIN).
    allow_credentials=True,
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
