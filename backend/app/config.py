import os
from pathlib import Path

from pydantic_settings import BaseSettings

# backend/.env — chemin absolu : les tests tournent depuis la racine du dépôt et
# uvicorn depuis backend/, un chemin relatif ne serait trouvé que dans un seul cas.
ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


class Settings(BaseSettings):
    # Intake agent LLM (Google AI Studio / Gemini)
    gemini_api_key: str
    gemini_model: str = "gemini-2.5-flash"

    # Espace guidance / assistant fiscal / veille (Mistral) — chaîne du prototype d'origine.
    # Quota distinct de celui de Gemini : l'épuisement d'un fournisseur n'éteint pas l'autre.
    mistral_api_key: str | None = None
    mistral_model: str = "mistral-small-latest"

    frontend_origin: str = "http://localhost:3000"
    mongo_uri: str = "mongodb://localhost:27017"
    mongo_db_name: str = "ledgermind"
    freshness_max_days: int = 120

    # Corpus fiscal (RAG) — embeddings Mistral, vecteurs stockés dans MongoDB.
    # Aucune base vectorielle ni modèle local à installer.
    embedding_model: str = "mistral-embed"

    # Assistant produit de la landing page — corpus dédié dans Pinecone. Il reste séparé du
    # corpus fiscal MongoDB : une question sur le prix ne doit jamais remonter un article BOFiP,
    # et une question fiscale ne doit jamais prendre une page marketing pour source juridique.
    pinecone_api_key: str | None = None
    pinecone_index_name: str = "ledgermind-product"
    pinecone_namespace: str = "product-docs"
    pinecone_cloud: str = "aws"
    pinecone_region: str = "us-east-1"
    product_rag_top_k: int = 6
    product_rag_min_score: float = 0.45

    # Veille réglementaire (Légifrance/PISTE, BOFiP, sources officielles via MCP).
    # Sans clés PISTE, la veille fonctionne quand même : les autres sources restent accessibles.
    piste_client_id: str = ""
    piste_client_secret: str = ""
    # La veille tourne toute seule (cron quotidien, aucune interface) : rien ne se déclenche au
    # démarrage, et l'échec d'une source est seulement journalisé. VEILLE_ENABLED=false la coupe.
    veille_enabled: bool = True
    veille_cron_hour: int = 6

    # Auth (JWT) — change AUTH_SECRET in production (min 32 chars)
    auth_secret: str = "ledgermind-dev-secret-change-me-32b"
    auth_token_days: int = 14

    class Config:
        env_file = ENV_FILE
        extra = "ignore"


settings = Settings()

os.environ.setdefault("GEMINI_API_KEY", settings.gemini_api_key)
if settings.mistral_api_key:
    os.environ.setdefault("MISTRAL_API_KEY", settings.mistral_api_key)
