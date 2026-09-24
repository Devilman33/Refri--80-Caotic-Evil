# Refri -80 · Inventario de muestras

Sistema de inventario del freezer de -80 °C de Environ: ubicación de cada muestra en un visor 3D,
registro de congelamientos y descongelamientos con trazabilidad completa, búsqueda con filtros
y porcentaje de ocupación.

- Requisitos funcionales: [`requirements.md`](requirements.md)
- Formulario de movimientos (igual al Google Form del laboratorio): [`docs/FORMULARIO.md`](docs/FORMULARIO.md)
- Datos de origen e importación: [`docs/DATOS.md`](docs/DATOS.md)
- Visor 3D de referencia: [`demo.html`](demo.html) (ábrelo en el navegador)
- Decisión de base de datos: [`docs/adr/0001-base-de-datos.md`](docs/adr/0001-base-de-datos.md)

## Desarrollo con agentes

GitHub Copilot y Claude trabajan en bucle sobre los issues: uno implementa y el otro revisa.
El funcionamiento y la configuración están en [`docs/BUCLE.md`](docs/BUCLE.md). Las reglas que
siguen ambos están en [`.github/copilot-instructions.md`](.github/copilot-instructions.md).

## Backend base

### Requisitos

- Docker y Docker Compose
- Python 3.12 (solo para correr el backend/tests fuera de contenedores)

### Variables de entorno

Copia `.env.example` a `.env` y ajusta los valores si hace falta.

```bash
cp .env.example .env
```

### Levantar PostgreSQL + backend

```bash
docker compose up --build
```

Servicios expuestos:

- API FastAPI: `http://localhost:8000`
- Healthcheck: `http://localhost:8000/health`
- PostgreSQL 16: `localhost:5432`

`docker compose up` sobre el stack completo ejecuta un servicio `migrate` de una sola vez antes de
levantar el backend.

### Ejecutar migraciones manualmente

```bash
cd backend
pip install -r requirements-dev.txt
export DATABASE_URL="postgresql+psycopg://<usuario>:<password>@localhost:5432/<base>"
alembic upgrade head
```

### Ejecutar tests del backend

Los tests esperan un PostgreSQL disponible en `DATABASE_URL`.

```bash
cd backend
pip install -r requirements-dev.txt
export DATABASE_URL="postgresql+psycopg://<usuario>:<password>@localhost:5432/<base_de_tests>"
python -m pytest -q
```

## Datos reales

El Excel del laboratorio **no se versiona**. Déjalo en `Data/` (carpeta ignorada por git) y
cárgalo con el importador cuando exista (ver `docs/DATOS.md`).
