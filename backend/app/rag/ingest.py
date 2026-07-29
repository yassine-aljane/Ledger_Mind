"""Ingestion dans le corpus : découpe par article juridique, embedding, upsert.

Chaque chunk porte sa provenance (`source`, `url`), son autorité (loi > doctrine > guide) et ses
dates : c'est ce qui permet à l'agent pédagogique de citer ses sources et d'avertir quand une
information risque d'être périmée.
"""

from __future__ import annotations

import hashlib
import re
from datetime import date, datetime

from app.rag import vectorstore
from app.rag.embeddings import embed

# Découpe par article juridique français, sinon repli par paquets de paragraphes.
ARTICLE_RE = re.compile(r"(Article\s+[\dLRD\.\-]+|Art\.\s*[\dLRD\.\-]+)", re.IGNORECASE)


def chunk(text: str, max_len: int = 1600) -> list[str]:
    text = re.sub(r"\n{3,}", "\n\n", text or "").strip()
    if not text:
        return []
    positions = [m.start() for m in ARTICLE_RE.finditer(text)]
    morceaux: list[str] = []
    if len(positions) > 1:
        for i, debut in enumerate(positions):
            fin = positions[i + 1] if i + 1 < len(positions) else len(text)
            piece = text[debut:fin].strip()
            if len(piece) > 80:
                morceaux.append(piece[: max_len * 2])
    else:
        for i in range(0, len(text), max_len):
            morceaux.append(text[i : i + max_len])
    return morceaux


async def ingest_document(
    text: str,
    *,
    source: str,          # "Légifrance", "BOFiP", "URSSAF"…
    titre: str,
    url: str,
    type_doc: str,        # "loi" | "doctrine" | "actualite" | "guide"
    autorite: int = 3,    # 1 loi/décret > 2 doctrine officielle > 3 guide/privé
    date_publication: str | None = None,   # ISO "YYYY-MM-DD"
    date_effet: str | None = None,
    concerne: list[str] | None = None,     # ["influenceur","freelance","tous"]
) -> int:
    """Ingère un document ; renvoie le nombre de chunks insérés."""
    aujourdhui = date.today().isoformat()
    morceaux = chunk(text)
    if not morceaux:
        return 0

    vecteurs = await embed(morceaux)
    base = hashlib.sha1(f"{url}|{titre}".encode()).hexdigest()[:12]
    concerne_str = ",".join(concerne or ["tous"])

    ids, metas = [], []
    for i, _ in enumerate(morceaux):
        ids.append(f"{base}_{i}")
        metas.append({
            "source": source,
            "titre": titre,
            "url": url,
            "type_doc": type_doc,
            "autorite": autorite,
            "date_publication": date_publication or aujourdhui,
            "date_effet": date_effet or (date_publication or aujourdhui),
            "date_verification": aujourdhui,
            "concerne": concerne_str,
        })

    vectorstore.upsert(ids, vecteurs, morceaux, metas)
    return len(morceaux)


def is_stale(meta: dict, max_days: int) -> bool:
    """Vrai si la dernière vérification de la source dépasse `max_days` (avertissement fraîcheur)."""
    try:
        verifie = datetime.fromisoformat(meta.get("date_verification", "")).date()
        return (date.today() - verifie).days > max_days
    except Exception:  # noqa: BLE001
        return True
