"""Recherche dans le corpus : embedding de la question, tri par pertinence PONDÉRÉE par l'autorité.

Une source de rang légal (loi, décret) prime sur la doctrine, qui prime sur un guide : à
similarité comparable, c'est la source la plus opposable qui remonte.
"""

from __future__ import annotations

import asyncio

from app.config import settings
from app.rag import vectorstore
from app.rag.embeddings import EmbeddingIndisponible, embed_one
from app.rag.ingest import is_stale

# 1 = loi/décret, 2 = doctrine officielle (BOFiP, URSSAF), 3 = guide / source privée.
_POIDS_AUTORITE = {1: 1.0, 2: 0.9, 3: 0.75}


async def search(question: str, k: int = 8, concerne: str | None = None) -> dict:
    corpus_vide = await asyncio.to_thread(vectorstore.count) == 0
    if corpus_vide:
        return {"hits": [], "corpus_vide": True, "au_moins_un_perime": False}

    try:
        vecteur = await embed_one(question)
    except EmbeddingIndisponible:
        # Sans embedding, on ne devine pas : mieux vaut aucun extrait qu'un extrait au hasard.
        return {"hits": [], "corpus_vide": False, "au_moins_un_perime": False,
                "recherche_indisponible": True}

    bruts = await asyncio.to_thread(vectorstore.query, vecteur, k, concerne)

    hits = []
    for doc in bruts:
        similarite = 1 - doc["distance"]
        poids = _POIDS_AUTORITE.get(int(doc.get("autorite", 3)), 0.7)
        hits.append({
            "texte": doc.get("texte"),
            "titre": doc.get("titre"),
            "source": doc.get("source"),
            "url": doc.get("url"),
            "type_doc": doc.get("type_doc"),
            "date_publication": doc.get("date_publication"),
            "similarite": round(similarite, 3),
            "score": round(similarite * poids, 3),
            "perime": is_stale(doc, settings.freshness_max_days),
        })

    hits.sort(key=lambda h: h["score"], reverse=True)
    return {"hits": hits, "corpus_vide": False,
            "au_moins_un_perime": any(h["perime"] for h in hits)}
