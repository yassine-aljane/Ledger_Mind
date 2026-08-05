"""Détection des encaissements provenant de l'Union européenne — déclencheur de la DES.

Le piège propre aux créateurs de contenu : une plateforme comme YouTube AdSense paie depuis
l'Irlande. L'obligation de DES se déclenche alors **même si l'utilisateur reste sous la
franchise de TVA nationale** — les deux régimes sont indépendants, et rien dans le suivi du CA
ne l'annonce.

La détection repose sur deux signaux, de fiabilité très inégale :

  1. **IBAN étranger** — le code pays des deux premières lettres. Fiable : c'est une donnée
     structurée, pas une interprétation de libellé.
  2. **Libellé de la contrepartie** — comparé à une liste d'indices (`data/declarations.yaml`).
     Ce n'est qu'un INDICE : « Google » dans un motif ne prouve pas que le payeur est Google
     Ireland. Un tel rattachement est marqué `certain=False` et soumis à confirmation.

Aucun encaissement n'est déclaré d'office : l'agent signale, l'utilisateur tranche.
"""

from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Optional

from app.agents.impots import constantes as C

from .schemas import RevenuUE

# Codes pays de l'Union européenne, utilisés pour lire le préfixe d'un IBAN. La France en est
# EXCLUE : un virement franco-français ne relève évidemment pas de la DES.
PAYS_UE = {
    "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "GR", "HR", "HU",
    "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
}

_IBAN = re.compile(r"^\s*([A-Z]{2})", re.IGNORECASE)


def indices_plateformes() -> List[Dict[str, Any]]:
    """Libellés de plateformes européennes fréquentes, lus dans les données du projet."""
    des = C.declarations().get("des") or {}
    return list(des.get("indices_plateformes_ue") or [])


def pays_depuis_iban(iban: Optional[str]) -> Optional[str]:
    """Code pays d'un IBAN, ou `None` s'il est absent ou illisible."""
    if not iban:
        return None
    correspondance = _IBAN.match(str(iban).replace(" ", ""))
    return correspondance.group(1).upper() if correspondance else None


def _indice_plateforme(*textes: Optional[str]) -> Optional[Dict[str, Any]]:
    joint = " ".join(t for t in textes if t).lower()
    if not joint:
        return None
    for indice in indices_plateformes():
        if str(indice.get("motif", "")).lower() in joint:
            return indice
    return None


def detecter(virements: Iterable[Dict[str, Any]]) -> List[RevenuUE]:
    """Encaissements susceptibles de relever de la DES, du plus sûr au plus douteux.

    Ne retient que les virements REÇUS : la DES porte sur les services que l'utilisateur
    FOURNIT à un preneur établi dans un autre État membre. Un virement sortant n'est pas une
    prestation vendue.
    """
    trouves: List[RevenuUE] = []

    for v in virements:
        t = v.get("transfer") or {}
        if (t.get("direction") or "").strip().lower() != "recu":
            continue

        montant = float(t.get("amount_eur") or t.get("amount") or 0)
        if montant <= 0:
            continue

        contrepartie = t.get("sender_name")
        pays_iban = pays_depuis_iban(t.get("sender_iban"))
        indice = _indice_plateforme(contrepartie, t.get("motif"), t.get("bank_name"))

        # L'IBAN fait foi : c'est une donnée structurée. Le libellé n'est qu'un indice.
        if pays_iban and pays_iban in PAYS_UE:
            trouves.append(RevenuUE(
                virement_document_id=v.get("document_id", ""),
                date=t.get("execution_date") or t.get("value_date"),
                montant_eur=round(montant, 2),
                contrepartie=contrepartie,
                pays=pays_iban,
                plateforme=(indice or {}).get("plateforme"),
                certain=True,
                indice=f"IBAN émetteur en {pays_iban}",
            ))
        elif indice:
            trouves.append(RevenuUE(
                virement_document_id=v.get("document_id", ""),
                date=t.get("execution_date") or t.get("value_date"),
                montant_eur=round(montant, 2),
                contrepartie=contrepartie,
                pays=indice.get("pays"),
                plateforme=indice.get("plateforme"),
                certain=False,
                indice=(
                    f"libellé évoquant « {indice.get('motif')} » — à confirmer, un mot dans un "
                    "motif ne prouve pas l'établissement du payeur"
                ),
            ))

    # Les rattachements certains d'abord : ce sont eux qui obligent.
    return sorted(trouves, key=lambda r: (not r.certain, r.date or ""))


def total_eur(revenus: Iterable[RevenuUE]) -> float:
    return round(sum(r.montant_eur for r in revenus), 2)


def par_contrepartie(revenus: Iterable[RevenuUE]) -> Dict[str, Dict[str, Any]]:
    """Regroupe par client : la DES se déclare par preneur, pas par virement."""
    groupes: Dict[str, Dict[str, Any]] = {}
    for r in revenus:
        cle = r.contrepartie or r.plateforme or "Contrepartie non identifiée"
        groupe = groupes.setdefault(cle, {
            "contrepartie": cle, "pays": r.pays, "plateforme": r.plateforme,
            "montant_eur": 0.0, "nombre": 0, "certain": True,
        })
        groupe["montant_eur"] = round(groupe["montant_eur"] + r.montant_eur, 2)
        groupe["nombre"] += 1
        groupe["certain"] = groupe["certain"] and r.certain
    return groupes
