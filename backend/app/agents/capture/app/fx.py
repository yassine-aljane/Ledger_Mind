"""Conversion de devise -> EUR (unification des montants).

Source : taux de référence BCE via l'API publique gratuite frankfurter.app (sans clé).
Le taux appliqué est celui de la date du document (historique), pas le taux du jour, pour
rester fidèle au montant tel qu'il aurait été converti à l'époque.

Jamais bloquant (FR-08 : rien n'est inventé) : en cas d'échec réseau, de devise inconnue ou
de date manquante, on retourne `None` — aucun taux de repli fabriqué.
"""
from __future__ import annotations

import logging
from typing import Optional, Tuple

import httpx

from .db import Database

logger = logging.getLogger(__name__)

_FRANKFURTER_URL = "https://api.frankfurter.app/{date}"
_TIMEOUT = 8.0


def get_eur_rate(db: Database, currency: Optional[str], on_date: Optional[str]) -> Optional[float]:
    """Taux de conversion `currency` -> EUR à la date `on_date` (ISO 'YYYY-MM-DD')."""
    if not currency:
        return None
    code = currency.strip().upper()
    if code == "EUR":
        return 1.0
    if not on_date:
        return None

    cached = db.get_cached_fx_rate(code, on_date)
    if cached is not None:
        return cached

    try:
        response = httpx.get(
            _FRANKFURTER_URL.format(date=on_date),
            params={"from": code, "to": "EUR"},
            timeout=_TIMEOUT,
        )
        response.raise_for_status()
        rate = response.json().get("rates", {}).get("EUR")
        if not isinstance(rate, (int, float)):
            return None
        rate = float(rate)
    except Exception as e:  # noqa: BLE001 - conversion best-effort, jamais bloquante
        logger.warning("FX_RATE_LOOKUP_FAILED currency=%s date=%s error=%s", code, on_date, e)
        return None

    db.cache_fx_rate(code, on_date, rate)
    return rate


def enrich_amount_eur(
    db: Database, amount: Optional[float], currency: Optional[str], on_date: Optional[str]
) -> Tuple[Optional[float], Optional[float]]:
    """Retourne `(amount_eur, exchange_rate)`, ou `(None, None)` si non convertible."""
    if amount is None:
        return None, None
    rate = get_eur_rate(db, currency, on_date)
    if rate is None:
        return None, None
    return round(amount * rate, 2), rate
