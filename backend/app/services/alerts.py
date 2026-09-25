"""Clasificación de subcajas para las alertas.

Vive acá y no en el endpoint porque el umbral de "casi llena" y la definición de
"llena" tienen que ser los mismos que usa la vista de % de uso: si el backend y el
frontend calculan distinto, el contador dice 8 y la tabla muestra 7, y nadie sabe cuál
creer. El espejo en el frontend es `frontend/src/utils/occupancy.ts`.
"""

from __future__ import annotations

from app.schemas.occupancy import BoxOccupancy

# Mismo umbral que `NEAR_FULL_PERCENT` en frontend/src/utils/occupancy.ts (issue #7).
NEAR_FULL_PERCENT = 90.0

# Centinela que el importador asigna a las filas sin Encargado (~20 % del Excel, ver
# docs/DATOS.md). No es una persona: es el marcador de "falta este dato".
UNASSIGNED_INITIALS = "SIN_ASIG"


def is_full(box: BoxOccupancy) -> bool:
    """Llena por conteo, o marcada completa.

    Desde la parte 2 el formulario ya no pregunta "¿La caja está llena?": `is_full` se
    calcula. Pero el Excel histórico trae "Caja Completa Si/No" con criterio físico (no
    entran más tubos), y esa marca sigue contando.
    """
    return bool(box.is_full) or (box.capacity > 0 and box.active >= box.capacity)


def is_nearly_full(box: BoxOccupancy) -> bool:
    return not is_full(box) and box.percent >= NEAR_FULL_PERCENT


def is_inconsistent_full(box: BoxOccupancy) -> bool:
    """Declarada completa en el formulario pero con posiciones libres.

    Es la alerta más accionable de las cuatro, porque describe un dato equivocado y no
    una caja incómoda: alguien marcó "llena" y todavía entra un tubo. Sale gratis de los
    datos que la vista de ocupación ya calcula.
    """
    return bool(box.is_full) and box.active < box.capacity
