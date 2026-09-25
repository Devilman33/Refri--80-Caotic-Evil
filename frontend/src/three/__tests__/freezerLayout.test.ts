import { describe, expect, it } from "vitest";
import type { BoxRead, RackRead, SectionRead } from "../../api/types";
import {
  boxCode,
  boxGridPosition,
  boxSlotPosition,
  buildFreezerLayout,
  lidGrid,
  parseViewerQuery,
  rackBoxSlots,
  rackGridRows,
  rackPisos,
  rackSlotCount,
} from "../freezerLayout";

const sections: SectionRead[] = [
  { id: 3, code: "III" },
  { id: 1, code: "I" },
  { id: 2, code: "II" },
  { id: 4, code: "IV" },
];

const racks: RackRead[] = [
  { id: 10, section_id: 1, letter: "A", slot: "center", capacity: 30 },
  { id: 11, section_id: 1, letter: "B", slot: "right", capacity: 30 },
  { id: 12, section_id: 2, letter: "C", slot: "center", capacity: 30 },
  // Sección III solo tiene el rack del centro: el de la derecha aún no existe.
  { id: 13, section_id: 3, letter: "E", slot: "center", capacity: 30 },
];

const boxes: BoxRead[] = [
  { id: 100, rack_id: 10, number: 2, box_type: "carton_81", label: null, owner_id: null, is_full: null },
  { id: 101, rack_id: 10, number: 1, box_type: "carton_81", label: null, owner_id: null, is_full: null },
  { id: 102, rack_id: 11, number: 1, box_type: "plastic_100", label: null, owner_id: null, is_full: null },
];

describe("buildFreezerLayout", () => {
  it("ordena las secciones I-IV sin importar el orden de entrada", () => {
    const layout = buildFreezerLayout(sections, racks, boxes);
    expect(layout.map((section) => section.code)).toEqual(["I", "II", "III", "IV"]);
  });

  it("ubica cada rack en su slot (centro/derecha) y ordena sus subcajas por número", () => {
    const layout = buildFreezerLayout(sections, racks, boxes);
    const sectionI = layout.find((section) => section.code === "I")!;
    expect(sectionI.center?.letter).toBe("A");
    expect(sectionI.center?.boxes.map((box) => box.number)).toEqual([1, 2]);
    expect(sectionI.right?.letter).toBe("B");
    expect(sectionI.right?.boxes).toEqual([{ id: 102, number: 1, boxType: "plastic_100" }]);
  });

  it("deja el slot en null cuando el rack todavía no existe en esa sección", () => {
    const layout = buildFreezerLayout(sections, racks, boxes);
    const sectionII = layout.find((section) => section.code === "II")!;
    const sectionIII = layout.find((section) => section.code === "III")!;
    const sectionIV = layout.find((section) => section.code === "IV")!;
    expect(sectionII.right).toBeNull();
    expect(sectionIII.right).toBeNull();
    expect(sectionIV.center).toBeNull();
    expect(sectionIV.right).toBeNull();
  });

  it("no dibuja ningún rack en la posición izquierda del demo (solo center/right existen)", () => {
    const layout = buildFreezerLayout(sections, racks, boxes);
    for (const section of layout) {
      for (const key of Object.keys(section)) {
        expect(["id", "code", "center", "right"]).toContain(key);
      }
    }
  });
});

describe("rackGridRows / boxGridPosition", () => {
  it("usa 4 columnas por fila, igual que demo.html", () => {
    expect(rackGridRows(0)).toBe(0);
    expect(rackGridRows(1)).toBe(1);
    expect(rackGridRows(4)).toBe(1);
    expect(rackGridRows(5)).toBe(2);
    expect(rackGridRows(30)).toBe(8);
  });

  it("ubica las subcajas de arriba hacia abajo y de izquierda a derecha", () => {
    expect(boxGridPosition(0)).toEqual({ row: 0, column: 0 });
    expect(boxGridPosition(3)).toEqual({ row: 0, column: 3 });
    expect(boxGridPosition(4)).toEqual({ row: 1, column: 0 });
    expect(boxGridPosition(9)).toEqual({ row: 2, column: 1 });
  });
});

describe("rackSlotCount / boxSlotPosition", () => {
  it("dibuja tantos huecos como la capacidad configurada del rack", () => {
    const layout = buildFreezerLayout(sections, racks, boxes);
    const rackA = layout.find((section) => section.code === "I")!.center!;
    expect(rackA.capacity).toBe(30);
    expect(rackSlotCount(rackA)).toBe(30);
  });

  it("agranda el rack si una subcaja tiene número mayor que la capacidad", () => {
    expect(rackSlotCount({ capacity: 4, boxes: [{ id: 1, number: 6, boxType: "carton_81" }] })).toBe(6);
  });

  it("ubica cada subcaja en el hueco de su número, no por su orden en la lista", () => {
    expect(boxSlotPosition(1)).toEqual({ row: 0, column: 0 });
    expect(boxSlotPosition(5)).toEqual({ row: 1, column: 0 });
    expect(boxSlotPosition(30)).toEqual({ row: 7, column: 1 });
  });
});

describe("cajas precargadas (visor igual a demo.html)", () => {
  it("dibuja 5 pisos × 4 cajas = 20 huecos aunque el rack no tenga cajas registradas", () => {
    const rack = { capacity: 20, boxes: [] };
    expect(rackPisos(rack)).toBe(5);
    const slots = rackBoxSlots(rack);
    expect(slots).toHaveLength(20);
    expect(slots.every((slot) => slot.box === null && slot.boxType === "carton_81")).toBe(true);
  });

  it("numera como el demo: P1 arriba, F1 al frente, n = (piso − 1) × 4 + fondo", () => {
    const slots = rackBoxSlots({ capacity: 20, boxes: [] });
    expect(slots[0]).toMatchObject({ number: 1, piso: 1, fondo: 1 });
    expect(slots[4]).toMatchObject({ number: 5, piso: 2, fondo: 1 });
    expect(slots[19]).toMatchObject({ number: 20, piso: 5, fondo: 4 });
  });

  it("asocia las cajas registradas a su hueco y conserva su tipo", () => {
    const slots = rackBoxSlots({ capacity: 20, boxes: [{ id: 7, number: 3, boxType: "plastic_100" }] });
    expect(slots[2].box).toEqual({ id: 7, number: 3, boxType: "plastic_100" });
    expect(slots[2].boxType).toBe("plastic_100");
  });

  it("agrega pisos si una caja registrada tiene un número mayor que la capacidad", () => {
    const rack = { capacity: 20, boxes: [{ id: 1, number: 23, boxType: "carton_81" as const }] };
    expect(rackPisos(rack)).toBe(6);
    expect(rackBoxSlots(rack)).toHaveLength(24);
  });

  it("usa el mismo código que el campo 'Nombre Caja' del formulario", () => {
    expect(boxCode("A", 5)).toBe("A5");
  });
});

describe("parseViewerQuery", () => {
  it("acepta rack, subcaja y posición", () => {
    expect(parseViewerQuery("a")).toEqual({ ok: true, rackLetter: "A", boxNumber: null, position: null });
    expect(parseViewerQuery("A5")).toEqual({ ok: true, rackLetter: "A", boxNumber: 5, position: null });
    expect(parseViewerQuery(" a5-3b ")).toEqual({ ok: true, rackLetter: "A", boxNumber: 5, position: "3B" });
    expect(parseViewerQuery("G3 10")).toEqual({ ok: true, rackLetter: "G", boxNumber: 3, position: "10" });
  });

  it("normaliza la posición letra-número (B3) a número-letra (3B)", () => {
    expect(parseViewerQuery("A5-B3")).toMatchObject({ ok: true, position: "3B" });
  });

  it("rechaza formatos inválidos", () => {
    expect(parseViewerQuery("Z9").ok).toBe(false);
    expect(parseViewerQuery("A0").ok).toBe(false);
    expect(parseViewerQuery("hola").ok).toBe(false);
  });
});

describe("lidGrid", () => {
  it("cartón: filas A–I × columnas 1–9; la esquina superior izquierda es 1A", () => {
    const grid = lidGrid("carton_81");
    expect(grid.rows).toHaveLength(9);
    expect(grid.columns).toHaveLength(9);
    expect(grid.cells[0][0]).toBe("1A");
    expect(grid.cells[1][2]).toBe("3B");
    expect(grid.cells[8][8]).toBe("9I");
  });

  it("plástica: 10 × 10 numerada de izquierda a derecha y de arriba hacia abajo", () => {
    const grid = lidGrid("plastic_100");
    expect(grid.cells[0][0]).toBe("1");
    expect(grid.cells[0][9]).toBe("10");
    expect(grid.cells[1][0]).toBe("11");
    expect(grid.cells[9][9]).toBe("100");
  });
});
