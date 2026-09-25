from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import autocomplete, boxes, movements, occupancy, racks, samples, sections, users

app = FastAPI(title="Refri -80 · Inventario de muestras")

# El frontend (Vite/nginx) corre en un origen distinto al backend; no se usan
# cookies ni credenciales, así que un wildcard es seguro acá.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
