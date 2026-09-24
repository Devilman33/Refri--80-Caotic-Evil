from app.models import BoxType

_BOX_CAPACITY = {
    BoxType.CARTON_81.value: 81,
    BoxType.PLASTIC_100.value: 100,
}


def box_capacity(box_type: str) -> int:
    return _BOX_CAPACITY[box_type]


def percent(active: int, capacity: int) -> float:
    return round(active / capacity * 100, 2) if capacity else 0.0
