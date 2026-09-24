"""Orden de lectura de las posiciones dentro de una subcaja (docs/FORMULARIO.md):
cartón se lee de arriba hacia abajo y de izquierda a derecha (columna `1..9`, fila
`A..I`); plástica se lee de izquierda a derecha y de arriba hacia abajo (`1..100`
en orden numérico)."""

from app.models import BoxType

_CARTON_ROWS = "ABCDEFGHI"


def position_order(box_type: str) -> list[str]:
    if box_type == BoxType.CARTON_81.value:
        return [f"{number}{letter}" for number in range(1, 10) for letter in _CARTON_ROWS]
    if box_type == BoxType.PLASTIC_100.value:
        return [str(number) for number in range(1, 101)]
    raise ValueError(f"Tipo de caja desconocido: {box_type}")


def next_free_position(box_type: str, occupied: set[str]) -> str | None:
    for position in position_order(box_type):
        if position not in occupied:
            return position
    return None
