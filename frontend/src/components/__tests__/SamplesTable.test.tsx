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
    render(
      <SamplesTable samples={samples} ownerLookup={ownerLookup} onSelect={vi.fn()} sort={null} onSortChange={vi.fn()} />,
    );

    const rowWithNucleo = screen.getByTestId("sample-row-2");
    const rowWithoutNucleo = screen.getByTestId("sample-row-1");

    expect(within(rowWithNucleo).getByText(/núcleo environ/i)).toBeInTheDocument();
    expect(within(rowWithoutNucleo).queryByText(/núcleo environ/i)).not.toBeInTheDocument();
  });

  it("llama a onSelect con la muestra al hacer click en una fila", async () => {
    const onSelect = vi.fn();
    render(
      <SamplesTable samples={samples} ownerLookup={ownerLookup} onSelect={onSelect} sort={null} onSortChange={vi.fn()} />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByTestId("sample-row-1"));

    expect(onSelect).toHaveBeenCalledWith(samples[0]);
  });

  it("pide ordenar por ID Environ al hacer click en la columna, delegando en el backend", async () => {
    const onSortChange = vi.fn();
    render(
      <SamplesTable samples={samples} ownerLookup={ownerLookup} onSelect={vi.fn()} sort={null} onSortChange={onSortChange} />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /id environ/i }));
    expect(onSortChange).toHaveBeenCalledWith({ key: "environ_id", direction: "asc" });

    render(
      <SamplesTable
        samples={samples}
        ownerLookup={ownerLookup}
        onSelect={vi.fn()}
        sort={{ key: "environ_id", direction: "asc" }}
        onSortChange={onSortChange}
      />,
    );
    await user.click(screen.getAllByRole("button", { name: /id environ/i })[1]);
    expect(onSortChange).toHaveBeenCalledWith({ key: "environ_id", direction: "desc" });
  });

  it("los encabezados son botones enfocables y anuncian el orden con aria-sort", () => {
    render(
      <SamplesTable
        samples={samples}
        ownerLookup={ownerLookup}
        onSelect={vi.fn()}
        sort={{ key: "environ_id", direction: "asc" }}
        onSortChange={vi.fn()}
      />,
    );

    const header = screen.getByRole("columnheader", { name: /id environ/i });
    expect(header).toHaveAttribute("aria-sort", "ascending");
    expect(within(header).getByRole("button")).toBeInTheDocument();
  });

  it("muestra un estado vacío cuando no hay muestras", () => {
    render(<SamplesTable samples={[]} ownerLookup={{}} onSelect={vi.fn()} sort={null} onSortChange={vi.fn()} />);
    expect(screen.getByText(/no se encontraron muestras/i)).toBeInTheDocument();
  });
});
