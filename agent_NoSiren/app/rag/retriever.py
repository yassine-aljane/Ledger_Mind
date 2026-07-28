"""Recherche dans le corpus : embedding de la question, tri par pertinence + autorité, fraîcheur."""
from __future__ import annotations

from app.config import settings
from app.llm.mistral_client import embed
from app.rag import vectorstore
from app.rag.ingest import is_stale


def search(question: str, k: int = 30, concerne: str | None = None) -> dict:
    q_emb = embed([question], is_query=True)[0]
    where = {"concerne": {"$in": [concerne, "tous"]}} if concerne else None
    res = vectorstore.query(q_emb, n_results=k, where=where)

    docs = res.get("documents", [[]])[0]
    metas = res.get("metadatas", [[]])[0]
    dists = res.get("distances", [[]])[0]

    hits = []
    for doc, meta, dist in zip(docs, metas, dists):
        # score combiné : similarité (1-distance cosine) pondérée par l'autorité de la source
        similarite = 1 - dist
        poids_autorite = {1: 1.0, 2: 0.9, 3: 0.75}.get(int(meta.get("autorite", 3)), 0.7)
        hits.append(
            {
                "texte": doc,
                "titre": meta.get("titre"),
                "source": meta.get("source"),
                "url": meta.get("url"),
                "type_doc": meta.get("type_doc"),
                "date_publication": meta.get("date_publication"),
                "similarite": round(similarite, 3),
                "score": round(similarite * poids_autorite, 3),
                "perime": is_stale(meta, settings.freshness_max_days),
            }
        )

    hits.sort(key=lambda h: h["score"], reverse=True)
    return {
        "hits": hits,
        "corpus_vide": vectorstore.count() == 0,
        "au_moins_un_perime": any(h["perime"] for h in hits),
    }
