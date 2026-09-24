# ADR 0001: PostgreSQL como base de datos principal

## Estado

Aceptado.

## Contexto

El inventario del freezer modela una jerarquía física estable (`sections` → `racks` → `boxes` → `samples`),
requiere validar que solo exista una muestra activa por posición y necesita mantener un historial íntegro de
movimientos para trazabilidad. Además, el backend usará FastAPI + SQLAlchemy 2 + Alembic y la CI correrá tests
contra PostgreSQL.

## Decisión

Se elige PostgreSQL 16 como base de datos principal y se descarta MongoDB para la primera versión.

## Justificación

- La jerarquía física y sus relaciones de pertenencia se modelan naturalmente con claves foráneas.
- La regla "una sola muestra activa por posición" necesita una restricción fuerte a nivel base de datos; en
  PostgreSQL se implementa con un índice único parcial sobre (`box_id`, `position`) para `status = 'active'`.
- La trazabilidad de movimientos exige integridad referencial entre muestra, operador, caja y posición histórica.
- Alembic ofrece migraciones reproducibles sobre el mismo motor usado en desarrollo, tests y CI.
- MongoDB obligaría a trasladar parte importante de estas garantías al código de aplicación, con más riesgo de
  inconsistencias en concurrencia y menos soporte nativo para restricciones relacionales.

## Consecuencias

- El proyecto define `DATABASE_URL` como configuración obligatoria del backend.
- Las migraciones iniciales crean tipos, tablas, claves foráneas e índice parcial compatibles con PostgreSQL.
- La importación futura desde Excel podrá apoyarse en transacciones y upserts consistentes sobre este modelo.
