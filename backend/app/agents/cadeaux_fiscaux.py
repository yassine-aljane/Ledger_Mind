"""Cadeaux en nature — recettes imposables d'une période. Source unique.

Un cadeau de marque n'est pas un cadeau au sens fiscal. Le créateur reçoit un produit
EN CONTREPARTIE d'une prestation (post, story, placement) : c'est une rémunération en
nature, donc une recette. Elle entre au livre des recettes à sa valeur marchande, au même
titre qu'un virement, et pèse donc sur TOUTE la chaîne — abattement, base imposable,
cotisations, CFP, versement libératoire, plafond du régime et seuils de franchise de TVA.
L'ignorer sous-estime l'impôt dû et, plus grave, laisse croire qu'un plafond est loin
alors qu'il est proche.

Ce module est le point d'entrée UNIQUE des trois consommateurs — rapport d'activité,
rapport fiscal, brouillon de déclaration. Trois lectures séparées finiraient par diverger
(règle de rattachement, conversion de devise), et l'utilisateur verrait trois montants
différents pour la même année.

Deux règles d'écartement, volontairement strictes — un cadeau écarté est toujours
signalé à l'appelant, jamais perdu en silence :

  * **sans date de réception** : impossible de le rattacher à un exercice. Le compter
    dans une période au hasard fausserait deux déclarations au lieu d'une ;
  * **devise étrangère sans contre-valeur en euros** : sa valeur faciale n'est pas un
    montant en euros. L'additionner reviendrait à déclarer 300 USD comme 300 €.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Dict, Iterable, List, Optional

from pydantic import BaseModel, Field

from app.core.mongo import get_db

# Nature d'activité à laquelle un avantage en nature se rattache.
#
# C'est la contrepartie d'un SERVICE rendu par le créateur, jamais une vente de
# marchandises : il ne cède aucun bien, il est payé en biens. La catégorie fiscale
# précise (BIC services ou BNC) n'est pas décidée ici — elle dépend du profil et reste
# du ressort du moteur juridique, exactement comme pour une ligne de facture.
NATURE_FISCALE = "prestation"


class CadeauRecette(BaseModel):
    """Un cadeau déclaré, vu comme une recette."""

    document_id: str
    description: Optional[str] = None
    marque: Optional[str] = None
    date_reception: Optional[str] = None
    # Contre-valeur en euros — le seul montant qui entre dans une assiette française.
    valeur_eur: Optional[float] = None
    valeur_ttc: Optional[float] = None
    devise: Optional[str] = None
    contrepartie: Optional[str] = None

    @property
    def libelle(self) -> str:
        objet = (self.description or "cadeau").strip()
        return f"{objet} — {self.marque}" if self.marque else objet


class CollecteCadeaux(BaseModel):
    """Ce qui entre dans l'assiette, et ce qui en a été écarté — avec le motif."""

    retenus: List[CadeauRecette] = Field(default_factory=list)
    # Devise étrangère dont la contre-valeur en euros n'a pas pu être établie.
    non_convertis: List[CadeauRecette] = Field(default_factory=list)
    # Cadeaux sans date de réception : rattachables à aucun exercice.
    sans_date: List[CadeauRecette] = Field(default_factory=list)
    total_eur: float = 0.0

    @property
    def nb_retenus(self) -> int:
        return len(self.retenus)

    @property
    def a_signaler(self) -> bool:
        """Des cadeaux existent mais ne sont pas comptés — l'utilisateur doit le savoir."""
        return bool(self.non_convertis or self.sans_date)


def _documents(uid: str) -> List[Dict[str, Any]]:
    """Cadeaux bruts de l'utilisateur.

    Lecture directe de Mongo, sans passer par le runtime LLM de l'agent capture : un
    rapport doit pouvoir être produit même si ce runtime n'est pas démarré. Et jamais
    bloquant — l'indisponibilité de la base ne doit pas empêcher un rapport par ailleurs
    juste sur la partie facturée, elle se lit alors comme une absence d'avantages.
    """
    try:
        return list(get_db()["cadeaux"].find({"user_id": uid}, {"_id": 0}))
    except Exception:  # noqa: BLE001 — dépendance externe, jamais fatale ici
        return []


def _valeur_eur(c: Dict[str, Any]) -> Optional[float]:
    """Contre-valeur en euros, ou `None` si elle n'est pas établie.

    `valeur_eur` est renseignée à la déclaration par la conversion de change. À défaut,
    on n'accepte `valeur_ttc` que si la valeur est DÉJÀ en euros : une valeur faciale en
    devise étrangère n'est pas un montant en euros, et l'assimiler gonflerait ou
    minorerait l'assiette selon la parité.
    """
    valeur_eur = c.get("valeur_eur")
    if valeur_eur is not None:
        return float(valeur_eur)

    devise = (c.get("devise") or "EUR").strip().upper()
    if devise == "EUR" and c.get("valeur_ttc") is not None:
        return float(c["valeur_ttc"])
    return None


def _recette(doc: Dict[str, Any], c: Dict[str, Any]) -> CadeauRecette:
    return CadeauRecette(
        document_id=doc.get("document_id", ""),
        description=c.get("description"),
        marque=c.get("marque"),
        date_reception=c.get("date_reception"),
        valeur_eur=_valeur_eur(c),
        valeur_ttc=c.get("valeur_ttc"),
        devise=c.get("devise"),
        contrepartie=c.get("contrepartie"),
    )


def collecter(uid: str, debut: date, fin: date) -> CollecteCadeaux:
    """Cadeaux de la période, triés entre retenus et écartés motivés."""
    debut_iso, fin_iso = debut.isoformat(), fin.isoformat()
    collecte = CollecteCadeaux()

    for doc in _documents(uid):
        c = doc.get("cadeau") or {}
        recette = _recette(doc, c)

        if not recette.date_reception:
            collecte.sans_date.append(recette)
            continue
        if not (debut_iso <= recette.date_reception[:10] <= fin_iso):
            continue
        if recette.valeur_eur is None:
            collecte.non_convertis.append(recette)
            continue
        collecte.retenus.append(recette)

    collecte.total_eur = round(sum(r.valeur_eur or 0.0 for r in collecte.retenus), 2)
    return collecte


def total_eur(cadeaux: Iterable[CadeauRecette]) -> float:
    return round(sum(c.valeur_eur or 0.0 for c in cadeaux), 2)


def provenance(cadeaux: List[CadeauRecette]) -> str:
    """Provenance lisible pour une case de déclaration — jamais un total anonyme."""
    if not cadeaux:
        return "aucun avantage en nature sur la période"
    libelles = [c.libelle for c in cadeaux]
    if len(libelles) <= 2:
        return f"{len(libelles)} avantage(s) en nature ({', '.join(libelles)})"
    return f"{len(libelles)} avantage(s) en nature ({', '.join(libelles[:2])}, ...)"
