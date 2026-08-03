"""Moteur de calcul fiscal micro-entreprise, exposé sous forme d'outils.

Déterministe de bout en bout : aucun appel LLM, aucune valeur en dur. Les
constantes vivent dans `data/seuils.yaml` et `data/impot_revenu.yaml`, avec
leur source et leur date de contrôle.

    from app.agents.impots.tools import OUTILS, simuler_impots

Les agents appellent ces outils ; ils ne refont pas les calculs.
"""

from .constantes import CaisseBNC, CategorieFiscale
from .tools import OUTILS, OUTILS_PAR_NOM

__all__ = ["CaisseBNC", "CategorieFiscale", "OUTILS", "OUTILS_PAR_NOM"]
