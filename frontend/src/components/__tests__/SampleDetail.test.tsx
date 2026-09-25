import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MovementRead, SampleWithLocation, UserRead } from "../../api/types";
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

const users: UserRead[] = [
  { id: 1, initials: "GC", name: "Gonzalo Carrasco", active: true },
  { id: 2, initials: "MN", name: null, active: true },
];

const freeze: MovementRead = {
  id: 1,
  sample_id: 1,
  action: "freeze",
  date: "2026-01-12",
  operator_id: 2,
  operator_initials: "MN",
  box_id: 1,
  position: "1A",
  location: "I · A1 · 1A",
  from_box_id: null,
  from_position: null,
  from_location: null,
  note: null,
  created_at: "2026-01-12T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getSampleMovements.mockResolvedValue([]);
});

describe("SampleDetail", () => {
  it('muestra "Descongelar" para una muestra activa de quien la mira', () => {
    render(<SampleDetail sample={activeSample} users={users} canModify onClose={vi.fn()} onThaw={vi.fn()} />);
    expect(screen.getByRole("button", { name: /descongelar/i })).toBeInTheDocument();
  });

  it("a quien no es el encargado no le ofrece acciones y le dice quién puede", () => {
    render(
      <SampleDetail
        sample={activeSample}
        users={users}
        canModify={false}
        onClose={vi.fn()}
        onThaw={vi.fn()}
        onEdit={vi.fn()}
        onMove={vi.fn()}
      />,
    );
    for (const name of [/descongelar/i, /editar/i, /^mover$/i]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(screen.getByText(/solo gonzalo carrasco, su encargado/i)).toBeInTheDocument();
  });

  it("muestra de quién es, cuándo se congeló y quién la congeló", async () => {
    api.getSampleMovements.mockResolvedValue([freeze]);
    render(<SampleDetail sample={activeSample} users={users} canModify onClose={vi.fn()} />);

    expect(screen.getByText("Gonzalo Carrasco (GC)")).toBeInTheDocument();
    expect(await screen.findByText("12-01-2026")).toBeInTheDocument();
    expect(screen.getAllByText("MN").length).toBeGreaterThan(0);
  });

  it("no muestra el botón de descongelar para una muestra ya retirada", () => {
    render(
      <SampleDetail
        sample={{ ...activeSample, status: "withdrawn" }}
        users={users}
        canModify
        onClose={vi.fn()}
        onThaw={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /descongelar/i })).not.toBeInTheDocument();
  });

  it("llama a onThaw al hacer clic", async () => {
    const onThaw = vi.fn();
    const user = userEvent.setup();
    render(<SampleDetail sample={activeSample} users={users} canModify onClose={vi.fn()} onThaw={onThaw} />);

    await user.click(screen.getByRole("button", { name: /descongelar/i }));
    expect(onThaw).toHaveBeenCalledTimes(1);
  });
});
