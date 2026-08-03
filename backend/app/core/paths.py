"""Emplacements de référence du dépôt.

`data/` vit à la racine, au même niveau que `backend/` et `frontend/` : les seuils fiscaux et la
liste des sources officielles sont des données du produit — sourcées, datées, revues à la main —
et non du code backend. Les y sortir rend leur revue lisible dans les diffs.

Centraliser le calcul ici évite de recompter des `parents[N]` dans chaque module qui les lit :
un déplacement de fichier ne casse plus qu'un seul endroit.
"""

from pathlib import Path

# …/backend/app/core/paths.py → parents[2] = backend/, parents[3] = racine du dépôt
BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_DIR.parent
DATA_DIR = REPO_ROOT / "data"

SEUILS_YAML = DATA_DIR / "seuils.yaml"
# Barème IR, quotient familial, décote, CFP, ACRE — complète seuils.yaml sans
# rien y dupliquer (voir l'en-tête des deux fichiers).
IMPOT_REVENU_YAML = DATA_DIR / "impot_revenu.yaml"
SOURCES_YAML = DATA_DIR / "sources.yaml"
REGIMES_DIR = DATA_DIR / "regimes"
