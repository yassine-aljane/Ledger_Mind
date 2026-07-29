"""Amorce le corpus fiscal en téléchargeant et ingérant les sources de `sources.yaml`.

Usage (depuis la racine du dépôt, avec le venv actif) :

    python -m backend.scripts.seed_corpus

Prérequis : `GEMINI_API_KEY` (embeddings) et `MONGO_URI` (stockage des vecteurs).
Les sources sont listées dans `data/sources.yaml` (racine du dépôt), avec pour chacune son
autorité (1 = loi/décret, 2 = doctrine officielle, 3 = guide) — c'est ce rang qui priorise les
extraits lors de la recherche.
"""

from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path

import httpx
import yaml
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.paths import SOURCES_YAML as _SOURCES  # noqa: E402
from app.rag.ingest import ingest_document  # noqa: E402

# Évite UnicodeEncodeError sur les marqueurs quand la console Windows est en cp1252.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

# En-têtes « navigateur » : débloquent les sites qui filtrent les User-Agent non navigateurs (403).
BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "fr-FR,fr;q=0.9",
    "Accept": "text/html,application/xhtml+xml",
}


def _fetch(client: httpx.Client, url: str, retries: int = 2) -> httpx.Response:
    """GET navigateur + petit retry sur erreurs réseau transitoires."""
    derniere: Exception | None = None
    for tentative in range(retries + 1):
        try:
            reponse = client.get(url, headers=BROWSER_HEADERS)
            reponse.raise_for_status()
            return reponse
        except httpx.TransportError as exc:  # pas les 4xx/5xx : inutile de réessayer
            derniere = exc
            if tentative < retries:
                time.sleep(1.5)
    raise derniere  # type: ignore[misc]


def extract_text(html: str) -> str:
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()
    principal = soup.find("main") or soup.body or soup
    return " ".join(principal.get_text(" ", strip=True).split())


async def seed() -> int:
    sources = yaml.safe_load(_SOURCES.read_text(encoding="utf-8"))["sources"]
    total = 0
    with httpx.Client(timeout=45, follow_redirects=True) as client:
        for source in sources:
            try:
                reponse = _fetch(client, source["url"])
                nb = await ingest_document(
                    text=extract_text(reponse.text),
                    source=source["source"],
                    titre=source["titre"],
                    url=source["url"],
                    type_doc=source["type_doc"],
                    autorite=source["autorite"],
                    concerne=source.get("concerne", ["tous"]),
                )
                total += nb
                print(f"[ok] {source['titre']} — {nb} chunks")
            except Exception as exc:  # noqa: BLE001
                print(f"[!!] {source['titre']} — {exc}")
    print(f"\nCorpus amorcé : {total} chunks au total.")
    return total


if __name__ == "__main__":
    asyncio.run(seed())
