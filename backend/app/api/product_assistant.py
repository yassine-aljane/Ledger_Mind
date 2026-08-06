"""API publique du chatbot RAG qui présente LedgerMind sur la landing page."""

from __future__ import annotations

import asyncio
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.product_rag import agent, pinecone_store

router = APIRouter(prefix="/api/product-assistant", tags=["product-assistant"])


class HistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=2000)


class ProductChatRequest(BaseModel):
    question: str = Field(min_length=2, max_length=800)
    history: list[HistoryMessage] = Field(default_factory=list, max_length=10)


class ProductSource(BaseModel):
    title: str
    section: str = ""
    score: float


class ProductChatResponse(BaseModel):
    answer: str
    sources: list[ProductSource]


@router.get("/status")
async def status():
    return await asyncio.to_thread(pinecone_store.stats)


@router.post("/chat", response_model=ProductChatResponse)
async def chat(payload: ProductChatRequest):
    try:
        return await agent.answer(
            payload.question.strip(),
            [message.model_dump() for message in payload.history],
        )
    except pinecone_store.ProductKnowledgeUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail="La base d'aide LedgerMind n'est pas encore disponible. Vérifiez Pinecone et l'indexation.",
        ) from exc
    except Exception as exc:  # noqa: BLE001 — le widget public reçoit un message stable
        raise HTTPException(
            status_code=503,
            detail="Le chatbot LedgerMind est momentanément indisponible. Réessayez dans un instant.",
        ) from exc
