"""Agent de suivi des obligations déclaratives — prépare, ne transmet jamais.

Cinq déclarations possibles pour un micro-entrepreneur : CA URSSAF, DES, TVA (CA3), déclaration
annuelle de revenus (2042-C-PRO) et CFE. Cet agent produit pour chacune un **brouillon calqué
sur le formulaire officiel**, prêt à être recopié sur le téléservice.

Trois interdits structurants, hérités de la spécification :

  1. **Il ne calcule aucun montant lui-même.** Tout vient de `app.agents.impots` — un second
     calcul divergerait tôt ou tard du premier.
  2. **Il ne transmet jamais.** La validation et l'envoi restent entièrement humains.
  3. **Il n'invente aucun numéro de case.** Une référence non recoupée est signalée « à
     vérifier » plutôt que présentée comme fiable — c'est le cas du CA3 aujourd'hui.

Un quatrième, propre au fond fiscal : **l'abattement n'est jamais déduit avant de remplir une
case**. Les cases 5KO / 5KP / 5HQ attendent le CA BRUT ; l'administration applique l'abattement.
Le déduire ici l'appliquerait deux fois.
"""

from .generateur import generer_declarations
from .schemas import (
    Brouillon,
    ChampBrouillon,
    JeuDeclarations,
    Rappel,
)

__all__ = [
    "generer_declarations",
    "Brouillon",
    "ChampBrouillon",
    "JeuDeclarations",
    "Rappel",
]
