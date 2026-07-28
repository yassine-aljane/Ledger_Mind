"""Base vectorielle ChromaDB embarquée (persistée sur disque, aucun serveur requis)."""
from __future__ import annotations

import chromadb

from app.config import settings

_client = None
_collection = None


def get_collection():
    global _client, _collection
    if _collection is None:
        _client = chromadb.PersistentClient(path=settings.chroma_dir)
        _collection = _client.get_or_create_collection(
            name=settings.chroma_collection,
            metadata={"hnsw:space": "cosine"},
        )
    return _collection


def upsert(ids, embeddings, documents, metadatas):
    get_collection().upsert(
        ids=ids, embeddings=embeddings, documents=documents, metadatas=metadatas
    )


def query(embedding, n_results: int = 6, where: dict | None = None):
    return get_collection().query(
        query_embeddings=[embedding],
        n_results=n_results,
        where=where,
        include=["documents", "metadatas", "distances"],
    )


def count() -> int:
    return get_collection().count()
