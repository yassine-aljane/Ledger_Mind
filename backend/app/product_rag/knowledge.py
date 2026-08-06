"""Découpe la documentation produit en unités Q/R autonomes pour Pinecone."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

DOCUMENT_PATH = Path(__file__).resolve().parents[3] / "DOCUMENTATION_RAG_LEDGERMIND.md"
_QUESTION = re.compile(r"^### Question :\s*(.+?)\s*$", re.MULTILINE)
_SECTION = re.compile(r"^## (?!#)\s*(.+?)\s*$", re.MULTILINE)


@dataclass(frozen=True)
class ProductChunk:
    id: str
    question: str
    section: str
    text: str

    def metadata(self) -> dict[str, str]:
        return {
            "question": self.question,
            "section": self.section,
            "text": self.text,
            "source": "DOCUMENTATION_RAG_LEDGERMIND.md",
            "kind": "product_qa",
        }


def _section_before(document: str, position: int) -> str:
    sections = [match.group(1).strip() for match in _SECTION.finditer(document, 0, position)]
    return sections[-1] if sections else "Présentation générale"


def parse_product_document(document: str) -> list[ProductChunk]:
    """Un titre `### Question` devient exactement un chunk, réponse et mots-clés compris."""
    matches = list(_QUESTION.finditer(document or ""))
    chunks: list[ProductChunk] = []
    for index, match in enumerate(matches):
        question = match.group(1).strip()
        next_question = matches[index + 1].start() if index + 1 < len(matches) else len(document)
        next_section = _SECTION.search(document, match.end(), next_question)
        end = next_section.start() if next_section else next_question
        body = document[match.end() : end].strip()
        if not question or not body:
            continue
        section = _section_before(document, match.start())
        text = f"Question : {question}\n\n{body}"
        digest = hashlib.sha256(f"{section}|{question}".encode("utf-8")).hexdigest()[:24]
        chunks.append(ProductChunk(id=f"product-{digest}", question=question, section=section, text=text))
    return chunks


def load_product_chunks(path: Path = DOCUMENT_PATH) -> list[ProductChunk]:
    if not path.exists():
        raise FileNotFoundError(f"Documentation produit introuvable : {path}")
    chunks = parse_product_document(path.read_text(encoding="utf-8"))
    if not chunks:
        raise ValueError(f"Aucune question indexable dans {path}")
    return chunks
