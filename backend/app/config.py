import os
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Intake agent LLM (Google AI Studio / Gemini)
    gemini_api_key: str
    gemini_model: str = "gemini-2.5-flash"

    # Legacy — ignored by intake; kept so old .env files still load
    mistral_api_key: str | None = None
    mistral_model: str = "mistral/mistral-large-latest"

    frontend_origin: str = "http://localhost:3000"
    mongo_uri: str = "mongodb://localhost:27017"
    mongo_db_name: str = "ledgermind"
    freshness_max_days: int = 120

    # Corpus fiscal (RAG) — embeddings via l'endpoint Gemini compatible OpenAI, vecteurs en Mongo.
    # Aucune base vectorielle ni modèle local à installer.
    embedding_model: str = "gemini-embedding-001"

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
        env_file = ".env"
        extra = "ignore"


settings = Settings()

os.environ.setdefault("GEMINI_API_KEY", settings.gemini_api_key)
if settings.mistral_api_key:
    os.environ.setdefault("MISTRAL_API_KEY", settings.mistral_api_key)
