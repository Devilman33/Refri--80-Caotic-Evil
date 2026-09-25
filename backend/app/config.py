from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuración de la app, cargada desde variables de entorno o `.env`."""

    database_url: str = "postgresql+psycopg://refri:refri@localhost:5432/refri"

    # Orígenes desde los que el frontend puede llamar a la API, separados por coma.
    # Un wildcard permitiría a cualquier sitio ejecutar mutaciones (POST /movements,
    # etc.) contra el inventario, así que se restringe a los orígenes conocidos.
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
