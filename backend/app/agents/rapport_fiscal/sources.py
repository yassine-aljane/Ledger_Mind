"""Collecte des pièces du rapport — factures, virements, contrats, dépenses.

Lecture directe des collections de l'agent capture : le rapport n'a pas besoin du runtime LLM
et ne doit pas en dépendre pour fonctionner.

Rôle de chaque source dans le calcul — les distinguer est essentiel :

  * **virements reçus** → seuls à entrer dans le CA, une fois rapprochés d'une facture ;
  * **factures émises** → ce qui est dû, pas ce qui est encaissé. Sert au rapprochement et à
    l'indicateur « facturé sur la période » ;
  * **contrats** → engagements. N'entrent JAMAIS dans le CA : un contrat signé n'est pas un
    euro reçu. Ils révèlent du revenu engagé non encore facturé ;
  * **dépenses capturées** → informatives seulement. En micro, l'abattement forfaitaire
    remplace la déduction des frais réels : les compter allégerait l'impôt à tort.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Dict, Iterable, List, Optional

from app.core.mongo import get_db

from .schemas import ContratEnCours, DepenseCapturee

# Types de contrat qui relèvent du salariat, pas de la micro-entreprise. Leur présence est
# signalée : la rémunération correspondante n'est pas du chiffre d'affaires.
TYPES_SALARIAT = {"travail", "cdi", "cdd", "emploi", "contrat_de_travail"}


def _date(valeur: Any) -> Optional[date]:
    if not valeur:
        return None
    try:
        return date.fromisoformat(str(valeur)[:10])
    except ValueError:
        return None


def virements(uid: str) -> List[Dict[str, Any]]:
    return list(get_db()["virements"].find({"user_id": uid}, {"_id": 0}))


def _chevauche(debut_doc: Optional[date], fin_doc: Optional[date],
               debut: date, fin: date) -> bool:
    """Le contrat couvre-t-il tout ou partie de la période ?

    Une fin absente vaut « toujours en cours » (durée indéterminée, tacite reconduction) :
    l'exclure ferait disparaître les contrats les plus structurants.
    """
    if debut_doc and debut_doc > fin:
        return False
    if fin_doc and fin_doc < debut:
        return False
    return debut_doc is not None or fin_doc is not None


def contrats_en_cours(uid: str, debut: date, fin: date) -> List[ContratEnCours]:
    """Contrats capturés dont la période recouvre celle du rapport."""
    lignes: List[ContratEnCours] = []
    for doc in get_db()["contrats"].find({"user_id": uid}, {"_id": 0}):
        c = doc.get("contract") or {}
        d_debut, d_fin = _date(c.get("start_date")), _date(c.get("end_date"))
        if not _chevauche(d_debut, d_fin, debut, fin):
            continue
        contrepartie = next(
            (p.get("name") for p in (c.get("parties") or []) if p.get("name")), None
        )
        lignes.append(ContratEnCours(
            document_id=doc.get("document_id", ""),
            type=c.get("contract_type"),
            titre=c.get("title"),
            contrepartie=contrepartie,
            date_debut=c.get("start_date"),
            date_fin=c.get("end_date"),
            # `amount_eur` d'abord : un contrat en devise étrangère doit être comparable.
            montant_eur=c.get("amount_eur") if c.get("amount_eur") is not None else c.get("amount"),
            echeancier=c.get("payment_schedule"),
            duree_indeterminee=c.get("is_open_ended"),
        ))
    return lignes


def depenses_capturees(uid: str, debut: date, fin: date) -> List[DepenseCapturee]:
    """Factures de dépense capturées sur la période. Informatives, jamais déductibles."""
    lignes: List[DepenseCapturee] = []
    for doc in get_db()["invoices"].find({"user_id": uid}, {"_id": 0}):
        f = doc.get("invoice") or {}
        d = _date(f.get("issue_date"))
        if d is None or not (debut <= d <= fin):
            continue
        lignes.append(DepenseCapturee(
            document_id=doc.get("document_id", ""),
            fournisseur=f.get("issuer_name"),
            numero=f.get("invoice_number"),
            date=f.get("issue_date"),
            montant_eur=(
                f.get("amount_eur") if f.get("amount_eur") is not None else f.get("total_ttc")
            ),
            categorie=doc.get("expense_category"),
        ))
    return lignes


def cadeaux_recus(uid: str, debut: date, fin: date) -> List[Dict[str, Any]]:
    """Cadeaux et avantages en nature reçus sur la période — du CHIFFRE D'AFFAIRES.

    Fiscalement, ce n'est pas un cadeau : un partenariat rémunéré en produits est un revenu
    en nature, déclarable à sa valeur marchande. Il entre au livre des recettes comme un
    encaissement, alors même qu'aucun euro n'a transité par le compte bancaire.

    Seule la valeur RETENUE (`valeur_ttc`, saisie ou confirmée par l'utilisateur) compte.
    Une estimation issue d'une photo reste une suggestion : la déclarer d'office ferait
    porter à l'utilisateur une erreur qui n'est pas la sienne.
    """
    lignes: List[Dict[str, Any]] = []
    for doc in get_db()["cadeaux"].find({"user_id": uid}, {"_id": 0}):
        c = doc.get("cadeau") or {}
        d = _date(c.get("date_reception"))
        if d is None or not (debut <= d <= fin):
            continue
        # `valeur_eur` d'abord : un cadeau valorisé en devise doit être comparable.
        valeur = c.get("valeur_eur") if c.get("valeur_eur") is not None else c.get("valeur_ttc")
        if valeur is None or float(valeur) <= 0:
            continue
        lignes.append({
            "document_id": doc.get("document_id", ""),
            "description": c.get("description") or c.get("objet_identifie"),
            "marque": c.get("marque"),
            "date": c.get("date_reception"),
            "valeur_eur": round(float(valeur), 2),
            "contrepartie": c.get("contrepartie"),
            "valeur_corrigee": c.get("valeur_corrigee"),
            "source_estimation": c.get("source_estimation"),
        })
    return sorted(lignes, key=lambda l: l["date"] or "")


def cadeaux_sans_valeur(uid: str, debut: date, fin: date) -> List[Dict[str, Any]]:
    """Cadeaux déclarés sans valeur retenue — ils ne peuvent PAS entrer dans le CA.

    Les taire les ferait disparaître du chiffre d'affaires sans que rien ne le signale, ce
    qui minorerait la déclaration. On les recense pour que l'utilisateur les valorise.
    """
    manquants: List[Dict[str, Any]] = []
    for doc in get_db()["cadeaux"].find({"user_id": uid}, {"_id": 0}):
        c = doc.get("cadeau") or {}
        d = _date(c.get("date_reception"))
        if d is None or not (debut <= d <= fin):
            continue
        valeur = c.get("valeur_eur") if c.get("valeur_eur") is not None else c.get("valeur_ttc")
        if valeur is None or float(valeur) <= 0:
            manquants.append({
                "document_id": doc.get("document_id", ""),
                "description": c.get("description") or c.get("objet_identifie"),
                "marque": c.get("marque"),
                "date": c.get("date_reception"),
                "valeur_estimee": c.get("valeur_estimee"),
            })
    return manquants


def total_cadeaux(lignes: Iterable[Dict[str, Any]]) -> float:
    return round(sum(float(l.get("valeur_eur") or 0) for l in lignes), 2)


def total_eur(lignes: Iterable[Any]) -> float:
    return round(sum(float(getattr(l, "montant_eur", 0) or 0) for l in lignes), 2)


def contrats_de_salariat(contrats: Iterable[ContratEnCours]) -> List[ContratEnCours]:
    """Contrats relevant du salariat — leur rémunération n'est pas du chiffre d'affaires."""
    return [
        c for c in contrats
        if (c.type or "").strip().lower().replace(" ", "_") in TYPES_SALARIAT
    ]
