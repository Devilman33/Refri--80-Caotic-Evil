import type { BoxRead, BoxType, RackRead, SectionRead } from "../api/types";

// El refri real solo tiene los racks del centro y de la derecha de cada estante
// (docs/DATOS.md "Modelo físico"): la posición izquierda del demo no existe y no
// se dibuja. La cantidad de subcajas por rack sale de la base de datos, no de un
// número fijo como en demo.html.
export interface LayoutBox {
  id: number;
  number: number;
  boxType: BoxType;
}

export interface LayoutRack {
  id: number;
  letter: string;
  slot: "center" | "right";
  /** Subcajas que caben físicamente en el rack (`rack.capacity`, ver seed/layout.yaml). */
  capacity: number;
  boxes: LayoutBox[];
}

export interface LayoutSection {
  id: number;
  code: string;
  center: LayoutRack | null;
  right: LayoutRack | null;
}

export type FreezerLayout = LayoutSection[];

const SECTION_ORDER = ["I", "II", "III", "IV"];

function sectionRank(code: string): number {
  const index = SECTION_ORDER.indexOf(code);
  return index === -1 ? SECTION_ORDER.length : index;
}

export function buildFreezerLayout(
  sections: SectionRead[],
  racks: RackRead[],
  boxes: BoxRead[],
): FreezerLayout {
  const boxesByRack = new Map<number, LayoutBox[]>();
  // Las cajas y racks dados de baja no se dibujan: su lugar queda libre (parte 3).
  for (const box of boxes.filter((entry) => entry.active !== false)) {
    const list = boxesByRack.get(box.rack_id) ?? [];
    list.push({ id: box.id, number: box.number, boxType: box.box_type });
    boxesByRack.set(box.rack_id, list);
  }
  for (const list of boxesByRack.values())
    list.sort((a, b) => a.number - b.number);

  const racksBySection = new Map<number, RackRead[]>();
  for (const rack of racks.filter((entry) => entry.active !== false && entry.slot !== null)) {
    const list = racksBySection.get(rack.section_id) ?? [];
    list.push(rack);
    racksBySection.set(rack.section_id, list);
  }

  const toLayoutRack = (rack: RackRead): LayoutRack => ({
    id: rack.id,
    letter: rack.letter,
    slot: rack.slot!,
    capacity: rack.capacity,
    boxes: boxesByRack.get(rack.id) ?? [],
  });

  return [...sections]
    .sort((a, b) => sectionRank(a.code) - sectionRank(b.code))
    .map((section) => {
      const sectionRacks = racksBySection.get(section.id) ?? [];
      const center =
        sectionRacks.find((rack) => rack.slot === "center") ?? null;
      const right = sectionRacks.find((rack) => rack.slot === "right") ?? null;
      return {
        id: section.id,
        code: section.code,
        center: center ? toLayoutRack(center) : null,
        right: right ? toLayoutRack(right) : null,
      };
    });
}

/** Cantidad de columnas ("fondo") usada para acomodar las subcajas de un rack en
 * una grilla, igual que en demo.html (`C.fondo = 4`), pero con tantas filas
 * ("pisos") como haga falta según la cantidad real de subcajas. */
export const RACK_GRID_COLUMNS = 4;

export function rackGridRows(boxCount: number): number {
  if (boxCount <= 0) return 0;
  return Math.ceil(boxCount / RACK_GRID_COLUMNS);
}

/** Huecos a dibujar en el rack: su capacidad configurada, o más si alguna subcaja
 * tiene un número mayor (datos históricos), para no superponer cajas. */
export function rackSlotCount(
  rack: Pick<LayoutRack, "capacity" | "boxes">,
): number {
  const highest = rack.boxes.reduce((max, box) => Math.max(max, box.number), 0);
  return Math.max(rack.capacity, highest);
}

/** Fila/columna de la subcaja con número `number` (1-based): cada caja va en su hueco
 * físico aunque falten las anteriores. */
export function boxSlotPosition(number: number): BoxGridPosition {
  return boxGridPosition(Math.max(number, 1) - 1);
}

export interface BoxGridPosition {
  row: number;
  column: number;
}

/** Fila/columna de la subcaja `index` (0-based) dentro de la grilla del rack,
 * de arriba hacia abajo y de izquierda a derecha. */
export function boxGridPosition(index: number): BoxGridPosition {
  return {
    row: Math.floor(index / RACK_GRID_COLUMNS),
    column: index % RACK_GRID_COLUMNS,
  };
}

// ---------- Cajas precargadas (visor 3D igual a demo.html) ----------

/** Pisos de un rack del manual serie J (demo.html `C.pisos`): 5 pisos × 4 cajas de fondo. */
export const RACK_PISOS = 5;

/** Hueco físico de un rack. Todos los huecos se dibujan aunque la caja todavía no
 * exista en la base (`box: null`): el visor muestra el freezer completo desde el inicio. */
export interface RackBoxSlot {
  number: number;
  /** P1 = piso superior (igual que demo.html). */
  piso: number;
  /** F1 = frente. */
  fondo: number;
  box: LayoutBox | null;
  /** Tipo de la caja registrada; las cajas aún sin registrar se asumen de cartón 9 × 9. */
  boxType: BoxType;
}

/** Pisos a dibujar: los 5 del demo, o más si hay cajas con número mayor (datos reales). */
export function rackPisos(
  rack: Pick<LayoutRack, "capacity" | "boxes">,
): number {
  return Math.max(RACK_PISOS, rackGridRows(rackSlotCount(rack)));
}

/** Todos los huecos del rack, numerados como en demo.html: n = (piso − 1) × 4 + fondo. */
export function rackBoxSlots(
  rack: Pick<LayoutRack, "capacity" | "boxes">,
): RackBoxSlot[] {
  const byNumber = new Map(rack.boxes.map((box) => [box.number, box]));
  const total = rackPisos(rack) * RACK_GRID_COLUMNS;
  const slots: RackBoxSlot[] = [];
  for (let number = 1; number <= total; number += 1) {
    const { row, column } = boxSlotPosition(number);
    const box = byNumber.get(number) ?? null;
    slots.push({
      number,
      piso: row + 1,
      fondo: column + 1,
      box,
      boxType: box?.boxType ?? "carton_81",
    });
  }
  return slots;
}

/** Código corto de una subcaja, igual al campo "Nombre Caja" del formulario (p. ej. `A5`). */
export function boxCode(rackLetter: string, number: number): string {
  return `${rackLetter}${number}`;
}

export type ViewerQuery =
  | {
      ok: true;
      rackLetter: string;
      boxNumber: number | null;
      position: string | null;
    }
  | { ok: false; message: string };

const QUERY_RE =
  /^\s*([A-Ha-h])\s*(?:[-\s·.\/]*\s*(\d{1,3})(?:\s*[-\s·.\/]+\s*(\d{1,3}[A-Ia-i]?|[A-Ia-i]\d))?)?\s*$/;

/** Búsqueda del panel del visor: `A` (rack), `A5` (subcaja) o `A5-3B` / `G3-10` (posición). */
export function parseViewerQuery(raw: string): ViewerQuery {
  const match = QUERY_RE.exec(raw);
  if (!match) {
    return {
      ok: false,
      message:
        "Usa el formato A5 (rack y caja), A5-3B para una posición o A para un rack.",
    };
  }
  const rackLetter = match[1].toUpperCase();
  const boxNumber = match[2] ? Number(match[2]) : null;
  if (boxNumber !== null && boxNumber <= 0)
    return { ok: false, message: "Las cajas se numeran desde 1." };
  let position: string | null = null;
  if (match[3]) {
    const value = match[3].toUpperCase();
    // Se acepta también el orden letra-número (B3) y se normaliza a número-letra (3B).
    position = /^[A-I]\d$/.test(value) ? `${value[1]}${value[0]}` : value;
  }
  return { ok: true, rackLetter, boxNumber, position };
}

export interface LidGrid {
  rows: string[];
  columns: string[];
  /** Ids de posición por fila (de arriba hacia abajo) y columna (de izquierda a derecha). */
  cells: string[][];
}

/** Grilla de la subcaja vista desde arriba: cartón = filas A–I × columnas 1–9 (`3B` = columna 3,
 * fila B); plástica = 10 × 10 numerada de izquierda a derecha y de arriba hacia abajo. */
export function lidGrid(boxType: BoxType): LidGrid {
  if (boxType === "carton_81") {
    const rows = "ABCDEFGHI".split("");
    const columns = Array.from({ length: 9 }, (_, index) => String(index + 1));
    return {
      rows,
      columns,
      cells: rows.map((row) => columns.map((column) => `${column}${row}`)),
    };
  }
  const rows = Array.from({ length: 10 }, (_, index) => String(index * 10 + 1));
  const columns = Array.from({ length: 10 }, (_, index) => String(index + 1));
  return {
    rows,
    columns,
    cells: rows.map((_, row) =>
      columns.map((_, column) => String(row * 10 + column + 1)),
    ),
  };
}
