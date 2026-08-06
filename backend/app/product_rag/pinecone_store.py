"""Accès Pinecone du corpus produit, séparé du corpus fiscal de LedgerMind."""

from __future__ import annotations

import time
from typing import Any

from app.config import settings


class ProductKnowledgeUnavailable(RuntimeError):
    """Pinecone n'est pas configuré, pas encore indexé ou momentanément inaccessible."""


def configured() -> bool:
    return bool(settings.pinecone_api_key)


def _pinecone():
    if not settings.pinecone_api_key:
        raise ProductKnowledgeUnavailable("PINECONE_API_KEY n'est pas configurée.")
    try:
        from pinecone import Pinecone
    except ImportError as exc:
        raise ProductKnowledgeUnavailable(
            "Le paquet pinecone n'est pas installé. Exécutez pip install -r requirements.txt."
        ) from exc
    return Pinecone(api_key=settings.pinecone_api_key)


def index():
    try:
        return _pinecone().Index(settings.pinecone_index_name)
    except ProductKnowledgeUnavailable:
        raise
    except Exception as exc:  # noqa: BLE001 — erreur fournisseur requalifiée pour l'API
        raise ProductKnowledgeUnavailable(str(exc)) from exc


def ensure_index(dimension: int) -> None:
    """Crée un index dense serverless si absent et vérifie la dimension s'il existe."""
    pc = _pinecone()
    try:
        names = set(pc.list_indexes().names())
        if settings.pinecone_index_name not in names:
            from pinecone import ServerlessSpec

            pc.create_index(
                name=settings.pinecone_index_name,
                dimension=dimension,
                metric="cosine",
                spec=ServerlessSpec(
                    cloud=settings.pinecone_cloud,
                    region=settings.pinecone_region,
                ),
                deletion_protection="disabled",
                tags={"application": "ledgermind", "corpus": "product-docs"},
            )
            # La création serverless est asynchrone côté Pinecone. Attendre ici
            # évite que le premier upsert parte avant que l'hôte soit disponible.
            for _ in range(60):
                description = pc.describe_index(settings.pinecone_index_name)
                status = getattr(description, "status", None)
                if status is None and isinstance(description, dict):
                    status = description.get("status")
                ready = getattr(status, "ready", None)
                if ready is None and isinstance(status, dict):
                    ready = status.get("ready")
                if ready:
                    return
                time.sleep(1)
            raise ProductKnowledgeUnavailable(
                f"L'index {settings.pinecone_index_name} n'est pas prêt après 60 secondes."
            )

        description = pc.describe_index(settings.pinecone_index_name)
        actual = getattr(description, "dimension", None)
        if actual is None and isinstance(description, dict):
            actual = description.get("dimension")
        if actual is not None and int(actual) != dimension:
            raise ProductKnowledgeUnavailable(
                f"L'index {settings.pinecone_index_name} utilise {actual} dimensions, "
                f"mais {settings.embedding_model} en produit {dimension}."
            )
    except ProductKnowledgeUnavailable:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ProductKnowledgeUnavailable(str(exc)) from exc


def replace(vectors: list[dict[str, Any]]) -> int:
    """Remplace uniquement le namespace produit ; aucun autre namespace n'est touché."""
    target = index()
    try:
        try:
            target.delete(delete_all=True, namespace=settings.pinecone_namespace)
        except Exception as exc:  # noqa: BLE001 — le SDK v9 renvoie 404 au premier chargement
            status = getattr(exc, "status_code", None) or getattr(exc, "status", None)
            namespace_absent = (
                status == 404
                or "[404]" in str(exc)
                or exc.__class__.__name__ == "NotFoundError"
            )
            if not namespace_absent:
                raise
        for start in range(0, len(vectors), 100):
            target.upsert(
                vectors=vectors[start : start + 100],
                namespace=settings.pinecone_namespace,
            )
        return len(vectors)
    except Exception as exc:  # noqa: BLE001
        raise ProductKnowledgeUnavailable(str(exc)) from exc


def query(vector: list[float], top_k: int | None = None) -> list[dict[str, Any]]:
    try:
        response = index().query(
            vector=vector,
            top_k=top_k or settings.product_rag_top_k,
            namespace=settings.pinecone_namespace,
            include_metadata=True,
            include_values=False,
        )
    except ProductKnowledgeUnavailable:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ProductKnowledgeUnavailable(str(exc)) from exc

    matches = getattr(response, "matches", None)
    if matches is None and isinstance(response, dict):
        matches = response.get("matches", [])
    normalized: list[dict[str, Any]] = []
    for match in matches or []:
        if isinstance(match, dict):
            metadata = match.get("metadata") or {}
            score = match.get("score") or 0.0
            match_id = match.get("id") or ""
        else:
            metadata = getattr(match, "metadata", {}) or {}
            score = getattr(match, "score", 0.0) or 0.0
            match_id = getattr(match, "id", "") or ""
        if metadata.get("text") and float(score) >= settings.product_rag_min_score:
            normalized.append({"id": match_id, "score": float(score), "metadata": metadata})
    return normalized


def stats() -> dict[str, Any]:
    if not configured():
        return {"configured": False, "ready": False, "vectors": 0}
    try:
        response = index().describe_index_stats()
        namespaces = getattr(response, "namespaces", None)
        if namespaces is None and isinstance(response, dict):
            namespaces = response.get("namespaces", {})
        namespace = (namespaces or {}).get(settings.pinecone_namespace)
        count = 0
        if isinstance(namespace, dict):
            count = namespace.get("vector_count", 0)
        elif namespace is not None:
            count = getattr(namespace, "vector_count", 0)
        return {"configured": True, "ready": count > 0, "vectors": int(count)}
    except Exception:
        return {"configured": True, "ready": False, "vectors": 0}
