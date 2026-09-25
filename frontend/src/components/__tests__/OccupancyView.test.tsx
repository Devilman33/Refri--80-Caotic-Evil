import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoxOccupancy } from "../../api/types";
import { OccupancyView } from "../OccupancyView";

const { api } = vi.hoisted(() => ({
  api: {
    getFreezerOccupancy: vi.fn(),
    listSectionOccupancy: vi.fn(),
    listRackOccupancy: vi.fn(),
    listBoxOccupancy: vi.fn(),
  },
}));

vi.mock("../../api/client", () => ({ api, ApiError: class ApiError extends Error {} }));

const boxes: BoxOccupancy[] = [
  { box_id: 1, number: 1, rack_id: 1, rack_letter: "A", section_code: "I", box_type: "carton_81", is_full: null, active: 81, capacity: 81, percent: 100 },
  { box_id: 2, number: 2, rack_id: 1, rack_letter: "A", section_code: "I", box_type: "plastic_100", is_full: null, active: 92, capacity: 100, percent: 92 },
  { box_id: 3, number: 1, rack_id: 3, rack_letter: "C", section_code: "II", box_type: "carton_81", is_full: null, active: 10, capacity: 81, percent: 12.35 },
];

beforeEach(() => {
  vi.clearAllMocks();
  api.getFreezerOccupancy.mockResolvedValue({ active: 183, capacity: 262, percent: 69.85 });
  api.listSectionOccupancy.mockResolvedValue([
    { section_id: 1, code: "I", active: 173, capacity: 181, percent: 95.58 },
    { section_id: 2, code: "II", active: 10, capacity: 81, percent: 12.35 },
  ]);
  api.listRackOccupancy.mockResolvedValue([
    { rack_id: 1, letter: "A", section_code: "I", active: 173, capacity: 181, percent: 95.58 },
    { rack_id: 3, letter: "C", section_code: "II", active: 10, capacity: 81, percent: 12.35 },
  ]);
  api.listBoxOccupancy.mockResolvedValue(boxes);
});

function rowLabels(): string[] {
  const table = screen.getByRole("table");
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0].textContent ?? "");
}

describe("OccupancyView", () => {
  it("muestra el % del freezer, por sección y por rack", async () => {
    render(<OccupancyView onViewBox={vi.fn()} />);
    expect(await screen.findByText("69,9 %")).toBeInTheDocument();
    expect(screen.getByText("Sección II")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "% de uso del rack A" })).toHaveAttribute("aria-valuenow", "96");
  });

  it("el control segmentado filtra por estado, cada uno con su propio conjunto", async () => {
    render(<OccupancyView onViewBox={vi.fn()} />);
    await screen.findByRole("table");
    expect(screen.getByText("Llena")).toBeInTheDocument();
    expect(screen.getByText("Casi llena")).toBeInTheDocument();

    // "Llenas" y "Casi llenas" son estados DISTINTOS: con un solo booleano
    // "destacadas" los dos contadores de alertas caerían en la misma pantalla.
    await userEvent.click(screen.getByRole("button", { name: /^llenas \(1\)$/i }));
    expect(rowLabels()).toHaveLength(1);
    expect(rowLabels()[0]).toContain("I · A1");

    await userEvent.click(screen.getByRole("button", { name: /^casi llenas \(1\)$/i }));
    expect(rowLabels()).toHaveLength(1);
    expect(rowLabels()[0]).toContain("I · A2");

    await userEvent.click(screen.getByRole("button", { name: /^todas \(3\)$/i }));
    expect(rowLabels()).toHaveLength(3);
  });

  it("arranca en el filtro que le pasa el panel de alertas", async () => {
    render(<OccupancyView onViewBox={vi.fn()} initialFilter="near-full" />);
    await screen.findByRole("table");
    expect(rowLabels()).toHaveLength(1);
    expect(rowLabels()[0]).toContain("I · A2");
  });

  it("ordena las subcajas al hacer clic en el encabezado", async () => {
    render(<OccupancyView onViewBox={vi.fn()} />);
    await screen.findByRole("table");
    // Por defecto: % de uso descendente.
    expect(rowLabels()[0]).toContain("I · A1");
    await userEvent.click(screen.getByRole("button", { name: /% de uso/i }));
    expect(rowLabels()[0]).toContain("II · C1");
  });

  it('"Ver en el refri" entrega la subcaja elegida', async () => {
    const onViewBox = vi.fn();
    render(<OccupancyView onViewBox={onViewBox} />);
    await screen.findByRole("table");
    const row = screen.getAllByRole("row").find((r) => r.textContent?.includes("II · C1"));
    await userEvent.click(within(row!).getByRole("button", { name: /ver en el refri/i }));
    expect(onViewBox).toHaveBeenCalledWith(expect.objectContaining({ box_id: 3 }));
  });
});
