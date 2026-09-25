import { describe, expect, it } from "vitest";
import type { BoxRead, RackRead, SectionRead } from "../../api/types";
import { boxGridPosition, boxSlotPosition, buildFreezerLayout, rackGridRows, rackSlotCount } from "../freezerLayout";

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
