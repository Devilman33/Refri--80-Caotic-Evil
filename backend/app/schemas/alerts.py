from pydantic import BaseModel

from app.schemas.occupancy import BoxOccupancy


class AlertsSummary(BaseModel):
    """Cuatro cosas que el laboratorio puede corregir, cada una con su destino propio.

    No son "cajas destacadas" en un solo saco: `full_boxes` y `nearly_full_boxes` llevan a
    estados distintos de la vista de % de uso, y `inconsistent_full_boxes` (declaradas
    completas pero con posiciones libres) es la única que describe un dato *mal*, no un
    dato incómodo. Si los cuatro contadores cayeran en la misma pantalla, alguno sería un
    número sobre el que nadie puede actuar.
    """

    unassigned_samples: int
    nearly_full_boxes: int
    full_boxes: int
    inconsistent_full_boxes: int

    @property
    def total(self) -> int:  # pragma: no cover - conveniencia para la UI
        return (
            self.unassigned_samples
            + self.nearly_full_boxes
            + self.full_boxes
            + self.inconsistent_full_boxes
        )


class AlertsRead(AlertsSummary):
    """El resumen más las subcajas involucradas, para no pedir /occupancy otra vez."""

    boxes: list[BoxOccupancy]
