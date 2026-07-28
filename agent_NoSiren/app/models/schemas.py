from pydantic import BaseModel, Field


class AskRequest(BaseModel):
    question: str
    concerne: str | None = Field(default=None, description="influenceur | freelance | None")


class ProfilGuidance(BaseModel):
    activite: str | None = "création de contenu"
    ca_estime_annuel: float | None = 0
    vend_produits: bool | None = False
    recoit_cadeaux: bool | None = False
    # Nature de l'activité : 'prestation' (BNC) | 'vente' (BIC vente pure) | 'mixte'.
    # Prime sur l'inférence par vend_produits ; permet le cas vente pure (seuil 203 100 €).
    type_activite: str | None = None
    # Prorata temporis la 1re année : jours d'existence dans l'année N (1..364).
    premiere_annee: bool | None = False
    jours_activite: int | None = None
    anciennete: str | None = None
    # Historique de dépassement du plafond micro (règle légale des 2 années consécutives).
    # None = information non fournie -> durabilité « indéterminée » en cas de dépassement.
    ca_n_1_au_dessus_seuil: bool | None = None
    ca_n_2_au_dessus_seuil: bool | None = None
    # Affiliation Cipav (professions libérales réglementées) : taux BNC spécifique.
    cipav: bool | None = None
    affiliation: str | None = None
    # Taux de croissance annuel du CA (fraction, ex. 0.2) pour projeter la sortie du régime.
    taux_croissance: float | None = None
    # Ventilation du CA (activité mixte BIC vente + BNC prestations).
    ca_prestations: float | None = None
    ca_vente: float | None = None
    # Choix explicite en zone de bascule ('micro' | 'societe') pour recomposer la roadmap.
    choix_parcours: str | None = None


class GuidanceRequest(BaseModel):
    message: str = ""
    profil: ProfilGuidance | None = None


class RoadmapRequest(BaseModel):
    profil: ProfilGuidance
    # Si fourni, le PDF rend la roadmap PERSISTÉE de cette session (parité exacte avec le chat)
    # plutôt que d'en reconstruire une depuis le profil transmis.
    session_id: str | None = None


class RenameRequest(BaseModel):
    title: str = Field(min_length=1)


class RoadmapStateRequest(BaseModel):
    checked: dict = Field(default_factory=dict)


class ChatOption(BaseModel):
    kind: str            # ex. "choix_parcours"
    value: str           # ex. "micro" | "societe"


class ChatRequest(BaseModel):
    session_id: str | None = None
    uid: str | None = None
    message: str = Field(min_length=1)
    mode: str | None = Field(default=None, pattern="^(pedagogue|guidance)$")
    # Action générique déclenchée par un clic sur une option suggérée par le backend.
    action: ChatOption | None = None


class PatchProfilRequest(BaseModel):
    activite: str | None = None
    ca_estime: float | None = None
    vend_produits: bool | None = None
    recoit_cadeaux: bool | None = None
    anciennete: str | None = None
    situation_actuelle: str | None = None
    statut_actuel: str | None = None
    regime_actuel: str | None = None
    deja_immatricule: bool | None = None
    ca_prestations: float | None = None
    ca_vente: float | None = None
    remuneration_nature: float | None = None
    devise: str | None = None
    choix_parcours: str | None = None
    ca_n_1_au_dessus_seuil: bool | None = None
