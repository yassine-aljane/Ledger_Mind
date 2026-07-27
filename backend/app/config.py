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
    session_db_path: str = "sessions.db"

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()

os.environ.setdefault("GEMINI_API_KEY", settings.gemini_api_key)
if settings.mistral_api_key:
    os.environ.setdefault("MISTRAL_API_KEY", settings.mistral_api_key)
