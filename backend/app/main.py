from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.api import auth, verification, orchestrator

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


@app.get("/health")
async def health():
    return {"status": "ok"}
