"""Contexte déclaratif déduit du profil d'onboarding — préremplissage, jamais imposition.

L'utilisateur a déjà répondu à ces questions pendant son parcours. Les lui reposer serait une
double saisie, et deux saisies du même fait finissent par diverger.

Rien n'est inventé : un champ non renseigné reste vide, et le brouillon dit ce qu'il ne pourra
pas établir plutôt que de le combler.
"""

from __future__ import annotations

from typing import Any, Dict, List

from app.schemas.orchestrator import UserProfile

from .schemas import ContexteDeclaratif

_CATEGORIE = {"BIC_VENTE": "BIC_VENTE", "BIC_SERVICE": "BIC_SERVICE", "BNC": "BNC"}
# Repli quand `fiscal_category` n'a pas été déclaré : `tax_category` est déduit par la
# classification et ne distingue pas vente et prestation de service commerciale.
_CATEGORIE_DEPUIS_TAX = {"BNC": "BNC", "BIC": "BIC_SERVICE"}


def contexte_depuis_profil(profil: UserProfile) -> ContexteDeclaratif:
    """Préremplit le contexte déclaratif depuis ce qui a été déclaré à l'onboarding."""
    return ContexteDeclaratif(
        frequence=profil.periodicite_urssaf or "trimestrielle",
        categorie_par_defaut=_categorie(profil),
        caisse_bnc=profil.bnc_caisse or "REGIME_GENERAL",
        acre_active=bool(profil.acre_active),
        option_versement_liberatoire=bool(profil.versement_liberatoire),
        # `regime_tva` est DÉCLARÉ : la plateforme ne bascule jamais seule un régime de TVA.
        assujetti_tva=(profil.regime_tva or "").strip().lower() in ("reel_simplifie", "reel_normal"),
        numero_tva_intracom=profil.numero_tva_intracommunautaire,
        date_creation=profil.activity_start_date or profil.creation_date,
        departement=_departement(profil),
        ca_annuel_cumule=profil.cumulative_revenue_current_year,
    )


def _categorie(profil: UserProfile) -> str:
    declaree = _CATEGORIE.get(profil.fiscal_category or "")
    if declaree:
        return declaree
    return _CATEGORIE_DEPUIS_TAX.get(profil.tax_category or "") or "BNC"


def _departement(profil: UserProfile) -> str | None:
    """Département déduit du code postal de l'adresse au registre.

    Sert UNIQUEMENT à rappeler que l'échéance de la déclaration annuelle en dépend — jamais
    à calculer une date, qui change chaque année et doit être vérifiée à la source.
    """
    adresse = profil.company_address or profil.registry_address or ""
    for morceau in adresse.replace(",", " ").split():
        if morceau.isdigit() and len(morceau) == 5:
            return morceau[:2]
    return None


def informations_manquantes(profil: UserProfile) -> List[Dict[str, str]]:
    """Ce qui manque au profil, et ce que le brouillon ne pourra pas établir sans.

    Ce ne sont pas des erreurs : les brouillons sortent quand même. Mais mieux vaut annoncer
    la limite d'avance que la laisser découvrir au moment de recopier sur le site officiel.
    """
    manquants: List[Dict[str, str]] = []

    if not profil.periodicite_urssaf:
        manquants.append({
            "champ": "periodicite_urssaf",
            "libelle": "Périodicité de déclaration (mensuelle ou trimestrielle)",
            "consequence": "La période proposée par défaut est trimestrielle.",
        })
    if not (profil.activity_start_date or profil.creation_date):
        manquants.append({
            "champ": "activity_start_date",
            "libelle": "Date de création de l'activité",
            "consequence": (
                "L'exonération de CFP la première année et celle de CFE ne peuvent pas être "
                "appliquées."
            ),
        })
    if not profil.fiscal_category:
        manquants.append({
            "champ": "fiscal_category",
            "libelle": "Catégorie fiscale de l'activité",
            "consequence": (
                "Les prestations seront rattachées à la catégorie déduite de votre profil : "
                "elle commande la case de la déclaration de revenus et les taux appliqués."
            ),
        })
    if not profil.regime_tva:
        manquants.append({
            "champ": "regime_tva",
            "libelle": "Régime de TVA (franchise en base ou assujetti)",
            "consequence": (
                "Le brouillon suppose la franchise en base : aucune déclaration de TVA n'est "
                "produite."
            ),
        })
    if not profil.numero_tva_intracommunautaire:
        manquants.append({
            "champ": "numero_tva_intracommunautaire",
            "libelle": "N° de TVA intracommunautaire",
            "consequence": (
                "Indispensable pour déposer une DES si vous encaissez depuis l'Union "
                "européenne — et certaines plateformes ne paient pas sans lui."
            ),
        })
    return manquants


def contexte_dict(profil: UserProfile) -> Dict[str, Any]:
    return contexte_depuis_profil(profil).model_dump(mode="json")
