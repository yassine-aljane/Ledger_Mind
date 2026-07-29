"""Embeddings du corpus fiscal — `gemini-embedding-001` via l'endpoint compatible OpenAI.

Choix d'intégration : l'agent d'origine utilisait un modèle local (sentence-transformers, ~2 Go
à télécharger) et ChromaDB. Ici on réutilise la clé Gemini déjà présente et la base MongoDB déjà
déployée : aucune dépendance lourde n'entre dans le projet, et le corpus vit avec le reste des
données.
"""

from __future__ import annotations

import asyncio
import logging
import random
import re

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


# Le palier gratuit plafonne à 100 requêtes d'embedding par minute : sur un corpus de plusieurs
# centaines de chunks, le quota est atteint en cours d'ingestion. Sans reprise, le document en
# cours est perdu et le corpus se retrouve troué — silencieusement.
_MAX_TENTATIVES = 5
_TRANSITOIRE = ("429", "resource_exhausted", "rate limit", "quota",
                "500", "502", "503", "504", "timeout", "timed out")


def _est_transitoire(exc: Exception) -> bool:
    message = str(exc).lower()
    return any(marqueur in message for marqueur in _TRANSITOIRE)


def _delai_conseille(exc: Exception) -> float | None:
    """Délai que l'API demande d'attendre (`retryDelay: '23s'` / « retry in 23.6s »)."""
    message = str(exc)
    trouve = (re.search(r"retryDelay['\"]?:\s*['\"]?(\d+(?:\.\d+)?)s", message)
              or re.search(r"retry in (\d+(?:\.\d+)?)s", message, re.IGNORECASE))
    return float(trouve.group(1)) if trouve else None


async def _embed_lot(lot: list[str]) -> list[list[float]]:
    """Un lot, avec reprise sur quota et erreurs transitoires."""
    derniere: Exception | None = None
    for tentative in range(_MAX_TENTATIVES):
        try:
            reponse = await _client.embeddings.create(
                model=settings.embedding_model, input=lot, timeout=60.0
            )
            return [item.embedding for item in reponse.data]
        except Exception as exc:  # noqa: BLE001 — requalifié ci-dessous
            derniere = exc
            if not _est_transitoire(exc) or tentative == _MAX_TENTATIVES - 1:
                break
            # On respecte le délai annoncé par l'API quand il est fourni ; sinon backoff
            # exponentiel. Le jitter évite que plusieurs ingestions repartent en rafale.
            attente = _delai_conseille(exc) or min(2.0 * (2**tentative), 30.0)
            logger.info("Quota d'embeddings atteint — reprise dans %.1fs (tentative %d/%d)",
                        attente, tentative + 1, _MAX_TENTATIVES)
            await asyncio.sleep(attente + random.uniform(0, 1.0))

    logger.warning("Embeddings indisponibles : %s", derniere)
    raise EmbeddingIndisponible(str(derniere)) from derniere


async def embed(textes: list[str]) -> list[list[float]]:
    """Vectorise une liste de textes, par lots, en préservant l'ordre d'entrée."""
    if not textes:
        return []
    vecteurs: list[list[float]] = []
    for debut in range(0, len(textes), _BATCH):
        lot = [t.replace("\n", " ").strip() or " " for t in textes[debut : debut + _BATCH]]
        vecteurs.extend(await _embed_lot(lot))
    return vecteurs


async def embed_one(texte: str) -> list[float]:
    return (await embed([texte]))[0]


def embed_sync(textes: list[str]) -> list[list[float]]:
    """Variante bloquante, pour les scripts d'ingestion hors boucle d'événements."""
    return asyncio.run(embed(textes))
