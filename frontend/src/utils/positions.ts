import type { BoxType } from "../api/types";

// Espejo de app/services/positions.py: orden de lectura de las posiciones
// dentro de una subcaja (docs/FORMULARIO.md). Cartón se lee de arriba hacia
// abajo y de izquierda a derecha (columna 1..9, fila A..I); plástica se lee
// de izquierda a derecha y de arriba hacia abajo (1..100 en orden numérico).
const CARTON_ROWS = "ABCDEFGHI".split("");

export function positionOrder(boxType: BoxType): string[] {
  if (boxType === "carton_81") {
    const positions: string[] = [];
    for (let number = 1; number <= 9; number += 1) {
      for (const letter of CARTON_ROWS) positions.push(`${number}${letter}`);
    }
    return positions;
  }
  const positions: string[] = [];
  for (let number = 1; number <= 100; number += 1) positions.push(String(number));
  return positions;
}

export function nextFreePosition(boxType: BoxType, occupied: ReadonlySet<string>): string | null {
  for (const position of positionOrder(boxType)) {
    if (!occupied.has(position)) return position;
  }
  return null;
}

const BOX_NAME_RE = /^([A-Ha-h])\s*(\d{1,3})$/;

/** Parte "Nombre Caja" (p. ej. `A12`) en letra de rack + N° de caja. */
export function parseBoxName(raw: string): { rackLetter: string; boxNumber: number } | null {
  const match = BOX_NAME_RE.exec(raw.trim());
  if (!match) return null;
  const boxNumber = Number(match[2]);
  if (boxNumber <= 0) return null;
  return { rackLetter: match[1].toUpperCase(), boxNumber };
}
