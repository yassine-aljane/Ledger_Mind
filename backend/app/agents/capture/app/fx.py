"""Conversion de devise -> EUR (unification des montants).

Deux sources, dans cet ordre :

1. **BCE** — taux de référence publiés par la Banque centrale européenne, via
   l'API publique frankfurter.app (sans clé). C'est la référence attendue pour
   une comptabilité de la zone euro, mais elle ne couvre que 30 devises.
2. **Currency-API** — jeu de données public et sans clé couvrant ~200 devises.
   Sollicité UNIQUEMENT pour ce que la BCE ne publie pas (TND, MAD, DZD…),
   sans quoi une facture en dinar resterait sans contre-valeur.

Les deux ne sont pas interchangeables : sur une devise couverte par les deux,
l'écart observé atteint quelques dixièmes de pour cent (fixings et heures de
relevé différents). La source retenue est donc mémorisée avec le taux et
remonte jusqu'à la fiche, pour que la provenance du montant reste vérifiable.

Le taux appliqué est celui de la date du document (historique), pas le taux du
jour, pour rester fidèle au montant tel qu'il aurait été converti à l'époque.

Jamais bloquant (FR-08 : rien n'est inventé) : en cas d'échec réseau, de devise
inconnue des deux sources ou de date manquante, on retourne `None` — aucun taux
de repli fabriqué.
"""
from __future__ import annotations

import logging
from typing import Optional, Tuple

import httpx

from .db import Database

logger = logging.getLogger(__name__)

# Étiquettes de provenance, stockées en base et affichées sur la fiche.
SOURCE_ECB = "BCE"
SOURCE_FALLBACK = "Currency-API"

# Point d'entrée canonique : `api.frankfurter.app` répond 301 vers ce domaine, et
# httpx ne suit pas les redirections par défaut — l'appel échouait donc en
# silence, pour toutes les devises.
_ECB_URL = "https://api.frankfurter.dev/v1/{date}"
# Deux hôtes pour le même jeu de données : le miroir prend le relais si le CDN
# principal ne répond pas.
_FALLBACK_URLS = (
    "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@{date}/v1/currencies/{code}.json",
    "https://{date}.currency-api.pages.dev/v1/currencies/{code}.json",
)
_TIMEOUT = 8.0


def _rate_from_ecb(code: str, on_date: str) -> Optional[float]:
    """Taux BCE, ou `None` si la devise n'est pas publiée (réponse 404)."""
    try:
        response = httpx.get(
            _ECB_URL.format(date=on_date),
            params={"from": code, "to": "EUR"},
            timeout=_TIMEOUT,
            follow_redirects=True,
        )
        # 404 = devise hors des 30 publiées par la BCE. Cas nominal : le repli
        # prend le relais, rien d'anormal à signaler.
        if response.status_code == 404:
            logger.info("FX_ECB_UNSUPPORTED currency=%s date=%s", code, on_date)
            return None
        response.raise_for_status()
        rate = response.json().get("rates", {}).get("EUR")
        return float(rate) if isinstance(rate, (int, float)) else None
    except Exception as e:  # noqa: BLE001 - conversion best-effort, jamais bloquante
        # Tout autre échec (réseau, redirection, contrat d'API modifié) est un
        # incident : le journaliser en avertissement évite qu'une conversion
        # cassée passe pour une devise non couverte, comme ce fut le cas ici.
        logger.warning("FX_ECB_FAILED currency=%s date=%s error=%s", code, on_date, e)
        return None


def _rate_from_fallback(code: str, on_date: str) -> Optional[float]:
    """Taux de la source élargie, pour les devises hors périmètre BCE."""
    key = code.lower()
    for template in _FALLBACK_URLS:
        try:
            response = httpx.get(
                template.format(date=on_date, code=key),
                timeout=_TIMEOUT,
                follow_redirects=True,
            )
            response.raise_for_status()
            rate = (response.json().get(key) or {}).get("eur")
            if isinstance(rate, (int, float)):
                return float(rate)
        except Exception as e:  # noqa: BLE001 - on tente l'hôte suivant
            logger.info("FX_FALLBACK_MISS currency=%s date=%s error=%s", code, on_date, e)
    return None


def get_eur_rate(
    db: Database, currency: Optional[str], on_date: Optional[str]
) -> Tuple[Optional[float], Optional[str]]:
    """Taux `currency` -> EUR à la date `on_date`, et sa provenance."""
    if not currency:
        return None, None
    code = currency.strip().upper()
    if code == "EUR":
        return 1.0, SOURCE_ECB
    if not on_date:
        return None, None

    cached = db.get_cached_fx_rate(code, on_date)
    if cached is not None:
        return cached

    rate = _rate_from_ecb(code, on_date)
    source = SOURCE_ECB
    if rate is None:
        rate = _rate_from_fallback(code, on_date)
        source = SOURCE_FALLBACK

    if rate is None:
        logger.warning("FX_RATE_LOOKUP_FAILED currency=%s date=%s", code, on_date)
        return None, None

    db.cache_fx_rate(code, on_date, rate, source)
    return rate, source


def enrich_amount_eur(
    db: Database, amount: Optional[float], currency: Optional[str], on_date: Optional[str]
) -> Tuple[Optional[float], Optional[float], Optional[str]]:
    """Retourne `(amount_eur, exchange_rate, rate_source)`, ou des `None` si non convertible."""
    if amount is None:
        return None, None, None
    rate, source = get_eur_rate(db, currency, on_date)
    if rate is None:
        return None, None, None
    return round(amount * rate, 2), rate, source
