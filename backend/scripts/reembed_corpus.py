"""Revectorise le corpus existant après un changement de modèle d'embeddings.

À lancer quand `EMBEDDING_MODEL` change : les vecteurs d'un modèle ne sont pas comparables à
ceux d'un autre (dimensions et espace différents), et la recherche devient silencieusement
inexploitable — les extraits remontent dans un ordre arbitraire au lieu de ne rien remonter.

Le texte des chunks est déjà en base : rien n'est retéléchargé, seuls les vecteurs sont refaits.

    python -m backend.scripts.reembed_corpus
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from app.config import settings  # noqa: E402
from app.rag import vectorstore  # noqa: E402
from app.rag.embeddings import EmbeddingIndisponible, embed  # noqa: E402

_LOT = 32

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass


async def reembed() -> int:
    collection = vectorstore.collection()
    chunks = list(collection.find({}, {"_id": 0, "chunk_id": 1, "texte": 1}))
    total = len(chunks)
    if not total:
        print("Corpus vide — rien à revectoriser. Lancez d'abord seed_corpus.")
        return 0

    print(f"{total} chunks à revectoriser avec « {settings.embedding_model} »…")
    faits = 0
    for debut in range(0, total, _LOT):
        lot = chunks[debut : debut + _LOT]
        try:
            vecteurs = await embed([c.get("texte") or " " for c in lot])
        except EmbeddingIndisponible as exc:
            print(f"\n[!!] Interrompu à {faits}/{total} : {exc}")
            print("     Les chunks déjà traités sont à jour ; relancez pour reprendre.")
            return faits
        for chunk, vecteur in zip(lot, vecteurs):
            collection.update_one({"chunk_id": chunk["chunk_id"]},
                                  {"$set": {"embedding": vecteur}})
        faits += len(lot)
        print(f"  {faits}/{total}", end="\r", flush=True)

    print(f"\nCorpus revectorisé : {faits} chunks, {len(vecteurs[0])} dimensions.")
    return faits


if __name__ == "__main__":
    asyncio.run(reembed())
