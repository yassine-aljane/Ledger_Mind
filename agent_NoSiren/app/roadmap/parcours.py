"""Façade de compatibilité du moteur de roadmap.

Le moteur a été DÉCOUPÉ en modules pour la maintenabilité :
  • app.roadmap.analyse_juridique — moteur juridique pur (droit strict, durabilité N-1/N-2)
  • app.roadmap.comparateur       — scénarios déterministes 100 % sourcés + comparatif
  • app.roadmap.presentation      — couche UX (bandes, phrases, étapes, phases)
  • app.roadmap.roadmap_builder   — orchestration + garde-fou de cohérence
  • app.roadmap.models            — modèles Pydantic de sortie

Ce module ne fait que RÉ-EXPORTER l'API publique historique pour ne casser aucun import
existant (`from app.roadmap import parcours`, `from app.roadmap.parcours import build_roadmap`).
Les nouveaux appelants peuvent importer directement les modules ci-dessus.
"""
from __future__ import annotations

from app.roadmap.analyse_juridique import (  # noqa: F401
    DURABILITE_DURABLE,
    DURABILITE_INDET,
    DURABILITE_PONCTUEL,
    DURABILITE_STABLE,
    categorie_activite,
    seuil_micro_reference,
)
from app.roadmap.presentation import (  # noqa: F401
    BANDE_BASCULE_BAS,
    BANDE_BASCULE_HAUT,
    PARCOURS_BASCULE,
    PARCOURS_MICRO,
    PARCOURS_SOCIETE,
)
from app.roadmap.roadmap_builder import (  # noqa: F401
    RoadmapIncoherente,
    build_roadmap,
    decide_regime,
    valider_coherence,
    verdict_regime,
)
