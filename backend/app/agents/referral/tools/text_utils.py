"""Extrait le mot le plus distinctif d'un nom de cabinet (ex. "LATITUDE" dans
"LATITUDE EXPERTISE COMPTABLE"), en ignorant les termes génériques du secteur.
Sert à vérifier qu'un site web trouvé correspond bien au bon cabinet, et pas
à un site homonyme ou un annuaire qui parle simplement de comptabilité.
"""
import re
import unicodedata

STOPWORDS = {
    "expertise", "comptable", "comptables", "expert", "cabinet", "cabinets",
    "soc", "sarl", "sci", "sasu", "sas", "scp", "selarl", "et", "de", "la",
    "le", "les", "du", "des", "france", "paie", "rh", "conseil", "conseils",
    "audit", "fiduciaire", "group", "groupe", "associes", "associés",
}


def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def clean_name(nom_cabinet: str) -> str:
    """Aplati le nom pour la recherche : retire les caractères de parenthèses
    mais GARDE leur contenu, car il s'agit souvent de l'acronyme/marque
    commerciale utile (ex. "SOC FIDUCIAIRE COMPTABLE (SOFICOM)" -> le mot
    "SOFICOM" est justement ce qu'on veut retrouver dans le domaine)."""
    base = re.sub(r"[()]", " ", nom_cabinet)
    base = re.sub(r"\s+", " ", base).strip()
    return base or nom_cabinet.strip()


def significant_tokens(nom_cabinet: str) -> list:
    """Retourne les mots candidats à être le nom de marque du cabinet, du plus
    au moins probable. Une liste plutôt qu'un seul mot : un mot long comme
    "ecprh" (code interne) ne doit pas écraser un acronyme court mais réel
    comme "tgs" - on veut pouvoir tester les deux contre les résultats de recherche."""
    words = re.findall(r"[A-Za-zÀ-ÿ']+", clean_name(nom_cabinet))
    words = [_strip_accents(w).lower() for w in words]

    long_candidates = [w for w in words if len(w) >= 4 and w not in STOPWORDS]
    short_candidates = [w for w in words if len(w) >= 3 and w not in STOPWORDS]

    # Fusion en gardant l'ordre d'apparition, dédupliqué, longs d'abord
    ordered = list(dict.fromkeys(long_candidates + short_candidates))
    if ordered:
        return ordered

    return list(dict.fromkeys(words)) if words else []