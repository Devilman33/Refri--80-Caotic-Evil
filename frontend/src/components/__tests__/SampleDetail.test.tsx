import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SampleWithLocation } from "../../api/types";
import { SampleDetail } from "../SampleDetail";

const { api } = vi.hoisted(() => ({
  api: { getSampleMovements: vi.fn() },
}));

vi.mock("../../api/client", () => ({ api }));

const activeSample: SampleWithLocation = {
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

beforeEach(() => {
  vi.clearAllMocks();
  api.getSampleMovements.mockResolvedValue([]);
});

describe("SampleDetail", () => {
  it('muestra "Descongelar" para una muestra activa cuando se pasa onThaw', () => {
    render(<SampleDetail sample={activeSample} ownerLabel="GC" onClose={vi.fn()} onThaw={vi.fn()} />);
    expect(screen.getByRole("button", { name: /descongelar/i })).toBeInTheDocument();
  });

  it("no muestra el botón de descongelar cuando no se pasa onThaw (detalle abierto desde la tabla)", () => {
    render(<SampleDetail sample={activeSample} ownerLabel="GC" onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /descongelar/i })).not.toBeInTheDocument();
  });

  it("no muestra el botón de descongelar para una muestra ya retirada", () => {
    render(
      <SampleDetail sample={{ ...activeSample, status: "withdrawn" }} ownerLabel="GC" onClose={vi.fn()} onThaw={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: /descongelar/i })).not.toBeInTheDocument();
  });

  it("llama a onThaw al hacer clic", async () => {
    const onThaw = vi.fn();
    const user = userEvent.setup();
    render(<SampleDetail sample={activeSample} ownerLabel="GC" onClose={vi.fn()} onThaw={onThaw} />);

    await user.click(screen.getByRole("button", { name: /descongelar/i }));
    expect(onThaw).toHaveBeenCalledTimes(1);
  });
});
