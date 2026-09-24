# Refri -80 · Inventario de muestras

Sistema de inventario del freezer de -80 °C de Environ: ubicación de cada muestra en un visor 3D,
registro de congelamientos y descongelamientos con trazabilidad completa, búsqueda con filtros
y porcentaje de ocupación.

- Requisitos funcionales: [`requirements.md`](requirements.md)
- Formulario de movimientos (igual al Google Form del laboratorio): [`docs/FORMULARIO.md`](docs/FORMULARIO.md)
- Datos de origen e importación: [`docs/DATOS.md`](docs/DATOS.md)
- Visor 3D de referencia: [`demo.html`](demo.html) (ábrelo en el navegador)

## Desarrollo con agentes

GitHub Copilot y Claude trabajan en bucle sobre los issues: uno implementa y el otro revisa.
El funcionamiento y la configuración están en [`docs/BUCLE.md`](docs/BUCLE.md). Las reglas que
siguen ambos están en [`.github/copilot-instructions.md`](.github/copilot-instructions.md).

## Datos reales

El Excel del laboratorio **no se versiona**. Déjalo en `Data/` (carpeta ignorada por git) y
cárgalo con el importador cuando exista (ver `docs/DATOS.md`).
