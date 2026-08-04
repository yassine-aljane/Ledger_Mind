"""Franchise en base de TVA — **drapeau seul**, aucun calcul de TVA.

Ce module ne liquide pas de TVA et n'en produit aucun montant : il compare le CA encaissé aux
seuils de l'article 293 B du CGI et dit où l'utilisateur se situe. La liquidation suppose des
taux par ligne, des règles d'exigibilité et une déclaration : hors du périmètre du rapport.

Deux seuils, deux effets radicalement différents — c'est toute la raison de ce module :

  * **seuil de base** franchi → assujettissement au **1er janvier de l'année suivante** ;
  * **seuil majoré** franchi → assujettissement **dès le premier jour du mois de dépassement**,
    donc rétroactivement sur des factures déjà émises sans TVA.

Les seuils viennent de `data/seuils.yaml` (bloc `tva_franchise`), jamais du code.
"""

from __future__ import annotations

from typing import Dict, List, Optional

from app.agents.guidance.roadmap import seuils as seuils_projet

from .schemas import Alerte

# Correspondance nature de ligne → clé du bloc `tva_franchise` du YAML.
_CLE_SEUIL = {"vente": "vente", "prestation": "services"}

_LIBELLE = {"vente": "vente de marchandises", "prestation": "prestations de services"}


def seuils_tva() -> Dict:
    """Bloc `tva_franchise` de la source de vérité. Aucun seuil n'est écrit ici."""
    return seuils_projet.bloc("tva_franchise")


def _seuil(nature: str, quel: str) -> Optional[float]:
    bloc = seuils_tva().get(_CLE_SEUIL.get(nature, "services")) or {}
    valeur = bloc.get(quel)
    return float(valeur) if valeur is not None else None


def statut_franchise(ca_par_categorie: Dict[str, float]) -> Dict:
    """Position du CA encaissé vis-à-vis des seuils de franchise, par nature d'activité.

    Renvoie un état descriptif, jamais une conclusion sur la TVA due. `periode_partielle`
    laissé à l'appelant : un CA de 6 mois comparé à un seuil annuel ne franchit rien.
    """
    lignes: List[Dict] = []
    for nature, ca in sorted(ca_par_categorie.items()):
        base = _seuil(nature, "seuil_base")
        majore = _seuil(nature, "seuil_majore")
        if base is None:
            continue
        lignes.append({
            "nature": nature,
            "libelle": _LIBELLE.get(nature, nature),
            "ca": round(float(ca), 2),
            "seuil_base": base,
            "seuil_majore": majore,
            "depasse_base": ca > base,
            "depasse_majore": bool(majore is not None and ca > majore),
            "reste_avant_base": round(max(base - ca, 0.0), 2),
        })

    bloc = seuils_tva()
    depasse_base = any(l["depasse_base"] for l in lignes)
    depasse_majore = any(l["depasse_majore"] for l in lignes)
    return {
        "lignes": lignes,
        "depasse_base": depasse_base,
        "depasse_majore": depasse_majore,
        # État explicite : « conforme » est une information, pas une absence d'anomalie.
        "statut": (
            "seuil_majore_depasse" if depasse_majore
            else "seuil_base_depasse" if depasse_base
            else "franchise_conservee"
        ),
        "libelle_statut": (
            "Seuil majoré dépassé — TVA due dès le mois de dépassement" if depasse_majore
            else "Seuil de base dépassé — assujettissement au 1er janvier suivant" if depasse_base
            else "Franchise en base conservée"
        ),
        "annee_seuils": bloc.get("annee"),
        "source": bloc.get("source"),
        "date_verif": bloc.get("date_verif"),
        "note": (
            "Drapeau indicatif : ce rapport ne calcule aucune TVA. Les seuils s'apprécient sur "
            "l'année civile entière ; sur une période plus courte, un franchissement affiché "
            "reste à confirmer sur l'année complète."
        ),
    }


def alertes_tva(ca_par_categorie: Dict[str, float], annee_complete: bool) -> List[Alerte]:
    """Alertes de franchissement. Rien n'est conclu : on signale et on renvoie à la source."""
    statut = statut_franchise(ca_par_categorie)
    reserve = "" if annee_complete else (
        " La période analysée ne couvre pas l'année civile entière : à confirmer sur l'année "
        "complète."
    )
    alertes: List[Alerte] = []

    for ligne in statut["lignes"]:
        if ligne["depasse_majore"]:
            alertes.append(Alerte(
                niveau="critique",
                titre=f"Seuil majoré de TVA dépassé ({ligne['libelle']})",
                message=(
                    f"{ligne['ca']:.0f} € encaissés pour un seuil majoré de "
                    f"{ligne['seuil_majore']:.0f} €. Le dépassement du seuil majoré rend "
                    "redevable de la TVA dès le premier jour du mois de dépassement : les "
                    "factures émises depuis cette date sont à régulariser." + reserve
                ),
                source=statut["source"],
            ))
        elif ligne["depasse_base"]:
            alertes.append(Alerte(
                niveau="vigilance",
                titre=f"Seuil de base de TVA dépassé ({ligne['libelle']})",
                message=(
                    f"{ligne['ca']:.0f} € encaissés pour un seuil de base de "
                    f"{ligne['seuil_base']:.0f} €. L'assujettissement prend effet au 1er janvier "
                    "de l'année suivante ; la mention « TVA non applicable, art. 293 B du CGI » "
                    "devra alors disparaître des factures." + reserve
                ),
                source=statut["source"],
            ))

    return alertes
