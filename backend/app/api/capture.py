"""API router for the capture agent (invoice / transfer document analysis)."""

from __future__ import annotations

import asyncio
import base64
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app.agents.capture.app import nodes
from app.agents.capture.app.schemas import (
    AnalyzeResponse,
    AnswerResponse,
    BankTransfer,
    Invoice,
    InvoiceListItem,
    PendingQuestion,
    QAResponse,
    Status,
    VirementListItem,
)
from app.api.deps import get_current_user
from app.core.users import users_collection
from app.schemas.auth import UserPublic
from app.services.capture_runtime import get_runtime, resume_graph, run_graph

router = APIRouter(prefix="/api/capture", tags=["capture"])


class CaptureAnswerBody(BaseModel):
    thread_id: str
    answer: str = Field(min_length=1)


class CaptureQABody(BaseModel):
    document_id: str
    question: str = Field(min_length=1)


class DocumentMessage(BaseModel):
    role: str
    content: str


def _interrupts(graph, config) -> tuple[Any, list[Any]]:
    snap = graph.get_state(config)
    ints = [i for t in snap.tasks for i in (getattr(t, "interrupts", None) or [])]
    return snap, ints


def _build_analyze_response(graph, config, thread_id: str) -> AnalyzeResponse:
    snap, ints = _interrupts(graph, config)
    values: dict[str, Any] = snap.values or {}
    document_id = values.get("document_id")

    if ints:
        payload = ints[0].value or {}
        pending = PendingQuestion(
            type=payload.get("type"),
            question=payload.get("question", ""),
            field=payload.get("field"),
            suggestions=payload.get("suggestions"),
            existing_invoice=payload.get("existing_invoice"),
            new_invoice=payload.get("new_invoice"),
        )
        return AnalyzeResponse(
            status=Status.en_attente_utilisateur,
            thread_id=thread_id,
            document_id=document_id,
            pending=pending,
        )

    if values.get("document_type") == "virement":
        return AnalyzeResponse(
            status=Status.completed,
            thread_id=thread_id,
            document_id=document_id,
            document_type="virement",
            transfer=BankTransfer(**(values.get("virement") or {})),
            analysis=values.get("analysis"),
            incoherences=values.get("incoherences"),
            saved=values.get("saved"),
            duplicate_skipped=values.get("duplicate_skipped"),
        )

    payment: dict[str, Any] = values.get("payment") or {}
    return AnalyzeResponse(
        status=Status.completed,
        thread_id=thread_id,
        document_id=document_id,
        document_type="facture",
        invoice=Invoice(**(values.get("invoice") or {})),
        analysis=values.get("analysis"),
        expense_category=values.get("expense_category"),
        incoherences=values.get("incoherences"),
        paid=payment.get("paid"),
        payment_date=payment.get("payment_date"),
        payment_days_until=nodes.days_until(payment.get("payment_date")),
        saved=values.get("saved"),
        duplicate_skipped=values.get("duplicate_skipped"),
    )


def _sync_user_capture_context(user_id: str, resp: AnalyzeResponse) -> None:
    now = datetime.now(timezone.utc).isoformat()
    entry = {
        "thread_id": resp.thread_id,
        "document_id": resp.document_id,
        "status": resp.status.value if hasattr(resp.status, "value") else str(resp.status),
        "document_type": resp.document_type,
        "expense_category": resp.expense_category,
        "invoice_number": (resp.invoice.invoice_number if resp.invoice else None),
        "total_ttc": (resp.invoice.total_ttc if resp.invoice else None),
        "created_at": now,
    }
    users_collection().update_one(
        {"id": user_id},
        {
            "$set": {
                "agent_context.capture.last_thread_id": resp.thread_id,
                "agent_context.capture.last_document_id": resp.document_id,
                "agent_context.capture.updated_at": now,
            },
            "$push": {"agent_context.capture.history": entry},
        },
    )


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_document(
    file: UploadFile = File(...),
    activite: str | None = None,
    user: UserPublic = Depends(get_current_user),
):
    runtime = get_runtime()
    graph = runtime["graph"]
    thread_id = uuid.uuid4().hex
    config = {"configurable": {"thread_id": thread_id}}

    try:
        data = await file.read()
        if not data:
            return AnalyzeResponse(
                status=Status.erreur,
                thread_id=thread_id,
                error="Fichier vide ou illisible.",
            )

        initial: dict[str, Any] = {
            "user_id": user.id,
            "document_id": uuid.uuid4().hex,
            "filename": file.filename,
            "mime": file.content_type,
            "file_b64": base64.b64encode(data).decode("ascii"),
            "messages": [],
        }
        if activite:
            initial["activite"] = activite

        await run_graph(graph, initial, config)
        resp = _build_analyze_response(graph, config, thread_id)
        await asyncio.to_thread(_sync_user_capture_context, user.id, resp)
        return resp
    except Exception as exc:
        return AnalyzeResponse(status=Status.erreur, thread_id=thread_id, error=str(exc))


@router.post("/answer", response_model=AnswerResponse)
async def answer_document(
    body: CaptureAnswerBody,
    user: UserPublic = Depends(get_current_user),
):
    runtime = get_runtime()
    graph = runtime["graph"]
    deps = runtime["deps"]
    config = {"configurable": {"thread_id": body.thread_id}}

    try:
        snap, ints = _interrupts(graph, config)
        values: dict[str, Any] = snap.values or {}

        if values.get("user_id") and values.get("user_id") != user.id:
            raise HTTPException(status_code=403, detail="Ce document ne vous appartient pas.")

        if ints:
            await resume_graph(graph, body.answer, config)
            analyze_resp = _build_analyze_response(graph, config, body.thread_id)
            await asyncio.to_thread(_sync_user_capture_context, user.id, analyze_resp)
            return AnswerResponse(
                status=analyze_resp.status,
                thread_id=body.thread_id,
                document_id=analyze_resp.document_id,
                analyze=analyze_resp,
            )

        user_id = values.get("user_id")
        document_id = values.get("document_id")
        if not user_id or not document_id:
            return AnswerResponse(
                status=Status.erreur,
                thread_id=body.thread_id,
                error="Thread inconnu ou sans document associé.",
            )

        ans = await asyncio.to_thread(
            nodes.answer_question, deps, user_id, document_id, body.answer
        )
        return AnswerResponse(
            status=Status.completed,
            thread_id=body.thread_id,
            document_id=document_id,
            answer=ans,
        )
    except HTTPException:
        raise
    except Exception as exc:
        return AnswerResponse(status=Status.erreur, thread_id=body.thread_id, error=str(exc))


@router.post("/qa", response_model=QAResponse)
async def qa_document(
    body: CaptureQABody,
    user: UserPublic = Depends(get_current_user),
):
    runtime = get_runtime()
    deps = runtime["deps"]
    try:
        ans = await asyncio.to_thread(
            nodes.answer_question, deps, user.id, body.document_id, body.question
        )
        return QAResponse(status=Status.completed, document_id=body.document_id, answer=ans)
    except Exception as exc:
        return QAResponse(status=Status.erreur, document_id=body.document_id, error=str(exc))


@router.get("/invoices", response_model=list[InvoiceListItem])
async def list_invoices(user: UserPublic = Depends(get_current_user)):
    runtime = get_runtime()
    deps = runtime["deps"]
    docs = await asyncio.to_thread(deps.db.list_invoices, user.id)
    out: list[InvoiceListItem] = []
    for d in docs:
        out.append(
            InvoiceListItem(
                document_id=d.get("document_id", ""),
                invoice=Invoice(**(d.get("invoice") or {})),
                analysis=d.get("analysis"),
                expense_category=d.get("expense_category"),
                incoherences=d.get("incoherences"),
                paid=d.get("paid"),
                payment_date=d.get("payment_date"),
                payment_days_until=nodes.days_until(d.get("payment_date")),
                created_at=d.get("created_at"),
            )
        )
    return out


@router.get("/documents/{document_id}/messages", response_model=list[DocumentMessage])
async def document_messages(document_id: str, user: UserPublic = Depends(get_current_user)):
    """Historique de conversation (chat par document), filtré par utilisateur."""
    runtime = get_runtime()
    deps = runtime["deps"]
    history = await asyncio.to_thread(deps.db.get_history, user.id, document_id)
    return [DocumentMessage(role=m.get("role", ""), content=m.get("content", "")) for m in history]


@router.get("/virements", response_model=list[VirementListItem])
async def list_virements(user: UserPublic = Depends(get_current_user)):
    runtime = get_runtime()
    deps = runtime["deps"]
    docs = await asyncio.to_thread(deps.db.list_virements, user.id)
    return [
        VirementListItem(
            document_id=d.get("document_id", ""),
            transfer=BankTransfer(**(d.get("transfer") or {})),
            analysis=d.get("analysis"),
            incoherences=d.get("incoherences"),
            created_at=d.get("created_at"),
        )
        for d in docs
    ]
