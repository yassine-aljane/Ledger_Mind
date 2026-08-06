"""Indexe DOCUMENTATION_RAG_LEDGERMIND.md dans le namespace Pinecone du chatbot produit.

Depuis la racine du dépôt :
    python -m backend.scripts.index_product_knowledge
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# Le backend utilise le package `app`. Cet ajout rend la commande exécutable
# depuis la racine du dépôt, comme les autres scripts du projet.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings
from app.product_rag.knowledge import DOCUMENT_PATH, load_product_chunks
from app.product_rag import pinecone_store
from app.rag.embeddings import embed


async def main() -> None:
    if not pinecone_store.configured():
        raise RuntimeError(
            "PINECONE_API_KEY est absente de backend/.env. "
            "Ajoutez-la avant de lancer l'indexation."
        )
    chunks = load_product_chunks()
    print(f"Documentation : {DOCUMENT_PATH}")
    print(f"Questions/réponses : {len(chunks)}")
    vectors = await embed([chunk.text for chunk in chunks])
    if not vectors:
        raise RuntimeError("Mistral n'a produit aucun embedding.")
    pinecone_store.ensure_index(len(vectors[0]))
    payload = [
        {"id": chunk.id, "values": vector, "metadata": chunk.metadata()}
        for chunk, vector in zip(chunks, vectors, strict=True)
    ]
    count = pinecone_store.replace(payload)
    print(
        f"Indexation terminée : {count} vecteurs dans "
        f"{settings.pinecone_index_name}/{settings.pinecone_namespace}"
    )


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    asyncio.run(main())
