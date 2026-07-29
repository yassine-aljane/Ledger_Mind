"""Corpus vectoriel stocké dans MongoDB (collection `corpus_chunks`).

Le corpus fiscal fait quelques milliers de chunks : la similarité cosinus est calculée en
Python sur les vecteurs chargés, ce qui évite d'ajouter une base vectorielle au projet. Le
filtrage par public (`concerne`) se fait côté Mongo, donc seul le sous-ensemble utile est chargé.

Passage à l'échelle : au-delà de ~50 000 chunks, basculer sur un index `vectorSearch`
(MongoDB Atlas) sans changer cette interface — `query()` reste le seul point d'entrée.
"""

from __future__ import annotations

import math
import threading

from pymongo import ASCENDING

from app.core.mongo import get_db

_lock = threading.Lock()
_initialized = False


def collection():
    return get_db()["corpus_chunks"]


def _ensure_schema() -> None:
    global _initialized
    if _initialized:
        return
    with _lock:
        if _initialized:
            return
        collection().create_index("chunk_id", unique=True)
        collection().create_index([("concerne", ASCENDING)])
        _initialized = True


def _cosinus(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    produit = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return produit / (na * nb)


def upsert(chunk_ids: list[str], embeddings: list[list[float]], documents: list[str],
           metadatas: list[dict]) -> None:
    _ensure_schema()
    for chunk_id, vecteur, texte, meta in zip(chunk_ids, embeddings, documents, metadatas):
        collection().update_one(
            {"chunk_id": chunk_id},
            {"$set": {"chunk_id": chunk_id, "embedding": vecteur, "texte": texte, **meta}},
            upsert=True,
        )


def query(embedding: list[float], n_results: int = 6, concerne: str | None = None) -> list[dict]:
    """Renvoie les `n_results` chunks les plus proches, chacun avec sa distance cosinus."""
    _ensure_schema()
    filtre: dict = {}
    if concerne:
        # `concerne` est une liste de publics ; "tous" concerne tout le monde.
        filtre = {"concerne": {"$in": [concerne, "tous"]}}

    resultats: list[dict] = []
    for doc in collection().find(filtre, {"_id": 0}):
        vecteur = doc.get("embedding") or []
        similarite = _cosinus(embedding, vecteur)
        doc.pop("embedding", None)
        resultats.append({**doc, "distance": 1.0 - similarite})

    resultats.sort(key=lambda d: d["distance"])
    return resultats[:n_results]


def count() -> int:
    _ensure_schema()
    return collection().count_documents({})


def vider() -> int:
    """Vide le corpus (réingestion complète)."""
    _ensure_schema()
    return collection().delete_many({}).deleted_count
