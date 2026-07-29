"""API FastAPI pour tester l'agent depuis une interface web.

Lancement :
    uvicorn api:app --reload
Interface disponible sur http://127.0.0.1:8000
"""
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from orchestrator import orchestrator
from state import AgentState

app = FastAPI(title="Agent Comptable API", version="1.0.0")

# CORS ouvert : pratique pour tester l'interface depuis un autre port en dev.
# À restreindre si ce projet dépasse le stade du POC.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class GenerateRequest(BaseModel):
    ville: str = Field(..., min_length=1, examples=["Lyon"])
    demande: str = Field(..., min_length=1)
    nom: str = Field(..., min_length=1)
    statut: str = Field(..., min_length=1)
    situation: str = Field(..., min_length=1)


class EmailResult(BaseModel):
    destinataire: str
    email: Optional[str]
    objet: str
    corps: str
    statut: str


class GenerateResponse(BaseModel):
    status: str  # "termine" | "echec"
    error: Optional[str] = None
    emails: List[EmailResult] = []


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/generate", response_model=GenerateResponse)
def generate(req: GenerateRequest):
    initial_state: AgentState = {
        "ville": req.ville,
        "demande": req.demande,
        "user_info": {
            "nom": req.nom,
            "statut": req.statut,
            "situation_fiscale": req.situation,
        },
        "comptables": [],
        "emails_generes": [],
        "error": None,
        "status": "en_cours",
    }

    try:
        result = orchestrator.invoke(initial_state)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur interne de l'orchestrateur: {e}")

    if result.get("status") == "echec":
        return GenerateResponse(status="echec", error=result.get("error"), emails=[])

    emails = [
        EmailResult(
            destinataire=e["destinataire"],
            email=e.get("email"),
            objet=e["objet"],
            corps=e["corps"],
            statut=e["statut"],
        )
        for e in result.get("emails_generes", [])
    ]
    return GenerateResponse(status="termine", error=None, emails=emails)


# Sert l'interface web statique (index.html + assets) sur "/".
# Doit être monté APRÈS les routes /api/... pour ne pas les masquer.
STATIC_DIR = Path(__file__).parent / "static"
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")