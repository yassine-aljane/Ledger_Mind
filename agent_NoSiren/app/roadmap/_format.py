"""Helpers de formatage FR partagés (euros, pourcentages). Aucune valeur métier ici."""
from __future__ import annotations


def eur(n) -> str:
    """Formate un montant en euros à la française : 23040 -> '23 040 €'."""
    try:
        return f"{float(n):,.0f} €".replace(",", " ")
    except (TypeError, ValueError):
        return f"{n} €"


def pct(x: float) -> str:
    """Formate un taux : 0.256 -> '25,6 %'."""
    return f"{x * 100:.1f} %".replace(".", ",")


def milliers(n) -> str:
    """Formate un entier à la française : 83600 -> '83 600'."""
    try:
        return f"{int(n):,}".replace(",", " ")
    except (TypeError, ValueError):
        return str(n)
