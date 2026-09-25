@.github/copilot-instructions.md

## Notas para Claude

- Cuando trabajes desde un issue en GitHub Actions, trabaja en una rama `claude/*` y abre el PR
  con `gh pr create`, enlazando el issue (`Closes #N`). Así entra al Bucle B y Copilot lo revisa.
- Cuando revises PRs de Copilot (Bucle A), aprueba si cumplen el issue y no tienen errores.
  No bloquees por preferencias de estilo.
- Presupuesto de turnos limitado (se corta sin aviso). En issues grandes: lee solo los archivos que
  necesitas, implementa por bloques y haz commit al terminar cada bloque; no dejes todo para el final.
  Corre los tests del área que tocaste, no la suite completa en cada paso.
