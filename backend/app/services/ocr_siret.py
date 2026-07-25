"""
OCR / text-extraction service for SIRET detection.

Strategy:
  1. PDF  → extract embedded text with PyMuPDF (covers Kbis, Avis SIRENE, etc.)
  2. Image → rasterise with PyMuPDF then run pytesseract (requires Tesseract installed)

The SIRET pattern is 14 consecutive digits, optionally grouped with spaces.
The SIREN (9 digits) is also accepted and returned when a full SIRET is not found.
"""

import re
from pathlib import Path

import fitz  # PyMuPDF

# Lazy-loaded RapidOCR instance
_ocr_engine = None


def _get_ocr_engine():
    global _ocr_engine
    if _ocr_engine is None:
        try:
            from rapidocr_onnxruntime import RapidOCR
            _ocr_engine = RapidOCR()
        except Exception:
            _ocr_engine = False
    return _ocr_engine if _ocr_engine is not False else None


# ---------------------------------------------------------------------------
# SIRET / SIREN patterns
# ---------------------------------------------------------------------------
# Match 14 consecutive digits (with optional internal spaces / dots)
_SIRET_RE = re.compile(r"\b(\d[\d\s.\-]{12,17}\d)\b")
_CLEAN_RE = re.compile(r"\D")  # strip non-digit chars


def _extract_sirets_from_text(text: str) -> list[str]:
    """Return all unique SIRET (14 digits) candidates found in *text*."""
    candidates: list[str] = []
    for match in _SIRET_RE.finditer(text):
        raw = match.group(1)
        digits = _CLEAN_RE.sub("", raw)
        if len(digits) == 14:
            candidates.append(digits)
        elif len(digits) == 9:
            # Found a SIREN — keep it as fallback
            candidates.append(digits)
    return list(dict.fromkeys(candidates))  # deduplicate, preserve order


def _run_ocr_on_bytes(image_bytes: bytes) -> str:
    """Run RapidOCR engine on raw image bytes."""
    engine = _get_ocr_engine()
    if not engine:
        # Fallback to pytesseract if rapidocr is not loaded
        try:
            import pytesseract
            from PIL import Image
            import io
            img = Image.open(io.BytesIO(image_bytes))
            return pytesseract.image_to_string(img)
        except Exception:
            return ""

    try:
        result, _ = engine(image_bytes)
        if result:
            return " ".join([line[1] for line in result])
    except Exception:
        pass
    return ""


# ---------------------------------------------------------------------------
# PDF handling (native text extraction + OCR fallback for scanned pages)
# ---------------------------------------------------------------------------

def _extract_text_from_pdf(data: bytes) -> str:
    doc = fitz.open(stream=data, filetype="pdf")
    parts: list[str] = []
    for page in doc:
        page_text = page.get_text()
        if page_text.strip():
            parts.append(page_text)
        else:
            # Scanned page inside PDF -> render to image pixmap and run OCR
            pix = page.get_pixmap(dpi=150)
            img_bytes = pix.tobytes("png")
            ocr_text = _run_ocr_on_bytes(img_bytes)
            if ocr_text:
                parts.append(ocr_text)
    doc.close()
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Image handling (PNG, JPG, WEBP, etc.)
# ---------------------------------------------------------------------------

def _extract_text_from_image(data: bytes, mime: str) -> str:
    return _run_ocr_on_bytes(data)



# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

class SiretNotFoundError(ValueError):
    """Raised when no SIRET/SIREN could be extracted from the document."""


def extract_siret_from_bytes(data: bytes, filename: str, mime: str) -> str:
    """
    Extract the first SIRET (14 digits) from a document.

    Parameters
    ----------
    data     : Raw file bytes.
    filename : Original file name (used for extension fallback).
    mime     : MIME type as sent by the browser.

    Returns
    -------
    14-digit SIRET string (no spaces).

    Raises
    ------
    SiretNotFoundError if no SIRET could be found.
    ValueError         if the file type is not supported.
    """
    suffix = Path(filename).suffix.lower()

    if mime == "application/pdf" or suffix == ".pdf":
        text = _extract_text_from_pdf(data)
    elif mime.startswith("image/") or suffix in {".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp", ".webp"}:
        text = _extract_text_from_image(data, mime)
    else:
        raise ValueError(
            f"Type de fichier non pris en charge : {mime or suffix}. "
            "Formats acceptés : PDF, JPEG, PNG, TIFF."
        )

    candidates = _extract_sirets_from_text(text)

    # Prefer full 14-digit SIRET over SIREN
    for c in candidates:
        if len(c) == 14:
            return c

    if candidates:
        # Return SIREN — the frontend will show it pre-filled but it won't validate as 14 digits
        raise SiretNotFoundError(
            f"Seul un SIREN ({candidates[0]}) a été détecté. "
            "Veuillez saisir le SIRET complet (14 chiffres)."
        )

    raise SiretNotFoundError(
        "Aucun SIRET n'a pu être extrait de ce document. "
        "Vérifiez que le fichier est lisible et contient bien un numéro SIRET."
    )
