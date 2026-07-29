"""Modèles Pydantic de sortie du moteur de roadmap déterministe.

La structure de la roadmap N'EST PLUS un dictionnaire ad hoc : elle est décrite ici par
des modèles typés et validés. `build_roadmap` construit ces modèles puis les sérialise en
dict (`model_dump(mode="json")`) au seul point public, car la couche de persistance
(`store.save_roadmap`) fait un `json.dumps` et le PDF/les tests consomment un dict. Le
typage sert donc à la CONSTRUCTION (validation, documentation, garde-fous), le dict au
TRANSPORT — le contrat JSON exposé par FastAPI reste identique.

Aucune valeur métier n'est codée ici : ces modèles ne portent que des STRUCTURES. Toutes
les valeurs fiscales proviennent de data/seuils.yaml (cf. app.roadmap.seuils).
"""
from __future__ import annotations

from typing import Optional, Union

from pydantic import BaseModel


class CaRetenu(BaseModel):
    """Chiffre d'affaires retenu, ventilé par catégorie fiscale."""
    ca_prestations: float
    ca_vente: float
    ca_global: float


class Prorata(BaseModel):
    """Prorata temporis de la 1re année (seuil ajusté au nombre de jours d'existence)."""
    applique: bool
    seuil_plein: int
    source: Optional[str] = None
    jours: Optional[int] = None
    seuil_ajuste: Optional[int] = None
    formule: Optional[str] = None
    raison: Optional[str] = None


class LegalSource(BaseModel):
    """Source légale d'un chiffre du verdict, avec TOUTES les métadonnées de seuils.yaml."""
    label: str
    valeur: Union[int, float, str]
    annee: int
    source: str
    date_verif: str


class Etape(BaseModel):
    """Étape de la feuille de route, taggée par son parcours et sa phase."""
    id: str
    parcours: str
    phase: str
    titre: str
    detail: str
    lien: str
    obligatoire: bool
    duree: Optional[str] = None
    cout: Optional[str] = None
    cout_source: Optional[str] = None


class Phase(BaseModel):
    id: Optional[str]
    titre: str
    etapes: list[Etape]


class Bandeau(BaseModel):
    type: str
    titre: str
    texte: str


class SeuilProfil(BaseModel):
    label: str
    seuil: int
    position: float
    unite: str
    source: str
    seuil_plein: Optional[int] = None


class Comparatif(BaseModel):
    seuil_micro: int
    regle_franchissement: str
    colonnes: list[str]
    lignes: list[list[str]]
    sources: list[str]


class Mixte(BaseModel):
    titre: str
    texte: str
    source: str


class ScenarioMontant(BaseModel):
    """Un montant CALCULÉ à partir d'une valeur sourcée (jamais une hypothèse inventée)."""
    label: str
    valeur: str            # déjà formaté (« 23 040 € »)
    base: Optional[str] = None   # explique le calcul (« 90 000 € × 25,6 % »)
    source: str


class Scenario(BaseModel):
    """Carte de scénario déterministe (analyse « expert-comptable » 100 % sourcée)."""
    id: str
    titre: str
    hypothese: Optional[str] = None
    faits: list[str]
    montants: list[ScenarioMontant]
    obligations: list[str]
    sources: list[str]


class MargeSeuil(BaseModel):
    """Marge restante avant un seuil légal (conséquence légale, pas de rentabilité)."""
    label: str
    seuil: int
    position: float
    marge: float           # seuil - position (négatif si franchi)
    depasse: bool
    source: str


class StatutTVA(BaseModel):
    """Statut de TVA projeté d'après le CA retenu et les seuils de franchise sourcés."""
    statut: str            # 'franchise' | 'redevable_base' | 'redevable_majore'
    libelle: str
    seuil_base: int
    seuil_majore: int
    source: str


class SortieMicro(BaseModel):
    """Projection déterministe de sortie du régime micro (règle des 2 années consécutives)."""
    exclusion: bool                     # sortie AVÉRÉE (deux dépassements consécutifs) ?
    annee_estimee: Optional[int] = None
    libelle: str
    source: str


class Projections(BaseModel):
    """Projections DÉTERMINISTES de conséquences LÉGALES (jamais de rentabilité)."""
    statut_tva: StatutTVA
    marges: list[MargeSeuil]
    sortie_micro: SortieMicro
    obligations_futures: list[str]


class AnalyseJuridique(BaseModel):
    """Verdict juridique PUR : ne connaît ni l'UX ni les bandes d'affichage."""
    categorie: str
    ca_retenu: CaRetenu
    seuil_plein: int
    seuil_effectif: int
    ratio_legal: float
    durabilite: str
    depassement_cette_annee: bool
    historique_connu: bool
    marge_micro_euros: float
    marge_micro_pourcent: float
    marge_tva_euros: float
    prorata: Prorata
    motifs: list[str]
    source_legale: str


class Fraicheur(BaseModel):
    perime: bool
    max_days: int
    jours_max: Optional[int] = None


class Meta(BaseModel):
    annee: int
    date_verif: str
    fraicheur: Fraicheur


class Roadmap(BaseModel):
    """Roadmap complète. Sérialisée en dict au point public (contrat JSON inchangé)."""
    profil: dict
    parcours: str
    etapes_parcours: str
    choix_fait: bool
    categorie: str
    durabilite: str
    analyse_juridique: AnalyseJuridique
    bandeau: Bandeau
    regime_recommande: str
    seuils_profil: list[SeuilProfil]
    legal_sources: list[LegalSource]
    scenarios: list[Scenario]
    projections: Projections
    etapes: list[Etape]
    phases: list[Phase]
    comparatif: Optional[Comparatif] = None
    mixte: Optional[Mixte] = None
    prorata: Optional[Prorata] = None
    meta: Meta
