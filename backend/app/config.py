import os
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    mistral_api_key: str
    mistral_model: str = "mistral/mistral-large-latest"

    frontend_origin: str = "http://localhost:3000"

    class Config:
        env_file = ".env"
        extra = "ignore"  # ignore unused env vars (INSEE, INPI keys)


settings = Settings()

os.environ.setdefault("MISTRAL_API_KEY", settings.mistral_api_key)