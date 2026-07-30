"""Rule Engine — registre déclaratif des obligations fiscales par régime (data/regimes/*.yaml).

Ajouter un régime = ajouter un fichier YAML dans `data/regimes/` : ce module ne connaît AUCUN
régime en dur, et le Decision Engine (moteur.py) ne fait qu'itérer sur ce que ce module renvoie.
Un régime absent du registre renvoie simplement une liste vide (jamais une erreur, jamais une
obligation inventée).
"""

from __future__ import annotations

from functools import lru_cache

import yaml

from app.core.paths import REGIMES_DIR


@lru_cache(maxsize=1)
def _charger_tout() -> list[dict]:
    if not REGIMES_DIR.exists():
        return []
    return [
        yaml.safe_load(fichier.read_text(encoding="utf-8"))
        for fichier in sorted(REGIMES_DIR.glob("*.yaml"))
    ]


def reload() -> list[dict]:
    """Vide le cache et relit les fichiers — utile en test ou après une mise à jour à chaud."""
    _charger_tout.cache_clear()
    return _charger_tout()


def obligations_pour_regime(regime: str) -> list[dict]:
    for bloc in _charger_tout():
        if bloc.get("regime") == regime:
            return bloc.get("obligations", [])
    return []


def _condition_verifiee(condition: dict, contexte: dict) -> bool:
    """Évaluateur déclaratif minimal — volontairement simple (pas de DSL, pas de dépendance de
    "business rule engine") : {champ: valeur} = égalité, {champ: {"vrai": bool}} = vérité stricte.
    """
    for champ, attendu in condition.items():
        valeur = contexte.get(champ)
        if isinstance(attendu, dict):
            if "vrai" in attendu and bool(valeur) != bool(attendu["vrai"]):
                return False
        elif valeur != attendu:
            return False
    return True


def applicable(obligation: dict, contexte: dict) -> bool:
    return _condition_verifiee(obligation.get("applicable_si") or {}, contexte)
