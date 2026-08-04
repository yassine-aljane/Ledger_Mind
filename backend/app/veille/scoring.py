"""Décide si une nouveauté concerne un profil, et pourquoi.

Entièrement déterministe : aucun appel LLM. Le même profil et la même nouveauté donnent toujours
le même verdict, ce qui rend l'écran reproductible et le comportement testable.

Deux principes gouvernent le filtrage :

1. **Un critère non renseigné n'exclut personne.** Une nouveauté sans restriction de régime
   concerne tous les régimes — c'est le cas d'une mesure générale.
2. **Un critère renseigné face à un champ INCONNU du profil n'exclut pas non plus, mais ne
   rapporte aucun point.** On ne peut pas affirmer qu'une mesure BNC ne concerne pas quelqu'un
   dont on ignore la catégorie fiscale. La nouveauté reste candidate, avec un score faible : elle
   apparaîtra dans l'onglet Veille sans déclencher de notification.

Une contradiction FRANCHE — critère renseigné, champ connu, valeurs incompatibles — élimine.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.veille.modele import Nouveaute
from app.veille.profil import ProfilVeille

#: Score minimal pour retenir une nouveauté dans l'onglet Veille.
SEUIL_AFFICHAGE = 1.0

#: Score minimal pour déclencher une notification. Plus haut que l'affichage : on tolère du
#: contexte à la consultation, jamais dans une notification.
SEUIL_NOTIFICATION = 3.0

_POIDS = {
    "regime": 3.0,
    "tax_category": 2.5,
    "regime_tva": 2.0,
    "seuil": 2.0,
    "activite": 1.5,
    "international": 1.5,
}

_LIBELLES = {
    "regime": "votre régime",
    "tax_category": "votre catégorie fiscale",
    "regime_tva": "votre régime de TVA",
    "seuil": "un seuil que vous suivez",
    "activite": "votre activité",
    "international": "vos clients hors de France",
}


@dataclass
class Verdict:
    retenue: bool
    score: float
    pourquoi_vous: str
    champs_declencheurs: list[str]


def evaluer(nouveaute: Nouveaute, profil: ProfilVeille) -> Verdict:
    """Confronte les critères d'une nouveauté au profil."""
    criteres = nouveaute.criteres
    score = 0.0
    raisons: list[str] = []
    champs: list[str] = []

    # --- Régime
    if criteres.regimes:
        if profil.regime:
            if profil.regime in criteres.regimes:
                score += _POIDS["regime"]
                raisons.append(_LIBELLES["regime"])
                champs.append("recommended_regime")
            else:
                return _exclue("régime différent")

    # --- Catégorie fiscale
    if criteres.tax_categories:
        if profil.tax_category:
            # Un profil mixte est concerné par toute mesure BNC ou BIC.
            compatible = profil.tax_category == "mixed" or profil.tax_category in criteres.tax_categories
            if compatible:
                score += _POIDS["tax_category"]
                raisons.append(_LIBELLES["tax_category"])
                champs.append("tax_category")
            else:
                return _exclue("catégorie fiscale différente")

    # --- Régime de TVA
    if criteres.regimes_tva:
        if profil.regime_tva:
            if profil.regime_tva in criteres.regimes_tva:
                score += _POIDS["regime_tva"]
                raisons.append(_LIBELLES["regime_tva"])
                champs.append("regime_tva")
            else:
                return _exclue("régime de TVA différent")

    # --- Seuils suivis
    if criteres.seuils:
        communs = set(criteres.seuils) & profil.seuils_suivis
        if communs:
            score += _POIDS["seuil"]
            raisons.append(_LIBELLES["seuil"])
            champs.append("seuils_suivis")
        elif profil.seuils_suivis:
            # On sait quels seuils il suit, et aucun ne correspond : exclusion franche.
            return _exclue("aucun seuil concerné")

    # --- Activité
    if criteres.activites:
        cibles = set(criteres.activites)
        if cibles == {"tous"}:
            pass  # mesure générale : ne rapporte rien, n'exclut rien
        elif cibles & profil.activites:
            score += _POIDS["activite"]
            raisons.append(_LIBELLES["activite"])
            champs.append("activity_types")
        elif profil.activites != {"tous"}:
            return _exclue("activité non concernée")

    # --- International
    if criteres.international is not None:
        if profil.international is not None:
            if criteres.international == profil.international:
                if criteres.international:
                    score += _POIDS["international"]
                    raisons.append(_LIBELLES["international"])
                    champs.append("international_clients")
            else:
                return _exclue("périmètre international différent")

    # Une mesure sans aucun critère est générale : elle vaut d'être consultable, pas notifiée.
    if not raisons:
        aucun_critere = not any(
            [
                criteres.regimes,
                criteres.tax_categories,
                criteres.regimes_tva,
                criteres.seuils,
                criteres.activites,
                criteres.international is not None,
            ]
        )
        if aucun_critere:
            return Verdict(
                retenue=True,
                score=SEUIL_AFFICHAGE,
                pourquoi_vous="Mesure d'application générale.",
                champs_declencheurs=[],
            )
        return Verdict(
            retenue=True,
            score=SEUIL_AFFICHAGE,
            pourquoi_vous=(
                "Votre profil est encore incomplet : cette mesure pourrait vous concerner, "
                "sans certitude."
            ),
            champs_declencheurs=[],
        )

    # Une source opposable (Légifrance, BOFiP) pèse plus qu'une note administrative.
    if nouveaute.autorite_max == 1:
        score += 1.0

    return Verdict(
        retenue=True,
        score=score,
        pourquoi_vous=f"Concerne {_joindre(raisons)}.",
        champs_declencheurs=champs,
    )


def notifiable(verdict: Verdict, nouveaute: Nouveaute, mode: str) -> bool:
    """Un verdict suffisamment fort, compte tenu du mode choisi par l'utilisateur."""
    if not verdict.retenue or verdict.score < SEUIL_NOTIFICATION:
        return False
    if mode == "obligatoire_seulement":
        return nouveaute.impact == "action_obligatoire"
    return True


def _exclue(motif: str) -> Verdict:
    return Verdict(retenue=False, score=0.0, pourquoi_vous=motif, champs_declencheurs=[])


def _joindre(elements: list[str]) -> str:
    if len(elements) == 1:
        return elements[0]
    return f"{', '.join(elements[:-1])} et {elements[-1]}"
