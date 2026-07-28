"""
Classify an uploaded registry document as Kbis (RCS / BIC) or extrait RNE (BNC).

The free recherche-entreprises API does not expose RCS status for EI — document
OCR is the automatic verification path for entrepreneurs individuels.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import fitz  # PyMuPDF

from app.services.ocr_siret import _extract_text_from_image, _run_ocr_on_bytes

logger = logging.getLogger(__name__)

DocumentType = Literal["kbis", "rne_extract"]

_SIREN_RE = re.compile(r"\b(\d{3}\s?\d{3}\s?\d{3})\b")
_SIRET_RE = re.compile(r"\b(\d{3}\s?\d{3}\s?\d{3}\s?\d{5})\b")
_RCS_LINE_RE = re.compile(
    r"rcs\s+[a-zéèêëàâùûôîïç\s\-']+\s*\d",
    re.IGNORECASE,
)

# Step 3 document — wrong upload slot.
_SIRENE_AVIS_MARKERS: list[tuple[str, int]] = [
    ("avis de situation au repertoire sirene", 6),
    ("avis de situation au répertoire sirene", 6),
    ("avis de situation sirene", 5),
    ("situation au repertoire sirene", 4),
    ("institut national de la statistique", 3),
]

_KBIS_MARKERS: list[tuple[str, int]] = [
    ("extrait kbis", 6),
    ("registre du commerce et des societes", 5),
    ("registre du commerce et des sociétés", 5),
    ("registre du commerce", 4),
    ("greffe du tribunal", 4),
    ("tribunal de commerce", 4),
    ("numero rcs", 3),
    ("numéro rcs", 3),
    ("immatriculation au rcs", 4),
    ("immatriculation rcs", 3),
    ("infogreffe", 3),
    ("capital social", 2),
]

_RNE_MARKERS: list[tuple[str, int]] = [
    ("repertoire national des entreprises", 5),
    ("répertoire national des entreprises", 5),
    ("extrait rne", 5),
    ("extrait du rne", 5),
    ("bulletin d immatriculation", 3),
    ("bulletin d'immatriculation", 3),
    ("extrait d immatriculation", 3),
    ("extrait d'immatriculation", 3),
    ("www.inpi.fr", 4),
    ("data.inpi", 3),
    ("inpi", 2),
    ("guichet unique", 3),
    ("formalites.entreprises", 3),
    ("entreprise individuelle", 3),
    ("micro-entrepreneur", 3),
    ("micro entrepreneur", 3),
    ("micro-entreprise", 3),
    ("auto-entrepreneur", 3),
    ("auto entrepreneur", 3),
    ("identite de l entreprise", 2),
    ("identité de l'entreprise", 2),
    ("informations legales", 2),
    ("informations légales", 2),
    ("forme juridique", 2),
    ("attestation d inscription", 3),
    ("attestation d'inscription", 3),
    ("fiche recapitulative", 2),
    ("fiche récapitulative", 2),
    ("declaration d activite", 2),
    ("déclaration d'activité", 2),
    ("eirl", 2),
    ("institut national de la propriete industrielle", 3),
]


@dataclass
class RegistryDocData:
    document_type: DocumentType
    siren: str | None
    confidence: str  # "high" | "medium"
    kbis_score: int
    rne_score: int


def _normalize(text: str) -> str:
    lowered = text.lower()
    return "".join(
        c for c in unicodedata.normalize("NFD", lowered) if unicodedata.category(c) != "Mn"
    )


def _score_markers(text: str, markers: list[tuple[str, int]]) -> int:
    normalized = _normalize(text)
    return sum(weight for marker, weight in markers if _normalize(marker) in normalized)


def _extract_siren(text: str) -> str | None:
    for match in _SIREN_RE.finditer(text):
        digits = re.sub(r"\D", "", match.group(1))
        if len(digits) == 9:
            return digits
    return None


def _has_siret(text: str) -> bool:
    for match in _SIRET_RE.finditer(text):
        digits = re.sub(r"\D", "", match.group(1))
        if len(digits) == 14:
            return True
    return bool(re.search(r"\bsiret\b", _normalize(text)))


def _extract_text_enriched(data: bytes, filename: str, mime: str) -> str:
    """Native PDF text + OCR on every page (RNE/Kbis scans are common)."""
    suffix = Path(filename).suffix.lower()
    if mime == "application/pdf" or suffix == ".pdf":
        doc = fitz.open(stream=data, filetype="pdf")
        parts: list[str] = []
        for page in doc:
            native = page.get_text("text") or page.get_text()
            if native.strip():
                parts.append(native)
            pix = page.get_pixmap(dpi=200)
            ocr_text = _run_ocr_on_bytes(pix.tobytes("png"))
            if ocr_text.strip():
                parts.append(ocr_text)
        doc.close()
        return "\n".join(parts)

    if mime.startswith("image/") or suffix in {".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp", ".webp"}:
        return _extract_text_from_image(data, mime)

    raise ValueError(
        f"Type de fichier non pris en charge : {mime or suffix}. "
        "Formats acceptés : PDF, JPEG, PNG."
    )


def _classify_from_text(text: str) -> RegistryDocData:
    if not text.strip():
        raise ValueError("Document illisible — vérifiez la qualité du PDF ou de l'image.")

    kbis_score = _score_markers(text, _KBIS_MARKERS)
    rne_score = _score_markers(text, _RNE_MARKERS)
    sirene_avis_score = _score_markers(text, _SIRENE_AVIS_MARKERS)
    normalized = _normalize(text)

    if _RCS_LINE_RE.search(text):
        kbis_score += 5
    if re.search(r"\bkbis\b", normalized):
        kbis_score += 4
    if re.search(r"\brcs\b", normalized) and not re.search(r"\brne\b", normalized):
        kbis_score += 2

    if sirene_avis_score >= 4 and sirene_avis_score > kbis_score and sirene_avis_score > rne_score:
        raise ValueError(
            "Ce document ressemble à un avis de situation SIRENE (INSEE). "
            "Déposez-le à l'étape 3."
        )

    siren = _extract_siren(text)
    has_siret = _has_siret(text)

    # INPI extrait: SIRET present, no RCS/Kbis signals.
    if has_siret and kbis_score < 3 and rne_score >= 1:
        rne_score += 2
    if has_siret and kbis_score == 0 and rne_score == 0 and sirene_avis_score < 3:
        rne_score += 2

    if kbis_score >= 4 and kbis_score > rne_score:
        doc_type: DocumentType = "kbis"
        confidence = "high" if kbis_score >= 6 else "medium"
    elif rne_score >= 2 and rne_score >= kbis_score:
        doc_type = "rne_extract"
        confidence = "high" if rne_score >= 5 else "medium"
    elif kbis_score >= 3 and kbis_score > rne_score:
        doc_type = "kbis"
        confidence = "medium"
    elif rne_score >= 1 and rne_score > kbis_score:
        doc_type = "rne_extract"
        confidence = "medium"
    elif has_siret and kbis_score <= 1:
        doc_type = "rne_extract"
        confidence = "medium"
        rne_score = max(rne_score, 2)
    else:
        logger.info(
            "Registry doc classify failed kbis=%s rne=%s sirene_avis=%s snippet=%r",
            kbis_score,
            rne_score,
            sirene_avis_score,
            text[:400],
        )
        hint = ""
        if sirene_avis_score >= 2:
            hint = " Ce fichier ressemble à un avis SIRENE — utilisez l'étape 3."
        raise ValueError(
            "Impossible d'identifier le document. Déposez un Kbis (greffe / RCS) "
            "ou un extrait RNE (INPI), lisible et complet."
            + hint
        )

    return RegistryDocData(
        document_type=doc_type,
        siren=siren,
        confidence=confidence,
        kbis_score=kbis_score,
        rne_score=rne_score,
    )


def classify_registry_document(data: bytes, filename: str, mime: str) -> RegistryDocData:
    text = _extract_text_enriched(data, filename, mime)
    return _classify_from_text(text)


async def classify_registry_document_with_llm(
    data: bytes,
    filename: str,
    mime: str,
) -> RegistryDocData:
    """Heuristics first, then Gemini when OCR text exists but markers are ambiguous."""
    text = _extract_text_enriched(data, filename, mime)
    try:
        return _classify_from_text(text)
    except ValueError as heuristic_error:
        if len(text.strip()) < 20:
            raise heuristic_error

        from app.agents.intake.llm import chat_json

        try:
            result = await chat_json(
                (
                    "Classify this French business registry document OCR text.\n"
                    'Return JSON: {"document_type":"kbis"|"rne_extract"|"sirene_avis"|"unknown",'
                    '"confidence":"high"|"medium"}\n\n'
                    "- kbis: Extrait Kbis / greffe / tribunal de commerce / RCS\n"
                    "- rne_extract: INPI / RNE / guichet unique / micro-entrepreneur / EI\n"
                    "- sirene_avis: INSEE avis de situation SIRENE\n"
                    "- unknown: cannot tell\n\n"
                    f"OCR text:\n{text[:4000]}"
                ),
                temperature=0.0,
                max_tokens=128,
            )
        except Exception as exc:
            logger.warning("LLM registry classification failed: %s", exc)
            raise heuristic_error

        doc_type_raw = str(result.get("document_type", "unknown")).lower()
        confidence = str(result.get("confidence", "medium"))
        if confidence not in ("high", "medium"):
            confidence = "medium"

        if doc_type_raw == "sirene_avis":
            raise ValueError(
                "Ce document ressemble à un avis de situation SIRENE (INSEE). "
                "Déposez-le à l'étape 3."
            )
        if doc_type_raw not in ("kbis", "rne_extract"):
            raise heuristic_error

        return RegistryDocData(
            document_type=doc_type_raw,  # type: ignore[arg-type]
            siren=_extract_siren(text),
            confidence=confidence,
            kbis_score=0,
            rne_score=0,
        )
