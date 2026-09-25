from app.models import Box, BoxType, Rack

_BOX_CAPACITY = {
    BoxType.CARTON_81.value: 81,
    BoxType.PLASTIC_100.value: 100,
}

# Tipo asumido para las subcajas de un rack que aún no fueron creadas en la base,
# para no subestimar la capacidad física configurada en `rack.capacity`
# (ver backend/app/seed/layout.yaml). Es el tamaño más chico, para no sobreestimarla.
_EMPTY_SLOT_BOX_TYPE = BoxType.CARTON_81.value


def box_capacity(box_type: str) -> int:
    return _BOX_CAPACITY[box_type]


def rack_capacity(rack: Rack, boxes: list[Box] | None = None) -> int:
    """Capacidad de un rack en posiciones: las cajas ya creadas aportan su tamaño
    real; las subcajas de `rack.capacity` que todavía no existen se asumen del
    tipo `_EMPTY_SLOT_BOX_TYPE`."""
    existing = rack.boxes if boxes is None else boxes
    known_capacity = sum(box_capacity(box.box_type) for box in existing)
    empty_slots = max(rack.capacity - len(existing), 0)
    return known_capacity + empty_slots * box_capacity(_EMPTY_SLOT_BOX_TYPE)


def percent(active: int, capacity: int) -> float:
    return round(active / capacity * 100, 2) if capacity else 0.0
