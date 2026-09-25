import { describe, expect, it } from "vitest";
import type { BoxOccupancy } from "../../api/types";
import { boxLabel, formatPercent, isHighlighted, sortBoxes, usageLevel } from "../occupancy";

function box(overrides: Partial<BoxOccupancy>): BoxOccupancy {
  return {
    box_id: 1,
    number: 1,
    rack_id: 1,
    rack_letter: "A",
    section_code: "I",
    box_type: "carton_81",
    is_full: null,
    active: 0,
    capacity: 81,
    percent: 0,
    ...overrides,
  };
}

describe("usageLevel", () => {
  it("marca llena una subcaja sin posiciones libres", () => {
    expect(usageLevel({ active: 81, capacity: 81, percent: 100 })).toBe("full");
  });

  it("marca casi llena desde el 90 %", () => {
    expect(usageLevel({ active: 73, capacity: 81, percent: 90.12 })).toBe("near-full");
    expect(usageLevel({ active: 90, capacity: 100, percent: 90 })).toBe("near-full");
    expect(usageLevel({ active: 89, capacity: 100, percent: 89 })).toBe("normal");
  });

  it("distingue las vacías", () => {
    expect(usageLevel({ active: 0, capacity: 100, percent: 0 })).toBe("empty");
  });

  it("respeta la caja declarada completa en el formulario", () => {
    expect(usageLevel({ active: 40, capacity: 81, percent: 49.38, is_full: true })).toBe("full");
  });
});

describe("sortBoxes", () => {
  const boxes = [
    box({ box_id: 1, section_code: "II", rack_letter: "C", number: 2, active: 10, percent: 12.35 }),
    box({ box_id: 2, section_code: "I", rack_letter: "A", number: 5, active: 80, percent: 98.77 }),
    box({ box_id: 3, section_code: "I", rack_letter: "A", number: 1, box_type: "plastic_100", capacity: 100, active: 50, percent: 50 }),
  ];

  it("ordena por % de uso descendente", () => {
    expect(sortBoxes(boxes, "percent", "desc").map((b) => b.box_id)).toEqual([2, 3, 1]);
  });

  it("ordena por ubicación (sección, rack, número)", () => {
    expect(sortBoxes(boxes, "location", "asc").map((b) => b.box_id)).toEqual([3, 2, 1]);
  });

  it("ordena por posiciones libres", () => {
    // libres: caja 1 = 71, caja 2 = 1, caja 3 = 50
    expect(sortBoxes(boxes, "free", "desc").map((b) => b.box_id)).toEqual([1, 3, 2]);
  });

  it("no muta el arreglo original", () => {
    const copy = [...boxes];
    sortBoxes(boxes, "percent", "asc");
    expect(boxes).toEqual(copy);
  });
});

describe("helpers de presentación", () => {
  it("arma el nombre corto de la subcaja", () => {
    expect(boxLabel({ section_code: "II", rack_letter: "C", number: 5 })).toBe("II · C5");
  });

  it("formatea el porcentaje con coma decimal", () => {
    expect(formatPercent(98.77)).toBe("98,8 %");
    expect(formatPercent(50)).toBe("50 %");
  });

  it("destaca llenas y casi llenas", () => {
    expect(isHighlighted(box({ active: 81, percent: 100 }))).toBe(true);
    expect(isHighlighted(box({ active: 74, percent: 91.36 }))).toBe(true);
    expect(isHighlighted(box({ active: 10, percent: 12.35 }))).toBe(false);
  });
});
