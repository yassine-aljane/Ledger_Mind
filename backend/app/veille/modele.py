"""Modèle de données de la veille personnalisée.

Une nouveauté est un FAIT réglementaire dédupliqué, accompagné des critères structurés qui
disent QUI elle concerne. Ces critères sont extraits une seule fois, à la collecte : le filtrage
par utilisateur devient ensuite purement déterministe, sans appel LLM au moment de l'affichage.

Cette séparation est volontaire. Un LLM sur le chemin de lecture rendrait l'écran lent, coûteux,
et surtout non reproductible : deux consultations du même écran pourraient ne pas montrer les
mêmes nouveautés.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Impact = Literal["information", "action_recommandee", "action_obligatoire"]

#: Niveaux d'autorité, du plus contraignant au plus indicatif.
#:   1 — texte opposable (Légifrance, BOFiP)
#:   2 — source administrative officielle (URSSAF, impots.gouv.fr, service-public, DGFiP…)
#:   3 — presse spécialisée : sert à REPÉRER un sujet, jamais à l'affirmer
Autorite = Literal[1, 2, 3]

#: Vocabulaire fermé des seuils auxquels une nouveauté peut se rattacher. Fermé volontairement :
#: un seuil inventé par le LLM ne matcherait aucun profil et passerait inaperçu.
SEUILS_CONNUS = frozenset(
    {
        "micro_bnc",
        "micro_bic_vente",
        "micro_bic_service",
        "tva_franchise_services",
        "tva_franchise_vente",
        "cfe",
        "urssaf",
    }
)

#: Étiquettes d'activité, alignées sur `app.agents.echeancier.profil.concerne_pour_profil`.
ACTIVITES_CONNUES = frozenset({"influenceur", "freelance", "tous"})


class Source(BaseModel):
    """Une référence vérifiable. Sans elle, rien n'est publiable."""

    libelle: str
    url: str
    date_publication: str | None = None
    autorite: Autorite = 2


class Criteres(BaseModel):
    """À qui s'applique une nouveauté.

    Une liste VIDE signifie « pas de restriction sur ce critère » — la nouveauté concerne alors
    tout le monde de ce point de vue. C'est le défaut prudent : mieux vaut un critère trop large,
    qui sera resserré par les autres, qu'un critère inventé qui exclurait à tort.
    """

    regimes: list[str] = Field(default_factory=list)
    tax_categories: list[Literal["BNC", "BIC", "mixed"]] = Field(default_factory=list)
    regimes_tva: list[Literal["franchise", "reel_simplifie", "reel_normal"]] = Field(
        default_factory=list
    )
    seuils: list[str] = Field(default_factory=list)
    activites: list[str] = Field(default_factory=list)
    #: True = ne concerne QUE ceux qui facturent hors de France ; None = indifférent.
    international: bool | None = None

    def normalise(self) -> "Criteres":
        """Écarte les valeurs hors vocabulaire plutôt que de les propager en base."""
        return Criteres(
            regimes=[_slug(r) for r in self.regimes if r],
            tax_categories=self.tax_categories,
            regimes_tva=self.regimes_tva,
            seuils=[s for s in self.seuils if s in SEUILS_CONNUS],
            activites=[a for a in self.activites if a in ACTIVITES_CONNUES],
            international=self.international,
        )


class Nouveaute(BaseModel):
    """Un fait réglementaire, dédupliqué, daté et sourcé."""

    id: str
    titre: str
    resume: str
    impact: Impact = "information"
    echeance: str | None = None
    sources: list[Source]
    criteres: Criteres = Field(default_factory=Criteres)
    date_collecte: str
    date_verification: str
    #: Marquée périmée plutôt que supprimée : une information ancienne reste une information.
    perime: bool = False
    cycle_id: str | None = None

    @property
    def autorite_max(self) -> int:
        """Le meilleur niveau d'autorité disponible (1 = le plus fort)."""
        return min((s.autorite for s in self.sources), default=3)


class NouveauteNotifiee(BaseModel):
    """Le lien entre une nouveauté et un utilisateur : pourquoi elle lui a été montrée."""

    uid: str
    nouveaute_id: str
    pertinence: float
    pourquoi_vous: str
    champs_profil_declencheurs: list[str] = Field(default_factory=list)
    date_notifiee: str
    lue: bool = False
    date_lue: str | None = None


class PreferencesVeille(BaseModel):
    uid: str
    active: bool = True
    #: `obligatoire_seulement` ne notifie que les `action_obligatoire`.
    mode: Literal["tout", "obligatoire_seulement"] = "tout"
    updated_at: str | None = None


def _slug(valeur: str) -> str:
    """Normalise un libellé de régime : « Micro-BNC » et « micro bnc » doivent se rejoindre."""
    sans_accent = unicodedata.normalize("NFKD", valeur).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "_", sans_accent.lower()).strip("_")


#: Mots vides : articles, prépositions et auxiliaires. Deux dépêches sur la même mesure ne les
#: emploient pas de la même façon (« le plafond EST relevé » / « relèvement du plafond »).
_MOTS_VIDES = frozenset(
    {
        "le", "la", "les", "l", "de", "des", "du", "d", "un", "une", "et", "en",
        "pour", "sur", "au", "aux", "a", "par", "avec", "dans", "ce", "ces", "son",
        "est", "sont", "sera", "seront", "ont", "ete", "etre", "se", "qui", "que",
    }
)

#: Longueur de troncature des mots. « releve » et « relevement » doivent se rejoindre, sans
#: quoi une même mesure reformulée créerait deux entrées. Six caractères est un compromis :
#: assez long pour ne pas confondre « facture » et « faculté », assez court pour absorber les
#: suffixes courants du français (-ment, -ation, -é/-ée).
_TRONCATURE = 6


def cle_dedup(titre: str, echeance: str | None = None) -> str:
    """Clé de déduplication d'une mesure.

    Deux dépêches sur la même mesure n'ont ni le même titre exact ni la même URL. On se rabat
    donc sur une empreinte du titre normalisé — accents et ponctuation retirés, mots vides
    écartés, radicaux tronqués — complétée de l'échéance quand elle existe : deux mesures
    voisines avec des dates limites différentes restent bien deux nouveautés distinctes.

    C'est une heuristique, pas une preuve d'identité. Elle rapproche des reformulations
    proches ; deux titres franchement différents sur la même mesure resteront séparés. Le
    risque est assumé dans ce sens : afficher deux fois vaut mieux qu'écraser à tort.
    """
    sans_accent = unicodedata.normalize("NFKD", titre).encode("ascii", "ignore").decode()
    mots = [
        m[:_TRONCATURE]
        for m in re.findall(r"[a-z0-9]+", sans_accent.lower())
        if m not in _MOTS_VIDES
    ]
    base = " ".join(sorted(set(mots)))
    if echeance:
        base = f"{base}|{echeance}"
    return hashlib.sha256(base.encode()).hexdigest()[:32]


def maintenant() -> str:
    return datetime.now().isoformat(timespec="seconds")
