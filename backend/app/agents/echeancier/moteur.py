"""Decision Engine — détermine, pour un profil donné, les obligations applicables et leurs
échéances. L'interface ne décide rien : elle affiche ce que ce module renvoie.

Profil utilisateur → [Rule Engine: regles.py] → obligations applicables →
[Scheduler: dates.py] → échéances datées/statuées → ce module assemble le tout.
"""

from __future__ import annotations

from datetime import date

from app.agents.echeancier import dates as sch
from app.agents.echeancier import regles
from app.agents.echeancier.schemas import Echeance
from app.agents.echeancier.store import est_regularisee
from app.schemas.orchestrator import UserProfile


def _regime_moteur(profil: UserProfile) -> str | None:
    """Régime au sens du Rule Engine — seul "micro" est renseigné aujourd'hui (voir le plan :
    le réel/société restent un registre vide, prêt pour un futur chantier de sourcing dédié)."""
    regime = (profil.recommended_regime or profil.tax_category or "").lower()
    if "micro" in regime:
        return "micro"
    return None


def _contexte(profil: UserProfile) -> dict:
    return {
        "regime_tva": profil.regime_tva,
        "revenus_intracommunautaires": profil.revenus_intracommunautaires,
    }


def _date_creation(profil: UserProfile) -> date | None:
    brut = profil.creation_date
    if not brut:
        return None
    try:
        return date.fromisoformat(str(brut)[:10])
    except ValueError:
        return None


def parametres_manquants(profil: UserProfile) -> list[str]:
    """Champs de calendrier fiscal encore inconnus, mais seulement ceux dont dépend une
    obligation potentiellement applicable — jamais posé pour rien."""
    manquants: list[str] = []
    if _regime_moteur(profil) == "micro":
        if profil.periodicite_urssaf is None:
            manquants.append("periodicite_urssaf")
        if profil.regime_tva is None:
            manquants.append("regime_tva")
    if profil.international_clients and profil.revenus_intracommunautaires is None:
        manquants.append("revenus_intracommunautaires")
    return manquants


def generer_agenda(uid: str, profil: UserProfile, *, aujourdhui: date | None = None) -> list[Echeance]:
    aujourdhui = aujourdhui or date.today()
    regime = _regime_moteur(profil)
    if regime is None:
        return []
    contexte = _contexte(profil)
    echeances: list[Echeance] = []
    for obligation in regles.obligations_pour_regime(regime):
        if not regles.applicable(obligation, contexte):
            continue
        type_date = obligation["type_date"]
        if type_date == "cfe":
            occurrence = sch.cfe(aujourdhui, _date_creation(profil))
            if occurrence is None:
                continue  # exonération de l'année de création — pas une échéance à afficher
        else:
            resolveur = sch.RESOLVEURS[type_date]
            occurrence = resolveur(aujourdhui, profil.periodicite_urssaf)

        regularisee = est_regularisee(uid, obligation["id"], occurrence.periode)
        statut, palier = sch.statut_et_palier(occurrence.date_limite, aujourdhui, regularisee)
        echeances.append(Echeance(
            id=f"{obligation['id']}:{occurrence.periode}",
            obligation_id=obligation["id"],
            libelle=obligation["libelle"],
            periode=occurrence.periode,
            date_limite=occurrence.date_limite.isoformat() if occurrence.date_limite else None,
            fenetre_indicative=occurrence.fenetre_indicative,
            statut=statut,
            palier_alerte=palier,
            portail_paiement=obligation["portail_paiement"],
            portail_label=obligation["portail_label"],
            source=obligation["source"],
        ))

    ordre_statut = {"en_retard": 0, "urgent": 1, "a_venir": 2, "regularisee": 3}
    echeances.sort(key=lambda e: (ordre_statut[e.statut], e.date_limite or "9999-99-99"))
    return echeances
