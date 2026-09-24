from fastapi import FastAPI

app = FastAPI(title="Refri -80 · Inventario de muestras")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
