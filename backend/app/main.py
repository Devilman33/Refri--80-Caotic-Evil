from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import alerts, autocomplete, boxes, movements, occupancy, racks, samples, sections, users
from app.config import get_settings

app = FastAPI(title="Refri -80 · Inventario de muestras")

# El frontend corre en un origen distinto al backend. Un wildcard permitiría a
# cualquier sitio ejecutar mutaciones (POST /movements, etc.) contra el inventario,
# así que se restringe a los orígenes configurados (ver CORS_ORIGINS en .env.example).
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins_list,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(users.router)
app.include_router(sections.router)
app.include_router(racks.router)
app.include_router(boxes.router)
app.include_router(samples.router)
app.include_router(movements.router)
app.include_router(occupancy.router)
app.include_router(autocomplete.router)
app.include_router(alerts.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
