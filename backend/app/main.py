from fastapi import FastAPI

app = FastAPI(title="Refri -80 API")


@app.get("/health")
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}
