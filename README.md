# Refri -80 · Inventario de muestras

Sistema de inventario del freezer de -80 °C de Environ: ubicación de cada muestra en un visor 3D,
registro de congelamientos y descongelamientos con trazabilidad completa, búsqueda con filtros
y porcentaje de ocupación.

- Requisitos funcionales: [`requirements.md`](requirements.md)
- Formulario de movimientos (igual al Google Form del laboratorio): [`docs/FORMULARIO.md`](docs/FORMULARIO.md)
- Datos de origen e importación: [`docs/DATOS.md`](docs/DATOS.md)
- Visor 3D de referencia: [`demo.html`](demo.html) (ábrelo en el navegador)

## Desarrollo con agentes

GitHub Copilot y Claude trabajan en bucle sobre los issues: uno implementa y el otro revisa.
El funcionamiento y la configuración están en [`docs/BUCLE.md`](docs/BUCLE.md). Las reglas que
siguen ambos están en [`.github/copilot-instructions.md`](.github/copilot-instructions.md).

## Datos reales

El Excel del laboratorio **no se versiona**. Déjalo en `Data/` (carpeta ignorada por git) y
cárgalo con el importador cuando exista (ver `docs/DATOS.md`).

## Cómo levantar el proyecto

Requisitos: Docker y Docker Compose.

```bash
cp .env.example .env
docker compose up
```

Esto levanta Postgres y el backend (FastAPI). El backend, al arrancar, corre las migraciones
de Alembic y siembra la distribución física del freezer (`backend/app/seed/layout.yaml`).
Verificá que quedó arriba con:

```bash
curl http://localhost:8000/health
# {"status":"ok"}
```

### Backend en local (sin Docker)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp ../.env.example .env   # ajustá DATABASE_URL si tu Postgres no corre en "db"
alembic upgrade head
python -m app.seed.seed
uvicorn app.main:app --reload
```

### Tests

Los tests corren contra un Postgres real (no mocks: la restricción de posición única vive en
la base de datos). Con Docker ya tenés uno disponible en `docker compose up db`; luego:

```bash
cd backend
DATABASE_URL=postgresql+psycopg://refri:refri@localhost:5432/refri pytest
```

CI (`.github/workflows/ci.yml`) hace lo mismo contra un servicio Postgres efímero.
