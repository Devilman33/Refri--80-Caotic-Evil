from functools import lru_cache

from pydantic import ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuración de la app, cargada desde variables de entorno o `.env`."""

    # Sin default a propósito. Antes caía a `refri:refri@localhost`, así que una
    # DATABASE_URL mal seteada no fallaba: la app se conectaba en silencio a *otra* base
    # (o a ninguna) y el error aparecía mucho después. Es preferible no arrancar.
    database_url: str

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
    try:
        return Settings()
    except ValidationError as exc:
        if not any(error["loc"] == ("database_url",) for error in exc.errors()):
            raise
        raise RuntimeError(
            "Falta DATABASE_URL. La app no puede arrancar sin saber a qué base conectarse.\n"
            "  · Con docker compose: la compone `docker-compose.yml` desde POSTGRES_USER/"
            "PASSWORD/DB; copiá `.env.example` a `.env`.\n"
            "  · Fuera de docker: exportala apuntando a localhost, p. ej.\n"
            "    DATABASE_URL=postgresql+psycopg://refri:refri@localhost:5432/refri"
        ) from exc
