"""Embeddings du corpus fiscal — `gemini-embedding-001` via l'endpoint compatible OpenAI.

Choix d'intégration : l'agent d'origine utilisait un modèle local (sentence-transformers, ~2 Go
à télécharger) et ChromaDB. Ici on réutilise la clé Gemini déjà présente et la base MongoDB déjà
déployée : aucune dépendance lourde n'entre dans le projet, et le corpus vit avec le reste des
données.
"""

from __future__ import annotations

import asyncio
import logging

from openai import AsyncOpenAI

from app.config import settings

logger = logging.getLogger(__name__)

_client = AsyncOpenAI(
    api_key=settings.gemini_api_key,
    base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
)

# Taille de lot : au-delà, l'API rejette la requête. Les documents sont ingérés par paquets.
_BATCH = 32


class EmbeddingIndisponible(RuntimeError):
    """L'API d'embeddings n'a pas répondu — l'appelant décide s'il dégrade ou s'il propage."""


async def embed(textes: list[str]) -> list[list[float]]:
    """Vectorise une liste de textes, par lots, en préservant l'ordre d'entrée."""
    if not textes:
        return []
    vecteurs: list[list[float]] = []
    for debut in range(0, len(textes), _BATCH):
        lot = [t.replace("\n", " ").strip() or " " for t in textes[debut : debut + _BATCH]]
        try:
            reponse = await _client.embeddings.create(
                model=settings.embedding_model, input=lot, timeout=60.0
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Embeddings indisponibles : %s", exc)
            raise EmbeddingIndisponible(str(exc)) from exc
        vecteurs.extend(item.embedding for item in reponse.data)
    return vecteurs


async def embed_one(texte: str) -> list[float]:
    return (await embed([texte]))[0]


def embed_sync(textes: list[str]) -> list[list[float]]:
    """Variante bloquante, pour les scripts d'ingestion hors boucle d'événements."""
    return asyncio.run(embed(textes))
