# ADR 0002: metadatos iniciales de muestras en el esquema base

## Estado

Aceptado.

## Contexto

`requirements.md` fija el set mínimo de datos de muestra (`environ_id`, `origin_id`, encargado, pasaje,
núcleo y fecha). Al mismo tiempo, el issue base y `docs/FORMULARIO.md` ya exigen persistir datos
operativos adicionales del flujo real del laboratorio, como `description`, `type`, `type_other` y
`notes`, para no perder información del formulario ni del inventario histórico importado desde Excel.

## Decisión

El esquema inicial de `samples` conserva el set mínimo requerido y además incorpora
`description`, `type`, `type_other` y `notes` desde la primera migración.

## Justificación

- `description` cubre el campo libre "ID Origen o Descripción" descrito en `docs/DATOS.md`.
- `type` y `type_other` son necesarios para reflejar fielmente el formulario operativo definido en
  `docs/FORMULARIO.md`.
- `notes` permite conservar observaciones del inventario legado sin degradarlas ni descartarlas en la
  carga inicial.
- Incluir estos campos desde el inicio evita migraciones destructivas tempranas sobre datos ya
  importados o movimientos ya registrados.
