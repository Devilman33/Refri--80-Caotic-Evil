# Refri -80 · Inventario de muestras

Sistema de inventario del freezer de -80 °C de Environ: ubicación de cada muestra en un visor 3D,
registro de congelamientos y descongelamientos con trazabilidad completa, búsqueda con filtros
y porcentaje de ocupación.

- Requisitos funcionales: [`requirements.md`](requirements.md)
- Formulario de movimientos (igual al Google Form del laboratorio): [`docs/FORMULARIO.md`](docs/FORMULARIO.md)
- Datos de origen e importación: [`docs/DATOS.md`](docs/DATOS.md)
- Visor 3D de referencia: [`demo.html`](demo.html) (ábrelo en el navegador)
- Mejoras pendientes y por qué se difirieron: [`docs/QOL.md`](docs/QOL.md)
- Decisiones de arquitectura: [`docs/adr/`](docs/adr/)

## Desarrollo con agentes

GitHub Copilot y Claude trabajan en bucle sobre los issues: uno implementa y el otro revisa.
El funcionamiento y la configuración están en [`docs/BUCLE.md`](docs/BUCLE.md). Las reglas que
siguen ambos están en [`.github/copilot-instructions.md`](.github/copilot-instructions.md).

## Datos reales

El Excel del laboratorio **no se versiona**. Déjalo en `Data/` (carpeta ignorada por git) y
cárgalo con el importador (ver `docs/DATOS.md`):

```bash
cd backend
python -m app.importer "../Data/Inventario Freezer -80 Environ (Nucleo).xlsx" --dry-run  # simula, sin escribir
python -m app.importer "../Data/Inventario Freezer -80 Environ (Nucleo).xlsx"             # importa de verdad
```

Es idempotente (reimportar el mismo archivo no duplica) y nunca aborta por una fila mala: al
terminar deja un reporte de anomalías en `<ruta>.anomalias.csv` (fila, columna, valor original,
motivo) para que el laboratorio las corrija.

## Respaldo

El inventario vive en un solo lugar: la base del contenedor `db`. Si ese volumen se pierde,
se pierde todo — el Excel es histórico y no tiene los movimientos registrados desde la web.

```bash
DATABASE_URL=postgresql://refri:refri@localhost:5432/refri ./scripts/backup.sh
```

El procedimiento completo (restauración, automatización con cron y con el Programador de
tareas de Windows, rotación, y cómo salir de un loop de reinicio por una migración) está en
[`docs/RESPALDO.md`](docs/RESPALDO.md). La CI ejercita el ciclo entero en cada PR: respalda,
borra un dato a propósito y comprueba que la restauración lo trae de vuelta.

## Cómo levantar el proyecto

### Requisitos

| Herramienta | Versión | Por qué esa |
|---|---|---|
| Docker + Docker Compose | cualquiera reciente | levanta Postgres, backend y frontend |
| Node | **22.12 o mayor** | `vitest@5` lo exige (`vite@8` pide `^20.19 \|\| >=22.12`, vitest es más estricto). Hay `.nvmrc`: `nvm use` |
| Python | **3.12** | lo que usan la CI y `backend/Dockerfile`. En 3.11 el código compila igual, así que la divergencia aparece en silencio en vez de fallar |

Para solo levantar el proyecto alcanza con Docker: Node y Python hacen falta para
desarrollar o correr los tests fuera de los contenedores.


```bash
cp .env.example .env
docker compose up
```

Esto levanta Postgres, el backend (FastAPI) y el frontend (React, servido con nginx). El
backend, al arrancar, corre las migraciones de Alembic y siembra la distribución física del
freezer (`backend/app/seed/layout.yaml`). Verificá que quedó arriba con:

```bash
curl http://localhost:8000/health
# {"status":"ok"}
```

El frontend queda disponible en <http://localhost:5173>.

### Frontend en local (sin Docker)

```bash
cd frontend
npm install
cp .env.example .env   # ajustá VITE_API_URL si el backend no corre en localhost:8000
npm run dev
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

### Tests del backend

Los tests corren contra un Postgres real (no mocks: la restricción de posición única vive en
la base de datos) y **borran el schema `public` entero** antes de correr, así que necesitan una
base separada de la que usa `docker compose up` (que tiene el inventario real). Con Docker ya
tenés un Postgres disponible en `docker compose up db`; creá una base de test aparte y usala:

```bash
docker compose up -d db                               # si no está levantada
docker compose exec db createdb -U refri refri_test   # una sola vez

cd backend
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt                   # sin esto: "pytest: command not found"
DATABASE_URL=postgresql+psycopg://refri:refri@localhost:5432/refri_test pytest
```

En PowerShell la última línea es otra (`VAR=valor comando` no existe ahí):

```powershell
$env:DATABASE_URL = "postgresql+psycopg://refri:refri@localhost:5432/refri_test"
pytest
```

`conftest.py` lee la **variable de entorno**, no el `.env` del backend: si falta, corta con
un mensaje que dice exactamente qué exportar.

Si no querés instalar Python 3.12 localmente, corré los tests dentro del contenedor, que ya
tiene el intérprete y las versiones pineadas de la CI:

```bash
docker compose run --rm -v "$PWD/backend:/app" \
  -e DATABASE_URL=postgresql+psycopg://refri:refri@db:5432/refri_test \
  --entrypoint sh backend -c "pip install -q -r requirements-dev.txt && python -m pytest -q"
```

CI (`.github/workflows/ci.yml`) hace lo mismo contra un servicio Postgres efímero con la base
`refri_test`.

> En los workflows de los agentes la variable ya viene exportada y los comandos compuestos
> están bloqueados: ahí se corre `python -m pytest backend/tests/<archivo> -q` desde la raíz
> (ver `CLAUDE.md`). Las dos formas son correctas, cada una en su contexto.

### Tests del frontend

```bash
cd frontend
npm ci
npm test           # Vitest + Testing Library
npm run build      # type-check (tsc -b) + build de producción
```

Si `npm ci` corta con `EBADENGINE`, tu Node es viejo: hace falta 22.12 o mayor (`nvm use`
toma la versión de `.nvmrc`). Es deliberado que corte ahí y no más adelante con un error
de vite que no menciona la versión.

`docker compose up` **no** monta volúmenes: sirve para levantar el proyecto, no para
desarrollarlo. Para el loop de desarrollo usá `npm run dev` y `uvicorn --reload`.
