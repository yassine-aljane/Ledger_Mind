"""Outils de calcul fiscal exposables à un agent.

Chaque outil est une fonction pure : arguments simples, résultat JSON. Aucune
dépendance à un framework d'agent — ni LangChain, ni MCP — pour que l'adaptation
se fasse au point d'intégration plutôt qu'ici :

    from langchain_core.tools import StructuredTool
    outils = [StructuredTool.from_function(**o.pour_langchain()) for o in OUTILS]

L'agent DÉCIDE quand appeler ; il ne recalcule jamais. Le modèle ne voit que des
entrées et des sorties, jamais une formule à appliquer lui-même.

Convention de rendu : montants arrondis au centime au moment de la sortie
seulement — la précision reste pleine dans tout le moteur (cf. moteur.py).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Type

from pydantic import BaseModel

from . import constantes as C
from . import moteur
from .constantes import CaisseBNC, CategorieFiscale
from .schemas import ActiviteCA, ContexteFoyer, DemandeSimulation


def _arrondir(valeur: Any, decimales: int = 2) -> Any:
    """Arrondit récursivement les nombres d'une structure JSON, à l'affichage."""
    if isinstance(valeur, bool) or valeur is None:
        return valeur
    if isinstance(valeur, float):
        return round(valeur, decimales)
    if isinstance(valeur, dict):
        return {k: _arrondir(v, decimales) for k, v in valeur.items()}
    if isinstance(valeur, list):
        return [_arrondir(v, decimales) for v in valeur]
    return valeur


# --- Outils -----------------------------------------------------------------
def simuler_impots(
    activites: List[Dict[str, Any]],
    parts_fiscales: Optional[float] = None,
    autres_revenus: Optional[float] = None,
    en_couple: bool = False,
    rfr_n2: Optional[float] = None,
    caisse_bnc: str = "REGIME_GENERAL",
    acre_active: bool = False,
    option_versement_liberatoire: bool = False,
    jours_activite: Optional[int] = None,
) -> Dict[str, Any]:
    """Simule impôt et cotisations d'une micro-entreprise sur une période.

    `activites` : liste de {"categorie": "BIC_VENTE"|"BIC_SERVICE"|"BNC",
    "ca": montant encaissé HT}. Une entrée par catégorie en activité mixte.

    L'IR au barème exige `parts_fiscales` ET `autres_revenus` : sans eux, le
    champ `ir_bareme` reste nul et `ir_bareme_calculable` vaut false. C'est un
    refus délibéré, pas une panne.
    """
    demande = DemandeSimulation(
        activites=[ActiviteCA(**a) for a in activites],
        foyer=ContexteFoyer(
            parts=parts_fiscales,
            autres_revenus=autres_revenus,
            en_couple=en_couple,
            rfr_n2=rfr_n2,
        ),
        caisse_bnc=CaisseBNC(caisse_bnc),
        acre_active=acre_active,
        option_versement_liberatoire=option_versement_liberatoire,
        jours_activite=jours_activite,
    )
    return _arrondir(moteur.simuler(demande).model_dump(mode="json"))


def calculer_base_imposable(activites: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Applique l'abattement forfaitaire et renvoie la base imposable.

    Calcul isolé, utile quand seul le revenu imposable est demandé sans le
    contexte du foyer. Le plancher d'abattement est doublé en activité mixte.
    """
    entrees = [ActiviteCA(**a) for a in activites]
    mixte = len({a.categorie for a in entrees}) > 1
    lignes = moteur.calculer_lignes(entrees, mixte)
    return _arrondir(
        {
            "ca_total": sum(a.ca for a in entrees),
            "base_imposable": sum(ligne.base_imposable for ligne in lignes),
            "lignes": [ligne.model_dump(mode="json") for ligne in lignes],
            "activite_mixte": mixte,
        }
    )


def calculer_cotisations(
    activites: List[Dict[str, Any]],
    caisse_bnc: str = "REGIME_GENERAL",
    acre_active: bool = False,
) -> Dict[str, Any]:
    """Cotisations sociales et CFP, assises sur le CA plein.

    L'abattement fiscal ne réduit PAS l'assiette sociale : c'est l'erreur la
    plus fréquente sur ce calcul.
    """
    entrees = [ActiviteCA(**a) for a in activites]
    caisse = CaisseBNC(caisse_bnc)
    cotisations = moteur.cotisations_sociales(entrees, caisse, acre_active)
    cfp = moteur.contribution_formation(entrees, caisse)
    resultat = {
        "cotisations_sociales": cotisations,
        "cfp": cfp,
        "total": cotisations + cfp,
        "acre_appliquee": acre_active,
        "assiette": sum(a.ca for a in entrees),
    }
    if acre_active:
        resultat["avertissement"] = f"ACRE : {C.acre()['approximation']}."
    return _arrondir(resultat)


def calculer_ir_bareme(
    revenu_net_imposable: float, parts_fiscales: float, en_couple: bool = False
) -> Dict[str, Any]:
    """IR d'un foyer au barème progressif : quotient familial, plafonnement, décote.

    Renvoie l'impôt du FOYER ENTIER. Pour la part imputable à la seule activité
    micro, passer par `simuler_impots`, qui procède par différence.
    """
    detail = moteur.impot_du_foyer(revenu_net_imposable, parts_fiscales, en_couple)
    return _arrondir(detail.model_dump(mode="json"))


def verifier_plafonds(
    activites: List[Dict[str, Any]], jours_activite: Optional[int] = None
) -> Dict[str, Any]:
    """Compare le CA aux plafonds du régime micro, proratisés si besoin.

    Un dépassement N'EST PAS une sortie du régime : celle-ci suppose deux
    années consécutives au-delà du seuil, information hors de portée de ce
    calcul. L'outil signale, il ne conclut pas.
    """
    entrees = [ActiviteCA(**a) for a in activites]
    depassements = moteur.controler_plafonds(entrees, jours_activite)
    # État de CHAQUE catégorie, dépassement ou non : « conforme » est une information, pas
    # une absence d'information. Sans cela, l'appelant ne peut afficher que les anomalies.
    etats = []
    for activite in entrees:
        plafond, proratise = moteur.plafond_applicable(activite.categorie, jours_activite)
        etats.append(
            {
                "categorie": activite.categorie.value,
                "ca": activite.ca,
                "plafond": plafond,
                "plafond_proratise": proratise,
                "conforme": activite.ca <= plafond,
                "marge_restante": max(plafond - activite.ca, 0.0),
            }
        )
    return _arrondir(
        {
            "depassements": [d.model_dump(mode="json") for d in depassements],
            "au_dessus_du_plafond": bool(depassements),
            "plafonds": etats,
            "jours_activite": jours_activite,
            "note": (
                "La sortie du régime micro suppose un dépassement sur deux années "
                "consécutives ; ce contrôle porte sur une seule période."
            ),
        }
    )


def parametres_categorie(
    categorie: str, caisse_bnc: str = "REGIME_GENERAL", jours_activite: Optional[int] = None
) -> Dict[str, Any]:
    """Constantes effectivement appliquées à une catégorie fiscale, avec leur provenance.

    Rend le calcul vérifiable : un utilisateur doit pouvoir retrouver chaque taux dans la
    source officielle plutôt que de faire confiance au résultat.
    """
    cat = CategorieFiscale(categorie)
    caisse = CaisseBNC(caisse_bnc) if cat is CategorieFiscale.bnc else None
    plafond, proratise = moteur.plafond_applicable(cat, jours_activite)
    return _arrondir(
        {
            "categorie": cat.value,
            "caisse_bnc": caisse.value if caisse else None,
            "taux_abattement": C.abattement_taux(cat),
            "abattement_minimum": C.abattement_minimum(),
            "taux_social": C.taux_social(cat, caisse),
            "taux_cfp": C.taux_cfp(cat, caisse),
            "taux_versement_liberatoire": C.taux_versement_liberatoire(cat),
            "plafond_ca": plafond,
            "plafond_proratise": proratise,
            "acre": C.acre(),
            "provenance": C.provenance(),
        },
        4,  # les taux sont des fractions : 2 décimales les écraseraient
    )


def constantes_fiscales() -> Dict[str, Any]:
    """Barèmes et taux en vigueur, avec leur provenance et leur date de contrôle.

    À appeler pour citer un taux à l'utilisateur : ces valeurs sont datées et
    sourcées, contrairement à celles que le modèle porterait en mémoire.
    """
    return {
        "abattements": {
            c.value: C.abattement_taux(c) for c in CategorieFiscale
        },
        "plafonds_ca": {c.value: C.plafond_ca(c) for c in CategorieFiscale},
        "taux_sociaux": {
            "BIC_VENTE": C.taux_social(CategorieFiscale.bic_vente),
            "BIC_SERVICE": C.taux_social(CategorieFiscale.bic_service),
            "BNC_REGIME_GENERAL": C.taux_social(CategorieFiscale.bnc, CaisseBNC.regime_general),
            "BNC_CIPAV": C.taux_social(CategorieFiscale.bnc, CaisseBNC.cipav),
        },
        "versement_liberatoire": {
            **{c.value: C.taux_versement_liberatoire(c) for c in CategorieFiscale},
            "rfr_max_par_part": C.rfr_maximum_par_part(),
        },
        "bareme_ir": C.bareme_tranches(),
        "quotient_familial": {"plafond_demi_part": C.plafond_demi_part()},
        "decote": {
            "celibataire": C.decote(False)[0],
            "couple": C.decote(True)[0],
            "taux": C.decote(False)[1],
        },
        "provenance": C.provenance(),
    }


# --- Registre ---------------------------------------------------------------
@dataclass(frozen=True)
class OutilFiscal:
    """Description d'un outil, indépendante de tout framework d'agent."""

    nom: str
    fonction: Callable[..., Dict[str, Any]]
    description: str
    args_model: Optional[Type[BaseModel]] = None

    def pour_langchain(self) -> Dict[str, Any]:
        """Arguments prêts pour `StructuredTool.from_function`."""
        params: Dict[str, Any] = {
            "func": self.fonction,
            "name": self.nom,
            "description": self.description,
        }
        if self.args_model is not None:
            params["args_schema"] = self.args_model
        return params


def _resume(fn: Callable[..., Any]) -> str:
    """Première phrase de la docstring : ce que l'agent lit pour décider."""
    doc = (fn.__doc__ or "").strip()
    return doc.split("\n\n")[0].replace("\n", " ").strip()


OUTILS: List[OutilFiscal] = [
    OutilFiscal("simuler_impots", simuler_impots, _resume(simuler_impots)),
    OutilFiscal("calculer_base_imposable", calculer_base_imposable, _resume(calculer_base_imposable)),
    OutilFiscal("calculer_cotisations", calculer_cotisations, _resume(calculer_cotisations)),
    OutilFiscal("calculer_ir_bareme", calculer_ir_bareme, _resume(calculer_ir_bareme)),
    OutilFiscal("verifier_plafonds", verifier_plafonds, _resume(verifier_plafonds)),
    OutilFiscal("parametres_categorie", parametres_categorie, _resume(parametres_categorie)),
    OutilFiscal("constantes_fiscales", constantes_fiscales, _resume(constantes_fiscales)),
]

OUTILS_PAR_NOM: Dict[str, OutilFiscal] = {o.nom: o for o in OUTILS}
