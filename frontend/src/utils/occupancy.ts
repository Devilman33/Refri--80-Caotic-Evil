import type { BoxOccupancy, FreezerOccupancy } from "../api/types";

// Umbral de "casi llena" pedido en el issue #7.
export const NEAR_FULL_PERCENT = 90;

export type UsageLevel = "inconsistent" | "full" | "near-full" | "normal" | "empty";

export const USAGE_LEVEL_LABELS: Record<UsageLevel, string> = {
  inconsistent: "Llena con huecos",
  full: "Llena",
  "near-full": "Casi llena",
  normal: "Con espacio",
  empty: "Vacía",
};

/** Nivel de uso según el % ocupado. Una subcaja declarada "completa" en el
 * formulario cuenta como llena aunque el conteo de posiciones no llegue al 100 %. */
export function usageLevel(item: Pick<FreezerOccupancy, "active" | "capacity" | "percent"> & { is_full?: boolean | null }): UsageLevel {
  // Declarada completa pero con lugar: es un dato equivocado, no una caja incómoda.
  // Va primero porque es más específico que "llena" y se pierde si se evalúa después.
  if (item.is_full && item.capacity > 0 && item.active < item.capacity) return "inconsistent";
  if (item.is_full) return "full";
  if (item.capacity > 0 && item.active >= item.capacity) return "full";
  if (item.percent >= NEAR_FULL_PERCENT) return "near-full";
  if (item.active === 0) return "empty";
  return "normal";
}

export function formatPercent(percent: number): string {
  return `${percent.toLocaleString("es-CL", { maximumFractionDigits: 1 })} %`;
}

/** Nombre corto de una subcaja, como en el formulario: sección · rack + número (p. ej. "II · C5"). */
export function boxLabel(box: Pick<BoxOccupancy, "section_code" | "rack_letter" | "number">): string {
  return `${box.section_code} · ${box.rack_letter}${box.number}`;
}

export type BoxSortKey = "percent" | "location" | "free";
export type SortDirection = "asc" | "desc";

const SECTION_ORDER = ["I", "II", "III", "IV"];

function compareLocation(a: BoxOccupancy, b: BoxOccupancy): number {
  return (
    SECTION_ORDER.indexOf(a.section_code) - SECTION_ORDER.indexOf(b.section_code) ||
    a.rack_letter.localeCompare(b.rack_letter) ||
    a.number - b.number
  );
}

/** Ordena las subcajas sin mutar el arreglo original. Desempata por ubicación. */
export function sortBoxes(boxes: BoxOccupancy[], key: BoxSortKey, direction: SortDirection): BoxOccupancy[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...boxes].sort((a, b) => {
    let diff = 0;
    if (key === "percent") diff = a.percent - b.percent;
    else if (key === "free") diff = a.capacity - a.active - (b.capacity - b.active);
    else diff = compareLocation(a, b);
    return sign * diff || compareLocation(a, b);
  });
}

/** Subcajas que conviene destacar: llenas, casi llenas (≥ 90 %) o mal declaradas. */
export function isHighlighted(box: BoxOccupancy): boolean {
  const level = usageLevel(box);
  return level === "full" || level === "near-full" || level === "inconsistent";
}

/** Los cuatro estados del control segmentado. Cada contador de alertas apunta a uno:
 * con un solo booleano "destacadas", dos de los contadores caerían en la misma pantalla
 * y alguno sería un número sobre el que nadie puede actuar. */
export type BoxFilter = "all" | "full" | "near-full" | "inconsistent";

export const BOX_FILTER_LABELS: Record<BoxFilter, string> = {
  all: "Todas",
  full: "Llenas",
  "near-full": "Casi llenas",
  inconsistent: "Llenas con huecos",
};

export function matchesBoxFilter(box: BoxOccupancy, filter: BoxFilter): boolean {
  if (filter === "all") return true;
  const level = usageLevel(box);
  // "Llenas" incluye las mal declaradas: están llenas según el formulario. El filtro
  // específico las aísla para corregirlas.
  if (filter === "full") return level === "full" || level === "inconsistent";
  return level === filter;
}
