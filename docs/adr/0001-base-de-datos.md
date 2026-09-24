# ADR 0001: PostgreSQL como base de datos

## Estado

Aceptado.

## Contexto

`requirements.md` pide evaluar explícitamente Mongo vs Postgres para el inventario del freezer
-80. Los datos que hay que modelar son:

- Una jerarquía física fija: sección (I–IV) → rack (A–H, centro/derecha) → subcaja → posición
  (ver "Modelo físico" en `docs/DATOS.md`).
- Una restricción de integridad no negociable: **una posición solo puede tener una muestra
  activa a la vez** (`.github/copilot-instructions.md`).
- Un historial de movimientos (`freeze`/`thaw`) que nunca se borra y que referencia muestra,
  operador, caja y posición en cada momento: trazabilidad con integridad referencial.
- Búsquedas con filtros combinados (ID, encargado, núcleo, fecha, estado, ubicación) y vistas de
  % de uso agregando por rack/subcaja/sección.

## Decisión

Usamos **PostgreSQL 16** en vez de MongoDB.

- **La restricción de "una activa por posición" se expresa nativamente** como un índice único
  parcial (`UNIQUE ... WHERE status = 'active'`). En Mongo tocaría aplicarla a mano en la
  capa de aplicación (o con validación a nivel de documento), con riesgo de condiciones de
  carrera entre movimientos concurrentes.
- **El dominio es relacional, no de documentos**: las entidades (usuario, sección, rack, caja,
  muestra, movimiento) tienen relaciones fijas y consultas que cruzan varias de ellas a la vez
  (p. ej. "muestras núcleo de un encargado en una sección", "% de uso por rack"). Eso son joins
  y agregaciones que SQL expresa directo; en Mongo requeriría desnormalizar o usar `$lookup`
  en casi cada consulta.
- **Integridad referencial real**: `movements.sample_id`, `samples.box_id`, `boxes.rack_id`,
  etc. deben apuntar siempre a una fila válida. Postgres lo garantiza con FKs; en Mongo sería
  responsabilidad de la aplicación.
- El volumen de datos es modesto (~7.600 tubos según `docs/DATOS.md`), así que no hay una
  ventaja de escala horizontal que justifique un documento-store.
- Encaja con el stack elegido (FastAPI + SQLAlchemy 2 + Alembic), que da migraciones versionadas
  del esquema — importante porque el modelo físico y el importador van a seguir evolucionando.

## Consecuencias

- El esquema y sus cambios se versionan con Alembic (`backend/alembic/`).
- La regla de "una muestra activa por posición" se aplica en la base de datos (índice único
  parcial), no solo en la aplicación, así que ninguna carrera entre requests puede violarla.
- Si en el futuro aparecen datos verdaderamente no estructurados (por ejemplo, metadatos
  clínicos variables de `Nucleo (2)` / `Cultivo`, fuera del alcance inicial según
  `docs/DATOS.md`), se pueden modelar con columnas `JSONB` de Postgres sin necesitar una base
  de datos distinta.
