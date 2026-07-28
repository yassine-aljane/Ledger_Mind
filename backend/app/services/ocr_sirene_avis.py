"""
Extract structured fields from an INSEE « avis de situation SIRENE » PDF/image.

Step 3 — archival proof document (activity label, address, registration date).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from app.services.ocr_siret import _extract_text_from_image, _extract_text_from_pdf


@dataclass
class SireneAvisData:
    siren: str | None = None
    activity_label: str | None = None
    address: str | None = None
    registration_date: str | None = None


_DATE_RE = re.compile(r"\b(\d{2}[/.-]\d{2}[/.-]\d{4})\b")
_SIREN_RE = re.compile(r"\b(\d{3}\s?\d{3}\s?\d{3})\b")


def _extract_text(data: bytes, filename: str, mime: str) -> str:
    suffix = Path(filename).suffix.lower()
    if mime == "application/pdf" or suffix == ".pdf":
        return _extract_text_from_pdf(data)
    if mime.startswith("image/") or suffix in {".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp", ".webp"}:
        return _extract_text_from_image(data, mime)
    raise ValueError(
        f"Type de fichier non pris en charge : {mime or suffix}. "
        "Formats acceptés : PDF, JPEG, PNG."
    )


def _line_after_label(text: str, labels: list[str]) -> str | None:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    lower_lines = [ln.lower() for ln in lines]
    for label in labels:
        label_l = label.lower()
        for i, ln in enumerate(lower_lines):
            if label_l in ln:
                rest = lines[i].split(":", 1)
                if len(rest) > 1 and rest[1].strip():
                    return rest[1].strip()
                if i + 1 < len(lines):
                    return lines[i + 1].strip()
    return None


def extract_sirene_avis_from_bytes(data: bytes, filename: str, mime: str) -> SireneAvisData:
    text = _extract_text(data, filename, mime)
    if not text.strip():
        raise ValueError("Document illisible — vérifiez la qualité du PDF ou de l'image.")

    siren: str | None = None
    for match in _SIREN_RE.finditer(text):
        digits = re.sub(r"\D", "", match.group(1))
        if len(digits) == 9:
            siren = digits
            break

    activity_label = _line_after_label(
        text,
        [
            "Activité principale exercée",
            "Libellé de l'activité",
            "Libellé code APET",
            "Activité",
        ],
    )

    address = _line_after_label(
        text,
        [
            "Adresse de l'établissement",
            "Adresse de l etablissement",
            "Adresse",
        ],
    )

    registration_date = _line_after_label(
        text,
        [
            "Date de début d'activité",
            "Date de debut d activite",
            "Date d'immatriculation",
            "Date de création",
        ],
    )
    if not registration_date:
        date_match = _DATE_RE.search(text)
        if date_match:
            registration_date = date_match.group(1)

    return SireneAvisData(
        siren=siren,
        activity_label=activity_label,
        address=address,
        registration_date=registration_date,
    )
