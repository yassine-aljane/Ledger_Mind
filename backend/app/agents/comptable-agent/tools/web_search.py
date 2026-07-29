"""Recherche du site web officiel d'un cabinet quand il n'est pas déjà connu
(cas de l'API Recherche d'Entreprises, qui ne fournit que des données légales).
Gratuit, sans clé API.
"""
from typing import Optional
from urllib.parse import urlparse
import re
from ddgs import DDGS
from tools.text_utils import significant_tokens, clean_name

# Domaines à ignorer : annuaires/agrégateurs qui ne sont pas le site du cabinet
BLOCKLIST_DOMAINS = (
    "pagesjaunes.fr", "societe.com", "verif.com", "infogreffe.fr",
    "linkedin.com", "facebook.com", "pappers.fr", "annuaire-entreprises.data.gouv.fr",
    "google.com", "wikipedia.org",
)


def _clean(s: str) -> str:
    """Ne garde que les caractères alphanumériques, pour comparer token et
    domaine sans se faire piéger par apostrophes, tirets, etc."""
    return re.sub(r"[^a-z0-9]", "", s.lower())


def find_website(nom_cabinet: str, ville: str) -> Optional[str]:
    name = clean_name(nom_cabinet)
    tokens = [_clean(t) for t in significant_tokens(nom_cabinet)]
    tokens = [t for t in tokens if t]
    if not tokens:
        return None

    query = f"{name} expert comptable {ville}"
    try:
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=8, region="fr-fr"))
    except Exception:
        return None

    # On respecte l'ordre de pertinence de la recherche (results est déjà
    # trié), et pour chaque résultat on teste TOUS les tokens candidats -
    # ça évite qu'un mot long mais non pertinent (ex. code interne "ecprh")
    # écrase un acronyme court mais réel (ex. "tgs").
    for r in results:
        url = r.get("href") or r.get("link")
        if not url or any(bad in url for bad in BLOCKLIST_DOMAINS):
            continue
        domain = _clean(urlparse(url).netloc)
        if any(tok in domain for tok in tokens):
            return url

    return None