import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SampleWithLocation } from "../../api/types";
import { SamplesTable } from "../SamplesTable";

const baseSample: SampleWithLocation = {
  id: 1,
  environ_id: "BP1000",
  description: "Biopsia",
  type: "vial_celulas",
  type_other: null,
  owner_id: 1,
  passage: 2,
  is_core: false,
  box_id: 1,
  position: "1A",
  notes: null,
  status: "active",
  created_at: "2026-01-10T00:00:00Z",
  updated_at: "2026-01-10T00:00:00Z",
  location: "I · A1 · 1A",
};

const samples: SampleWithLocation[] = [
  { ...baseSample, id: 1, environ_id: "BP2000", is_core: false },
  { ...baseSample, id: 2, environ_id: "BP1000", is_core: true },
];

const ownerLookup = { 1: "GC" };

describe("SamplesTable", () => {
  it("muestra el warning de Núcleo solo en las muestras con is_core = true", () => {
    render(<SamplesTable samples={samples} ownerLookup={ownerLookup} onSelect={vi.fn()} />);

    const rowWithNucleo = screen.getByTestId("sample-row-2");
    const rowWithoutNucleo = screen.getByTestId("sample-row-1");

    expect(within(rowWithNucleo).getByText(/núcleo environ/i)).toBeInTheDocument();
    expect(within(rowWithoutNucleo).queryByText(/núcleo environ/i)).not.toBeInTheDocument();
  });

  it("llama a onSelect con la muestra al hacer click en una fila", async () => {
    const onSelect = vi.fn();
    render(<SamplesTable samples={samples} ownerLookup={ownerLookup} onSelect={onSelect} />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId("sample-row-1"));

    expect(onSelect).toHaveBeenCalledWith(samples[0]);
  });

  it("ordena las filas por ID Environ al hacer click en la columna", async () => {
    render(<SamplesTable samples={samples} ownerLookup={ownerLookup} onSelect={vi.fn()} />);
    const user = userEvent.setup();

    await user.click(screen.getByText(/id environ/i));

    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("BP1000")).toBeInTheDocument();
    expect(within(rows[1]).getByText("BP2000")).toBeInTheDocument();
  });

  it("muestra un estado vacío cuando no hay muestras", () => {
    render(<SamplesTable samples={[]} ownerLookup={{}} onSelect={vi.fn()} />);
    expect(screen.getByText(/no se encontraron muestras/i)).toBeInTheDocument();
  });
});
