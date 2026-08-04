"""Contexte fiscal déduit du profil d'onboarding — préremplissage, jamais imposition.

L'utilisateur a déjà répondu à ces questions pendant son parcours : les lui reposer dans
l'écran de rapport serait une double saisie, et deux saisies du même fait finissent par
diverger. Ce module fait le pont entre `UserProfile` (ce qui a été déclaré) et
`ContexteFiscalRapport` (ce dont le moteur d'impôt a besoin).

Deux règles :

  * **Rien n'est inventé.** Un champ non renseigné à l'onboarding reste `None` dans le
    contexte, et le moteur refusera de calculer ce qu'il ne peut pas calculer.
  * **Rien n'est imposé.** Le résultat est un PRÉREMPLISSAGE : l'écran l'affiche, et
    l'utilisateur peut le corriger avant de lancer le calcul. Sa correction fait autorité.
"""

from __future__ import annotations

from typing import Any, Dict, List

from app.schemas.orchestrator import UserProfile

from .schemas import ContexteFiscalRapport

# Correspondance entre la catégorie déclarée à l'onboarding et celle du moteur d'impôt.
# `fiscal_category` est plus précis que `tax_category` : il distingue vente et prestation,
# que l'abattement et le taux de cotisations ne traitent pas de la même façon.
_CATEGORIE = {"BIC_VENTE": "BIC_VENTE", "BIC_SERVICE": "BIC_SERVICE", "BNC": "BNC"}

# Repli quand `fiscal_category` n'a pas été renseigné : `tax_category` est déduit par la
# classification et ne distingue pas vente et prestation de service commerciale.
_CATEGORIE_DEPUIS_TAX = {"BNC": "BNC", "BIC": "BIC_SERVICE"}


def contexte_depuis_profil(profil: UserProfile) -> ContexteFiscalRapport:
    """Préremplit le contexte du rapport à partir de ce qui a été déclaré à l'onboarding."""
    return ContexteFiscalRapport(
        parts_fiscales=profil.fiscal_parts,
        autres_revenus=profil.other_household_income,
        en_couple=profil.family_status in ("marie", "pacse"),
        rfr_n2=profil.rfr_n_minus_2,
        caisse_bnc=profil.bnc_caisse or "REGIME_GENERAL",
        acre_active=bool(profil.acre_active),
        option_versement_liberatoire=bool(profil.versement_liberatoire),
        dom=profil.location_zone == "dom",
        categorie_par_defaut=_categorie_par_defaut(profil),
        jours_activite=None,  # dépend de la période demandée, pas du profil
    )


def _categorie_par_defaut(profil: UserProfile) -> str:
    declaree = _CATEGORIE.get(profil.fiscal_category or "")
    if declaree:
        return declaree
    deduite = _CATEGORIE_DEPUIS_TAX.get(profil.tax_category or "")
    return deduite or "BNC"


def origine_des_champs(profil: UserProfile) -> Dict[str, Any]:
    """D'où vient chaque valeur préremplie, et laquelle manque encore.

    Sert à l'écran : un champ vide parce que la question n'a pas été posée n'a pas le même
    sens qu'un champ vide parce que l'utilisateur a répondu « je ne sais pas ». Le premier
    se complète, le second est une non-réponse assumée.
    """
    inconnus = set(profil.unknown_fields or [])

    def etat(champ: str, valeur: Any) -> str:
        if valeur not in (None, "", []):
            return "onboarding"
        return "sans_reponse" if champ in inconnus else "non_renseigne"

    return {
        "parts_fiscales": etat("fiscal_parts", profil.fiscal_parts),
        "autres_revenus": etat("other_household_income", profil.other_household_income),
        "rfr_n2": etat("rfr_n_minus_2", profil.rfr_n_minus_2),
        "caisse_bnc": etat("bnc_caisse", profil.bnc_caisse),
        "en_couple": etat("family_status", profil.family_status),
        "acre_active": etat("acre_active", profil.acre_active),
        "option_versement_liberatoire": etat("versement_liberatoire", profil.versement_liberatoire),
        "dom": etat("location_zone", profil.location_zone),
        "categorie_par_defaut": etat("fiscal_category", profil.fiscal_category),
    }


def champs_bloquants(profil: UserProfile) -> List[Dict[str, str]]:
    """Informations sans lesquelles le rapport ne peut PAS conclure, et ce qu'il perd.

    Ce ne sont pas des erreurs : le rapport se produit quand même. Mais il vaut mieux dire
    d'avance ce qui ne sera pas calculé plutôt que de laisser l'utilisateur découvrir un
    « non calculé » sans explication.
    """
    manquants: List[Dict[str, str]] = []

    if profil.fiscal_parts is None or profil.other_household_income is None:
        manquants.append({
            "champ": "foyer_fiscal",
            "libelle": "Parts fiscales et autres revenus du foyer",
            "consequence": (
                "L'impôt sur le revenu au barème ne sera pas calculé : le barème est "
                "progressif, il dépend de l'ensemble des revenus du foyer. Cotisations et "
                "base imposable restent calculées."
            ),
        })
    if profil.rfr_n_minus_2 is None:
        manquants.append({
            "champ": "rfr_n_minus_2",
            "libelle": "Revenu fiscal de référence de l'année N-2",
            "consequence": (
                "L'éligibilité au versement libératoire ne pourra pas être tranchée, ni la "
                "comparaison avec le barème."
            ),
        })
    if not profil.fiscal_category:
        manquants.append({
            "champ": "fiscal_category",
            "libelle": "Catégorie fiscale de l'activité",
            "consequence": (
                "Les prestations seront traitées par défaut selon la catégorie déduite de "
                "votre profil ; abattement et taux de cotisations en dépendent."
            ),
        })
    return manquants
