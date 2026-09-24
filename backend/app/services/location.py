"""Ubicación legible de una muestra, p. ej. `III · F12 · 3B` (sección · rack+caja ·
posición). Vive fuera de `app/api` para que `samples.py` y `movements.py` puedan
compartirla sin depender uno del otro."""

from app.models import Sample
from app.schemas.sample import SampleRead, SampleWithLocation


def location_string(sample: Sample) -> str:
    box = sample.box
    rack = box.rack
    section = rack.section
    return f"{section.code} · {rack.letter}{box.number} · {sample.position}"


def sample_with_location(sample: Sample) -> SampleWithLocation:
    data = SampleRead.model_validate(sample).model_dump()
    data["location"] = location_string(sample)
    return SampleWithLocation(**data)
