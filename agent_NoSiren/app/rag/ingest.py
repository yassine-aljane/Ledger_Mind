"""Ingestion de documents dans le corpus : nettoyage, chunking par article, embedding, upsert."""
from __future__ import annotations

import hashlib
import re
from datetime import date, datetime

from app.llm.mistral_client import embed
from app.rag import vectorstore

# Découpe par article juridique français, sinon fallback par paquets de paragraphes.
ARTICLE_RE = re.compile(r"(Article\s+[\dLRD\.\-]+|Art\.\s*[\dLRD\.\-]+)", re.IGNORECASE)


def _chunk(text: str, max_len: int = 1600) -> list[str]:
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    idx = [m.start() for m in ARTICLE_RE.finditer(text)]
    chunks: list[str] = []
    if len(idx) > 1:
        for i, start in enumerate(idx):
            end = idx[i + 1] if i + 1 < len(idx) else len(text)
            piece = text[start:end].strip()
            if len(piece) > 80:
                chunks.append(piece[: max_len * 2])
    else:
        for i in range(0, len(text), max_len):
            chunks.append(text[i : i + max_len])
    return chunks


def ingest_document(
    text: str,
    *,
    source: str,          # ex "Légifrance", "BOFiP", "URSSAF"
    titre: str,
    url: str,
    type_doc: str,        # "loi" | "doctrine" | "actualite" | "guide"
    autorite: int = 3,    # 1 loi/décret > 2 doctrine officielle > 3 guide/privé
    date_publication: str | None = None,   # ISO "YYYY-MM-DD"
    date_effet: str | None = None,
    concerne: list[str] | None = None,     # ["influenceur","freelance","tous"]
) -> int:
    """Ingère un document ; renvoie le nombre de chunks insérés."""
    today = date.today().isoformat()
    chunks = _chunk(text)
    if not chunks:
        return 0

    embeddings = embed(chunks, is_query=False)
    ids, metas = [], []
    base = hashlib.sha1(f"{url}|{titre}".encode()).hexdigest()[:12]
    concerne_str = ",".join(concerne or ["tous"])

    for i, chunk in enumerate(chunks):
        ids.append(f"{base}_{i}")
        metas.append(
            {
                "source": source,
                "titre": titre,
                "url": url,
                "type_doc": type_doc,
                "autorite": autorite,
                "date_publication": date_publication or today,
                "date_effet": date_effet or (date_publication or today),
                "date_verification": today,
                "concerne": concerne_str,
            }
        )

    vectorstore.upsert(ids, embeddings, chunks, metas)
    return len(chunks)


def is_stale(meta: dict, max_days: int) -> bool:
    try:
        d = datetime.fromisoformat(meta.get("date_verification", "")).date()
        return (date.today() - d).days > max_days
    except Exception:
        return True
