"""Orchestrateur DÉTERMINISTE de la feuille de route.

Chaîne unique et non contradictoire :
    analyse_juridique.analyser()  ──►  verdict légal pur (catégorie, durabilité, marges)
              │
              ├─► presentation.choisir_parcours()  ──►  parcours UX (bandes d'affichage)
              ├─► presentation.*                   ──►  bandeau, étapes, phases
              ├─► comparateur.*                    ──►  scénarios sourcés + comparatif
              └─► analyse_juridique.legal_sources()──►  sources enrichies

Le bandeau, les étapes et les scénarios découlent tous de la MÊME analyse : il est
structurellement impossible d'obtenir un bandeau « société » avec des étapes « micro ».
`valider_coherence` le vérifie avant tout renvoi.

Sortie : un dict JSON (contrat inchangé), construit et validé via les modèles Pydantic de
app.roadmap.models. Aucune valeur métier n'est codée en dur : tout vient de data/seuils.yaml.
"""
from __future__ import annotations

from app.config import settings
from app.agents.guidance.roadmap import analyse_juridique as AJ
from app.agents.guidance.roadmap import comparateur as C
from app.agents.guidance.roadmap import presentation as P
from app.agents.guidance.roadmap import seuils as S
from app.agents.guidance.roadmap.analyse_juridique import DURABILITE_INDET
from app.agents.guidance.roadmap.models import Fraicheur, Meta, Roadmap
from app.agents.guidance.roadmap.presentation import PARCOURS_BASCULE, PARCOURS_MICRO, PARCOURS_SOCIETE

__all__ = [
    "PARCOURS_MICRO", "PARCOURS_SOCIETE", "PARCOURS_BASCULE",
    "build_roadmap", "verdict_regime", "decide_regime",
    "valider_coherence", "RoadmapIncoherente",
]


# ---------------------------------------------------------------------------
#  Décision : analyse juridique + parcours UX en une structure
# ---------------------------------------------------------------------------
def decide_regime(profil: dict) -> dict:
    """Décision déterministe : combine l'analyse juridique et le parcours UX.

    Expose aussi l'objet `analyse` (AnalyseJuridique) pour les appelants qui veulent le verdict
    légal pur, découplé de l'affichage.
    """
    analyse = AJ.analyser(profil)
    parcours = P.choisir_parcours(analyse)
    return {
        "analyse": analyse,
        "parcours": parcours,
        "categorie": analyse.categorie,
        "ca": analyse.ca_retenu.ca_global,
        "seuil_micro": analyse.seuil_effectif,
        "seuil_micro_plein": analyse.seuil_plein,
        "seuil_micro_source": analyse.source_legale,
        "prorata": analyse.prorata,
        "ratio": analyse.ratio_legal,
        "durabilite": analyse.durabilite,
    }


# ---------------------------------------------------------------------------
#  Verdict injectable comme contrainte dans les réponses du LLM
# ---------------------------------------------------------------------------
def _question_manquante(analyse) -> str | None:
    """La seule question qui empêche encore de trancher, s'il en reste une."""
    if analyse.durabilite != DURABILITE_INDET:
        return None
    if analyse.categorie == "mixte" and not (analyse.ca_retenu.ca_prestations > 0
                                             and analyse.ca_retenu.ca_vente > 0):
        return ("Peux-tu préciser la répartition de ton chiffre d'affaires entre tes prestations "
                "de services et ta vente de produits ?")
    return ("Ton chiffre d'affaires de l'an dernier dépassait-il déjà le plafond micro ? "
            "Cela détermine si la sortie du régime s'applique.")


def verdict_regime(profil: dict) -> dict | None:
    """Position DÉTERMINISTE sur le régime, à injecter comme contrainte dans les réponses LLM.

    C'est ce qui empêche l'agent pédagogique de contredire la feuille de route : il doit
    s'aligner sur ce verdict plutôt que raisonner librement sur les seuils.

    None si le CA est inconnu ou nul : aucune décision n'est possible, donc aucune contrainte
    n'est imposée.
    """
    if not float(profil.get("ca_estime_annuel") or 0):
        return None
    analyse = AJ.analyser(profil)
    parcours = P.choisir_parcours(analyse)
    return {
        "parcours": parcours,
        "categorie": analyse.categorie,
        "seuil_micro": analyse.seuil_effectif,
        "durabilite": analyse.durabilite,
        "question_manquante": _question_manquante(analyse),
        "phrase": P.phrase_regime(analyse, parcours),
    }


# ---------------------------------------------------------------------------
#  Fraîcheur / meta
# ---------------------------------------------------------------------------
def _fraicheur(legal_sources) -> Fraicheur:
    """Drapeau de fraîcheur global : la source la PLUS ancienne décide."""
    max_days = int(settings.freshness_max_days)
    pires = [S.fraicheur(ls.date_verif, max_days) for ls in legal_sources]
    perime = any(f["perime"] for f in pires)
    jours = [f["jours"] for f in pires if f["jours"] is not None]
    return Fraicheur(perime=perime, max_days=max_days, jours_max=max(jours) if jours else None)


# ---------------------------------------------------------------------------
#  Construction complète
# ---------------------------------------------------------------------------
def build_roadmap(profil: dict) -> dict:
    """Construit la roadmap déterministe à embranchements et la renvoie en dict JSON.

    profil['choix_parcours'] ('micro' | 'societe') permet, en zone de bascule, de RECOMPOSER
    la roadmap selon le choix explicite de l'utilisateur.
    """
    profil = profil or {}
    analyse = AJ.analyser(profil)
    parcours = P.choisir_parcours(analyse)
    categorie = analyse.categorie

    # En zone de bascule, l'utilisateur peut trancher : la roadmap se recompose.
    choix = profil.get("choix_parcours")
    choix_fait = parcours == PARCOURS_BASCULE and choix in (PARCOURS_MICRO, PARCOURS_SOCIETE)
    if choix_fait:
        etapes_parcours = choix
    elif parcours == PARCOURS_SOCIETE:
        etapes_parcours = PARCOURS_SOCIETE
    else:  # micro OU bascule sans choix : on présente le parcours micro (option prudente immédiate)
        etapes_parcours = PARCOURS_MICRO

    etapes = P.construire_etapes(etapes_parcours, categorie, profil)
    phases = P.grouper_en_phases(etapes)
    legal_sources = AJ.legal_sources(analyse)

    roadmap = Roadmap(
        profil=profil,
        parcours=parcours,
        etapes_parcours=etapes_parcours,
        choix_fait=choix_fait,
        categorie=categorie,
        durabilite=analyse.durabilite,
        analyse_juridique=analyse,
        bandeau=P.bandeau(analyse, parcours),
        regime_recommande=P.phrase_regime(analyse, parcours),
        seuils_profil=P.seuils_profil(analyse),
        legal_sources=legal_sources,
        scenarios=C.scenarios(analyse, profil),
        projections=C.projections(analyse, profil),
        etapes=etapes,
        phases=phases,
        comparatif=C.comparatif(analyse, profil) if parcours == PARCOURS_BASCULE else None,
        mixte=P.explication_mixte(analyse) if categorie == "mixte" else None,
        prorata=analyse.prorata if analyse.prorata.applique else None,
        meta=Meta(annee=S.annee(), date_verif=S.date_verif(), fraicheur=_fraicheur(legal_sources)),
    )

    out = roadmap.model_dump(mode="json")
    valider_coherence(out)
    return out


# ---------------------------------------------------------------------------
#  GARDE-FOU DE COHÉRENCE — appelé avant tout renvoi
# ---------------------------------------------------------------------------
class RoadmapIncoherente(ValueError):
    """Levée si le bandeau/régime et les étapes n'appartiennent pas au même parcours."""


def valider_coherence(roadmap: dict) -> None:
    """Vérifie que régime, bandeau et étapes appartiennent au même parcours (jamais de renvoi
    contradictoire à l'usager)."""
    parcours = roadmap.get("parcours")
    bandeau_type = roadmap.get("bandeau", {}).get("type")
    etapes = roadmap.get("etapes", [])
    etapes_parcours = roadmap.get("etapes_parcours")

    if bandeau_type != parcours:
        raise RoadmapIncoherente(
            f"Bandeau '{bandeau_type}' incohérent avec le parcours décidé '{parcours}'."
        )
    if not etapes:
        raise RoadmapIncoherente("Roadmap sans étapes.")

    tags = {e.get("parcours") for e in etapes}
    if len(tags) != 1:
        raise RoadmapIncoherente(f"Étapes de parcours mélangés : {tags}.")
    (tag,) = tags
    if tag != etapes_parcours:
        raise RoadmapIncoherente(
            f"Étapes taggées '{tag}' mais parcours effectif annoncé '{etapes_parcours}'."
        )

    if parcours in (PARCOURS_MICRO, PARCOURS_SOCIETE):
        if tag != parcours:
            raise RoadmapIncoherente(
                f"Parcours '{parcours}' mais étapes '{tag}' : bandeau et étapes divergent."
            )
    else:  # bascule : étapes micro OU societe, et un comparatif est obligatoire
        if tag not in (PARCOURS_MICRO, PARCOURS_SOCIETE):
            raise RoadmapIncoherente(f"Bascule : étapes de parcours inattendu '{tag}'.")
        if not roadmap.get("comparatif"):
            raise RoadmapIncoherente("Bascule sans comparatif Micro vs Société.")
