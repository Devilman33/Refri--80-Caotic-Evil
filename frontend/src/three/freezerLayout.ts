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

export function buildFreezerLayout(sections: SectionRead[], racks: RackRead[], boxes: BoxRead[]): FreezerLayout {
  const boxesByRack = new Map<number, LayoutBox[]>();
  for (const box of boxes) {
    const list = boxesByRack.get(box.rack_id) ?? [];
    list.push({ id: box.id, number: box.number, boxType: box.box_type });
    boxesByRack.set(box.rack_id, list);
  }
  for (const list of boxesByRack.values()) list.sort((a, b) => a.number - b.number);

  const racksBySection = new Map<number, RackRead[]>();
  for (const rack of racks) {
    const list = racksBySection.get(rack.section_id) ?? [];
    list.push(rack);
    racksBySection.set(rack.section_id, list);
  }

  const toLayoutRack = (rack: RackRead): LayoutRack => ({
    id: rack.id,
    letter: rack.letter,
    slot: rack.slot,
    boxes: boxesByRack.get(rack.id) ?? [],
  });

  return [...sections]
    .sort((a, b) => sectionRank(a.code) - sectionRank(b.code))
    .map((section) => {
      const sectionRacks = racksBySection.get(section.id) ?? [];
      const center = sectionRacks.find((rack) => rack.slot === "center") ?? null;
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

export interface BoxGridPosition {
  row: number;
  column: number;
}

/** Fila/columna de la subcaja `index` (0-based) dentro de la grilla del rack,
 * de arriba hacia abajo y de izquierda a derecha. */
export function boxGridPosition(index: number): BoxGridPosition {
  return { row: Math.floor(index / RACK_GRID_COLUMNS), column: index % RACK_GRID_COLUMNS };
}
