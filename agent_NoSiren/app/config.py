from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    mistral_api_key: str = "changeme"
    mistral_model: str = "mistral-small-latest"

    embeddings_provider: str = "local"          # "local" | "mistral"
    local_embedding_model: str = "intfloat/multilingual-e5-large"

    chroma_dir: str = "./data/chroma"
    chroma_collection: str = "corpus_fiscal_fr"

    piste_client_id: str = ""
    piste_client_secret: str = ""

    veille_enabled: bool = True
    veille_cron_hour: int = 6
    freshness_max_days: int = 120

    app_env: str = "dev"


settings = Settings()
