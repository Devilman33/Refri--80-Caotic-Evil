from fastapi import FastAPI

from app.api import autocomplete, boxes, movements, occupancy, racks, samples, sections, users

app = FastAPI(title="Refri -80 · Inventario de muestras")

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
