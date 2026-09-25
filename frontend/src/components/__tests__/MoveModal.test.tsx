import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";
import type { RackRead, SampleWithLocation, SectionRead, UserRead } from "../../api/types";
import { MoveModal } from "../MoveModal";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return {
    ...actual,
    api: {
      listRacks: vi.fn(),
      listSections: vi.fn(),
      listBoxes: vi.fn(),
      getBoxPositions: vi.fn(),
      moveSample: vi.fn(),
    },
  };
});

const { api } = await import("../../api/client");

const racks: RackRead[] = [{ id: 1, section_id: 1, letter: "A", slot: "center", capacity: 30 }];
const sections: SectionRead[] = [{ id: 1, code: "I" }];
const users: UserRead[] = [{ id: 1, initials: "MN", name: null, active: true }];

const sample: SampleWithLocation = {
  id: 7,
  environ_id: "BP001",
  description: null,
  type: "vial_celulas",
  type_other: null,
  owner_id: 1,
  passage: null,
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
  // El modal recuerda el último operador (QOL de docs/FORMULARIO.md), así que sin
  // limpiar esto un test le deja el campo prellenado al siguiente.
  localStorage.clear();
  vi.mocked(api.listRacks).mockResolvedValue(racks);
  vi.mocked(api.listSections).mockResolvedValue(sections);
  vi.mocked(api.listBoxes).mockResolvedValue([
    { id: 1, rack_id: 1, number: 2, box_type: "carton_81", label: null, owner_id: null, is_full: null },
  ]);
  vi.mocked(api.getBoxPositions).mockResolvedValue([]);
});

async function fillDestination(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText(/operador/i), "MN");
  await user.selectOptions(screen.getByLabelText(/sección/i), "I");
  await user.type(screen.getByLabelText(/nombre caja/i), "A2");
  await waitFor(() => expect(api.getBoxPositions).toHaveBeenCalled());
  await user.click(screen.getByRole("button", { name: /^posición 3b,/i }));
}

describe("MoveModal", () => {
  it("muestra de dónde sale la muestra", () => {
    render(<MoveModal sample={sample} users={users} onClose={vi.fn()} onMoved={vi.fn()} />);

    expect(screen.getByText("I · A1 · 1A")).toBeInTheDocument();
  });

  it("al mover informa de dónde a dónde", async () => {
    vi.mocked(api.moveSample).mockResolvedValue({
      sample: { ...sample, position: "3B", location: "I · A2 · 3B" },
      movement: {
        id: 1,
        sample_id: 7,
        action: "move",
        date: "2026-03-01",
        operator_id: 1,
        operator_initials: "MN",
        box_id: 2,
        position: "3B",
        location: "I · A2 · 3B",
        from_box_id: 1,
        from_position: "1A",
        from_location: "I · A1 · 1A",
        note: null,
        created_at: "2026-03-01T00:00:00Z",
      },
    });
    const onMoved = vi.fn();
    const user = userEvent.setup();
    render(<MoveModal sample={sample} users={users} onClose={vi.fn()} onMoved={onMoved} />);

    await fillDestination(user);
    await user.click(screen.getByRole("button", { name: /^mover$/i }));

    await waitFor(() => expect(onMoved).toHaveBeenCalledTimes(1));
    // El momento que importa: sin esta línea el operador cierra un diálogo y ve una tabla
    // que se refrescó sola, sin confirmación de nada.
    expect(onMoved.mock.calls[0][1]).toBe("Movida: I · A1 · 1A → I · A2 · 3B");
  });

  it("exige sección, operador y posición antes de enviar", async () => {
    const user = userEvent.setup();
    render(<MoveModal sample={sample} users={users} onClose={vi.fn()} onMoved={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /^mover$/i }));

    expect(await screen.findByText(/la sección es obligatoria/i)).toBeInTheDocument();
    expect(screen.getByText(/el operador es obligatorio/i)).toBeInTheDocument();
    expect(api.moveSample).not.toHaveBeenCalled();
  });

  it("ante un 409 ofrece la siguiente posición libre", async () => {
    vi.mocked(api.moveSample).mockRejectedValue(
      new ApiError(409, "La posición 3B ya está ocupada", {
        message: "La posición 3B ya está ocupada",
        next_free_position: "4C",
      }),
    );
    const user = userEvent.setup();
    render(<MoveModal sample={sample} users={users} onClose={vi.fn()} onMoved={vi.fn()} />);

    await fillDestination(user);
    await user.click(screen.getByRole("button", { name: /^mover$/i }));

    // Mismo botón inline que ya usa el formulario de movimientos, no un error distinto.
    const useNext = await screen.findByRole("button", { name: /usar siguiente libre \(4C\)/i });
    await user.click(useNext);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^posición 4c,/i })).toHaveAttribute("aria-pressed", "true"),
    );
  });
});
