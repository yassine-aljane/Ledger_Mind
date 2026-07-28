"""Amorce le corpus RAG en téléchargeant et ingérant les sources de data/sources.yaml.

Usage :  python -m scripts.seed_corpus
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

import httpx
import yaml
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.rag.ingest import ingest_document  # noqa: E402

# Évite UnicodeEncodeError sur les marqueurs ✓/✗ quand la console Windows est en cp1252.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

# En-têtes "navigateur" : débloquent les sites qui filtrent les User-Agent non navigateurs (403).
BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "fr-FR,fr;q=0.9",
    "Accept": "text/html,application/xhtml+xml",
}


def _fetch(client: httpx.Client, url: str, retries: int = 2) -> httpx.Response:
    """GET navigateur + petit retry sur erreurs réseau transitoires (server disconnected, timeout)."""
    last_exc: Exception | None = None
    for tentative in range(retries + 1):
        try:
            r = client.get(url, headers=BROWSER_HEADERS)
            r.raise_for_status()
            return r
        except httpx.TransportError as exc:  # pas les 4xx/5xx : inutile de réessayer
            last_exc = exc
            if tentative < retries:
                time.sleep(1.5)
    raise last_exc  # type: ignore[misc]


def extract_text(html: str) -> str:
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()
    main = soup.find("main") or soup.body or soup
    return " ".join(main.get_text(" ", strip=True).split())


def main():
    sources = yaml.safe_load(Path("data/sources.yaml").read_text(encoding="utf-8"))["sources"]
    total = 0
    with httpx.Client(timeout=45, follow_redirects=True) as client:
        for s in sources:
            try:
                r = _fetch(client, s["url"])
                texte = extract_text(r.text)
                n = ingest_document(
                    text=texte,
                    source=s["source"],
                    titre=s["titre"],
                    url=s["url"],
                    type_doc=s["type_doc"],
                    autorite=s["autorite"],
                    concerne=s.get("concerne", ["tous"]),
                )
                total += n
                print(f"✓ {s['titre']} — {n} chunks")
            except Exception as exc:  # noqa: BLE001
                print(f"✗ {s['titre']} — {exc}")
    print(f"\nCorpus amorcé : {total} chunks au total.")


if __name__ == "__main__":
    main()
