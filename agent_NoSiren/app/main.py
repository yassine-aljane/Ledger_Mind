"""Agent 1 — Accès / Onboarding (LedgerMind, cadre fiscal français).

Deux agents :
  • /guidance      : chatbot de guidance pour non-immatriculés + roadmap (JSON checklist + PDF)
  • /ask           : agent pédagogique Q&A fiscal (RAG), accessible aussi aux non-immatriculés
Plus la veille dynamique :
  • /veille/run    : déclenche un cycle de veille (Légifrance + scraping)
  • /veille/last   : dernier rapport de veille
"""
from __future__ import annotations

import logging

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.agents import conversation, guidance, pedagogue
from app.memory import store
from app.mcp import client as mcp
from app.models.schemas import (AskRequest, ChatRequest, GuidanceRequest, PatchProfilRequest,
                                 RenameRequest, RoadmapRequest, RoadmapStateRequest)
from app.rag import vectorstore
from app.rag.ingest import ingest_document
from app.roadmap.pdf import roadmap_to_pdf
from app.veille import scheduler

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="LedgerMind — Agent 1 (Accès / Onboarding)", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_sched = None


@app.on_event("startup")
async def _startup():
    global _sched
    _sched = scheduler.start_scheduler()


@app.get("/health")
async def health():
    return {"status": "ok", "corpus_chunks": vectorstore.count()}


# ---------- Agent pédagogique (Q&A RAG) ----------
@app.post("/ask")
async def ask(req: AskRequest):
    return await pedagogue.answer(req.question, concerne=req.concerne)


# ---------- Agent de guidance (non-immatriculés) ----------
@app.post("/guidance")
async def guidance_endpoint(req: GuidanceRequest):
    profil = req.profil.model_dump() if req.profil else None
    return await guidance.guidance_chat(req.message, profil=profil)


# ---------- Agent conversationnel unifié ----------
@app.post("/chat")
async def chat_endpoint(req: ChatRequest):
    """Réponse unifiée, sourcée et mémorisée ; le mode = l'interface (guidance/pedagogue)."""
    action = req.action.model_dump() if req.action else None
    return await conversation.respond(req.session_id, req.message, req.mode,
                                      action=action, uid=req.uid or "demo")


@app.get("/conversations")
async def list_conversations(uid: str = "demo", type: str | None = None):
    """Liste les conversations d'un utilisateur, filtrées par type d'interface (chantier 5.2/5.3)."""
    return {"conversations": store.list_sessions(uid, type)}


@app.get("/chat/{session_id}")
async def chat_history(session_id: str):
    meta = store.session_meta(session_id)
    if not meta:
        raise HTTPException(status_code=404, detail="Session introuvable ou expirée.")
    etat = store.get_roadmap(session_id) or {}
    return {"session_id": session_id, "type": meta["type"], "title": meta["title"],
            "messages": store.history(session_id), "profil": store.get_profil_by_session(session_id),
            "roadmap": etat.get("roadmap"), "checked": etat.get("checked", {})}


@app.delete("/chat/{session_id}")
async def delete_chat(session_id: str):
    if not store.delete_session(session_id):
        raise HTTPException(status_code=404, detail="Session introuvable ou expirée.")
    return {"session_id": session_id, "supprimee": True}


@app.patch("/chat/{session_id}/rename")
async def rename_chat(session_id: str, req: RenameRequest):
    if not store.rename_session(session_id, req.title):
        raise HTTPException(status_code=404, detail="Session introuvable ou expirée.")
    return {"session_id": session_id, "title": req.title}


# --- Roadmap : état coché persisté côté serveur (chantier 6) ---
@app.put("/roadmap/state/{session_id}")
async def save_roadmap_state(session_id: str, req: RoadmapStateRequest):
    store.save_roadmap(session_id, checked=req.checked)
    return {"session_id": session_id, "checked": req.checked}


@app.get("/roadmap/state/{session_id}")
async def get_roadmap_state(session_id: str):
    etat = store.get_roadmap(session_id) or {}
    return {"session_id": session_id, "roadmap": etat.get("roadmap"), "checked": etat.get("checked", {})}


# --- Profil PARTAGÉ par utilisateur (uid), connu des deux interfaces ---
@app.get("/profil/{uid}")
async def get_profile(uid: str):
    return {"uid": uid, "profil": store.get_profil(uid)}


@app.patch("/profil/{uid}")
async def patch_profile(uid: str, req: PatchProfilRequest):
    return {"uid": uid, "profil": store.patch_profil(uid, req.model_dump())}


@app.delete("/profil/{uid}/{field}")
async def clear_profile_field(uid: str, field: str):
    """Efface (remet à NULL) un champ du profil — effacement manuel côté panneau."""
    return {"uid": uid, "profil": store.clear_profil_field(uid, field)}


@app.post("/roadmap")
async def roadmap_endpoint(req: RoadmapRequest):
    """Renvoie la roadmap structurée (pour la checklist interactive de l'UI)."""
    return guidance.build_roadmap(req.profil.model_dump())


@app.post("/roadmap/pdf")
async def roadmap_pdf_endpoint(req: RoadmapRequest):
    """Renvoie la roadmap en PDF téléchargeable.

    Priorité à la roadmap PERSISTÉE de la session (celle affichée dans le chat) : le PDF est ainsi
    STRICTEMENT identique à ce que voit l'utilisateur, y compris le parcours retenu (société,
    bascule avec choix, etc.). À défaut de session ou de roadmap stockée, on la reconstruit depuis
    le profil transmis (compat descendante).
    """
    roadmap = None
    if req.session_id:
        etat = store.get_roadmap(req.session_id) or {}
        roadmap = etat.get("roadmap")
    if roadmap is None:
        roadmap = guidance.build_roadmap(req.profil.model_dump())
    pdf = roadmap_to_pdf(roadmap)
    return StreamingResponse(
        iter([pdf]),
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=roadmap_micro_entreprise.pdf"},
    )


# ---------- Veille dynamique ----------
@app.post("/veille/run")
async def veille_run():
    return await scheduler.run_veille()


@app.get("/veille/last")
async def veille_last():
    return scheduler.dernier_rapport()


# ---------- MCP : découverte + ingestion à la demande ----------
@app.get("/mcp/tools")
async def mcp_tools():
    """Liste les outils exposés par chaque serveur MCP de sources."""
    out = {}
    for server in ("legifrance", "bofip", "web-sources", "entreprises", "docs-officiels"):
        try:
            out[server] = await mcp.list_tools(server)
        except Exception as exc:  # noqa: BLE001
            out[server] = {"erreur": str(exc)}
    return out


@app.post("/mcp/ingest-bofip")
async def mcp_ingest_bofip(requete: str, limite: int = 5):
    """Recherche BOFiP via MCP et ingère les documents trouvés dans le corpus."""
    res = await mcp.call_tool("bofip", "bofip_search", {"requete": requete, "limite": limite})
    total = 0
    for d in res.get("documents", []):
        if d.get("extrait"):
            total += ingest_document(
                text=d["extrait"], source="BOFiP", titre=d["titre"], url=d["url"],
                type_doc="doctrine", autorite=2, concerne=["tous"],
            )
    return {"documents_trouves": len(res.get("documents", [])), "chunks_ingeres": total}
