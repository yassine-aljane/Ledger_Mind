"""Collecte des pièces qui alimentent les déclarations.

Le guide énumère précisément ce dont chaque déclaration a besoin. Ce module réunit ces
sources, sans jamais rien calculer de fiscal :

    factures ÉMISES    → CA encaissé (via rapprochement) et **TVA collectée**
    factures REÇUES    → **TVA déductible** sur les achats professionnels
    virements          → encaissements, et détection des revenus européens
    contrats           → revenu engagé, cohérence avec ce qui est facturé
    profil onboarding  → catégorie, périodicité, régime de TVA, commune, département
    rapports générés   → recoupement de l'assiette déjà établie

Une réserve tient tout le module : une facture reçue N'EST PAS automatiquement une charge
professionnelle déductible. La TVA d'un achat privé ne se récupère pas. L'agent additionne
donc ce qu'il voit, et dit à l'utilisateur qu'il doit écarter ce qui n'est pas professionnel.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Dict, Iterable, List, Optional

from app.core.mongo import get_db


def _date(valeur: Any) -> Optional[date]:
    if not valeur:
        return None
    try:
        return date.fromisoformat(str(valeur)[:10])
    except ValueError:
        return None


def _dans(valeur: Any, debut: date, fin: date) -> bool:
    d = _date(valeur)
    return d is not None and debut <= d <= fin


# ------------------------------------------------------------------ TVA collectée
def tva_collectee(factures_emises: Iterable[Dict[str, Any]], debut: date, fin: date) -> Dict[str, Any]:
    """TVA facturée aux clients sur la période.

    Assise sur les factures ÉMISES et sur leur TVA réelle, pas sur un taux supposé : une
    facture peut porter 20 %, 10 % ou 5,5 % selon la prestation, et une facture en franchise
    n'en porte aucune. Appliquer 20 % à tout produirait une TVA due inexacte.

    La TVA est exigible sur l'ENCAISSEMENT pour les prestations de services : cette base
    retient les factures émises sur la période, ce qui est signalé comme une approximation.
    """
    lignes: List[Dict[str, Any]] = []
    for f in factures_emises:
        if not _dans(f.get("date_emission"), debut, fin):
            continue
        montant = float(f.get("total_tva") or 0)
        if montant <= 0:
            continue
        lignes.append({
            "numero": f.get("numero"),
            "date": f.get("date_emission"),
            "client": (f.get("client") or {}).get("nom"),
            "base_ht": round(float(f.get("total_ht") or 0), 2),
            "tva": round(montant, 2),
        })
    return {
        "lignes": lignes,
        "total": round(sum(l["tva"] for l in lignes), 2),
        "base_ht": round(sum(l["base_ht"] for l in lignes), 2),
    }


# ----------------------------------------------------------------- TVA déductible
def factures_recues(uid: str, debut: date, fin: date) -> List[Dict[str, Any]]:
    """Factures d'achat capturées sur la période — la source de la TVA déductible."""
    recues: List[Dict[str, Any]] = []
    for doc in get_db()["invoices"].find({"user_id": uid}, {"_id": 0}):
        f = doc.get("invoice") or {}
        if not _dans(f.get("issue_date"), debut, fin):
            continue
        recues.append({
            "document_id": doc.get("document_id", ""),
            "fournisseur": f.get("issuer_name"),
            "numero": f.get("invoice_number"),
            "date": f.get("issue_date"),
            "base_ht": f.get("subtotal_ht"),
            "tva": f.get("vat_amount"),
            "total_ttc": f.get("total_ttc"),
            "categorie": doc.get("expense_category"),
        })
    return recues


def tva_deductible(recues: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
    """TVA supportée sur les achats. À CONFIRMER pièce par pièce.

    Deux réserves, toutes deux tenues :

      * une facture capturée n'est pas forcément une charge PROFESSIONNELLE — la TVA d'un
        achat privé ne se récupère pas ;
      * une facture dont la TVA n'a pas été lue reste comptée à part, jamais à zéro : un
        montant illisible n'est pas un montant nul.
    """
    avec_tva = [r for r in recues if r.get("tva") is not None]
    sans_tva = [r for r in recues if r.get("tva") is None]
    return {
        "lignes": avec_tva,
        "total": round(sum(float(r["tva"] or 0) for r in avec_tva), 2),
        "pieces_sans_tva_lue": len(sans_tva),
        "pieces_sans_tva_details": sans_tva,
        "reserve": (
            "Seuls les achats PROFESSIONNELS justifiés ouvrent droit à déduction. Écartez "
            "toute dépense privée avant de reporter ce montant."
        ),
    }


# ---------------------------------------------------------------------- Contrats
def contrats_actifs(uid: str, debut: date, fin: date) -> List[Dict[str, Any]]:
    """Contrats dont la période recouvre celle de la déclaration.

    Ils n'entrent dans AUCUNE case : un contrat engage, il n'encaisse pas. Ils servent au
    recoupement — du revenu engagé sans facture correspondante mérite un coup d'œil.
    """
    actifs: List[Dict[str, Any]] = []
    for doc in get_db()["contrats"].find({"user_id": uid}, {"_id": 0}):
        c = doc.get("contract") or {}
        d_debut, d_fin = _date(c.get("start_date")), _date(c.get("end_date"))
        if d_debut and d_debut > fin:
            continue
        if d_fin and d_fin < debut:
            continue
        if d_debut is None and d_fin is None:
            continue
        actifs.append({
            "document_id": doc.get("document_id", ""),
            "type": c.get("contract_type"),
            "titre": c.get("title"),
            "contrepartie": next(
                (p.get("name") for p in (c.get("parties") or []) if p.get("name")), None
            ),
            "montant_eur": c.get("amount_eur") if c.get("amount_eur") is not None else c.get("amount"),
            "echeancier": c.get("payment_schedule"),
            "date_debut": c.get("start_date"),
            "date_fin": c.get("end_date"),
        })
    return actifs


# ------------------------------------------------------------- Rapports déjà générés
def rapports_couvrant(uid: str, debut: date, fin: date) -> List[Dict[str, Any]]:
    """Rapports fiscaux archivés dont la période recouvre celle de la déclaration.

    Ils servent de RECOUPEMENT : si un rapport établi antérieurement annonce un autre CA sur
    la même période, l'écart doit être visible avant de déclarer, pas découvert après.
    """
    couvrants: List[Dict[str, Any]] = []
    for r in get_db()["rapports_fiscaux"].find(
        {"uid": uid},
        {"_id": 0, "id": 1, "date_debut": 1, "date_fin": 1, "genere_le": 1, "ca_retenu": 1},
    ):
        r_debut, r_fin = _date(r.get("date_debut")), _date(r.get("date_fin"))
        if r_debut is None or r_fin is None:
            continue
        if r_debut <= fin and r_fin >= debut:
            couvrants.append(r)
    return sorted(couvrants, key=lambda r: r.get("genere_le") or "", reverse=True)


def ecart_avec_rapport(
    ca_declare: float, rapports: Iterable[Dict[str, Any]], debut: date, fin: date
) -> Optional[Dict[str, Any]]:
    """Écart avec le rapport portant EXACTEMENT la même période, s'il en existe un.

    Comparer des périodes différentes n'aurait aucun sens : un rapport annuel et une
    déclaration trimestrielle divergent forcément.
    """
    for r in rapports:
        if r.get("date_debut") == debut.isoformat() and r.get("date_fin") == fin.isoformat():
            ecart = round(ca_declare - float(r.get("ca_retenu") or 0), 2)
            return {
                "rapport_id": r.get("id"),
                "genere_le": r.get("genere_le"),
                "ca_du_rapport": r.get("ca_retenu"),
                "ca_declare": ca_declare,
                "ecart": ecart,
                "concordant": abs(ecart) < 0.01,
            }
    return None
