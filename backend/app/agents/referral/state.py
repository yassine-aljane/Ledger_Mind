"""State partagé entre les noeuds du graphe LangGraph (l'orchestrateur)."""
from typing import TypedDict, List, Optional, Dict


class UserInfo(TypedDict):
    nom: str
    statut: str              # ex: "micro-entreprise", "auto-entrepreneur"
    situation_fiscale: str    # ex: "BNC, TVA en franchise en base, première année d'activité"


class Comptable(TypedDict):
    nom_cabinet: str
    ville: str
    email: Optional[str]
    site_web: Optional[str]
    telephone: Optional[str]
    adresse: Optional[str]
    lat: Optional[float]
    lon: Optional[float]
    distance_km: Optional[float]
    source: str  # "overpass" | "entreprise_api"


class EmailGenere(TypedDict):
    destinataire: str
    email: Optional[str]
    objet: str
    corps: str
    statut: str  # "ok" | "email_introuvable"


class AgentState(TypedDict):
    # Inputs utilisateur
    ville: str
    demande: str
    user_info: UserInfo

    # Résultats intermédiaires
    comptables: List[Comptable]
    emails_generes: List[EmailGenere]
    ville_lat: Optional[float]
    ville_lon: Optional[float]

    # Gestion des erreurs / cas limites
    error: Optional[str]
    status: str  # "en_cours" | "termine" | "echec"
