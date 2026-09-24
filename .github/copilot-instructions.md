# Refri -80 · Inventario de muestras

Instrucciones compartidas por GitHub Copilot y Claude. Ambos agentes trabajan en bucle
(ver `docs/BUCLE.md`): uno implementa y el otro revisa. **`requirements.md` es la fuente
de verdad funcional**; si algo aquí lo contradice, manda `requirements.md`.

## Qué es

Sistema de inventario para un freezer de -80 °C donde se almacenan muestras.
Jerarquía física: **sección (I–IV) → rack (A–H) → caja → posición**. Hay cajas de cartón de
9×9 (posiciones `1A`…`9I`) y plásticas de 10×10 (`1`…`100`).

- `demo.html`: visor 3D del refrigerador que a los usuarios les encantó. **Hay que reutilizarlo**
  (portar su lógica 3D al frontend sin reescribirla desde cero ni cambiar su estética). Su geometría
  debe generarse a partir de la base de datos (ver `docs/DATOS.md`).
- **`docs/FORMULARIO.md`**: el formulario de la página debe ser **idéntico** al Google Form que
  el laboratorio ya usa (mismos campos, orden y opciones). Cada envío es un movimiento.
- **`docs/DATOS.md`**: estructura del Excel de origen, reglas de limpieza e importador.
  El Excel real **no está en el repo** y nunca debe subirse. Los tests usan un Excel sintético
  generado por código.

## Reglas de dominio (no negociables)

- Datos de una muestra: **ID Environ, ID Origen, Encargado, Pasaje, Núcleo, Fecha**, más su ubicación.
- Cada muestra está vinculada a un usuario **encargado**, que puede ver dónde están sus muestras.
- **Nunca se borran muestras**. Retirar = cambiar estado + registrar quién, cuándo y motivo.
  Todo movimiento (ingreso, traslado, retiro) queda en una tabla de eventos para trazabilidad.
- Una posición solo puede tener una muestra activa a la vez (restricción en base de datos).
- Muestras con `Núcleo = Sí` muestran un **warning** visible en todas las vistas.
- Luces en las cajas: **roja = posición ocupada**, **verde = posición libre**.
- Vista de % de uso por rack, caja y subcaja.
- Vista tabla/lista sin el 3D.
- Búsqueda con filtros (ID, encargado, núcleo, fecha, estado, ubicación) que muestre dónde está la muestra.
- Formulario de ingreso con autocompletado: sugiere los valores repetidos del mismo set/encargado
  y permite ingresar varias muestras consecutivas del mismo set.

## Stack acordado

Para que ambos agentes no se contradigan, usen este stack salvo que un ADR en `docs/adr/` lo cambie:

- **Base de datos: PostgreSQL 16.** Los datos son relacionales (ubicaciones jerárquicas,
  unicidad de posición, historial de eventos con integridad referencial), así que conviene más que MongoDB.
  La justificación va en `docs/adr/0001-base-de-datos.md`.
- **Backend:** Python 3.12, FastAPI, SQLAlchemy 2, Alembic y pytest, en `backend/`.
- **Frontend:** React + Vite + TypeScript + three.js (portando el visor de `demo.html`), en `frontend/`.
- **Local:** `docker compose up` levanta db + backend + frontend.
- La CI (`.github/workflows/ci.yml`) corre `pytest` en `backend/` con `DATABASE_URL` de Postgres
  y `npm run build` / `npm test` en `frontend/`. Mantenla en verde.

## Cómo trabajar

- PRs pequeños y enfocados en un solo issue. Incluye tests para la lógica nueva.
- Código e identificadores en inglés; textos de la UI, commits y descripciones de PR en español.
- No subas secretos ni archivos `.env`. Configuración por variables de entorno (`.env.example`).
- Actualiza `README.md` cuando cambie cómo se instala o se ejecuta el proyecto.
- Cuando una revisión automática (de Claude o de Copilot) pida cambios, atiende cada punto en el
  mismo PR. Si discrepas de uno, explica por qué en un comentario en vez de ignorarlo.
