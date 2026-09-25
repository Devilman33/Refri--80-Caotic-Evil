import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RackRead, SectionRead, UserRead } from "../../api/types";
import { BoxMoveModal } from "../BoxMoveModal";

const { api, ApiError } = vi.hoisted(() => {
  class ApiErrorMock extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return {
    api: {
      listRacks: vi.fn(),
      listSections: vi.fn(),
      listBoxes: vi.fn(),
      getBoxPositions: vi.fn(),
      moveBox: vi.fn(),
    },
    ApiError: ApiErrorMock,
  };
});

vi.mock("../../api/client", () => ({ api, ApiError }));

const racks: RackRead[] = [
  { id: 1, section_id: 1, letter: "A", slot: "center", capacity: 28, active: true },
  { id: 4, section_id: 2, letter: "D", slot: "right", capacity: 28, active: true },
];
const sections: SectionRead[] = [
  { id: 1, code: "I" },
  { id: 2, code: "II" },
];
const gonzalo: UserRead = { id: 1, initials: "GC", name: "Gonzalo Carrasco", active: true };

function renderModal(onMoved = vi.fn()) {
  render(
    <BoxMoveModal
      box={{ boxId: 5, label: "I · A3", active: 34 }}
      users={[gonzalo]}
      sessionInitials="GC"
      onClose={vi.fn()}
      onMoved={onMoved}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listRacks.mockResolvedValue(racks);
  api.listSections.mockResolvedValue(sections);
  api.listBoxes.mockResolvedValue([]);
  api.getBoxPositions.mockResolvedValue([]);
});

describe("BoxMoveModal · destino en vivo (F4)", () => {
  it("dice que el destino está libre antes de confirmar", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByLabelText(/nuevo lugar/i), "D7");
    expect(await screen.findByText(/D7 está libre/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/sección/i)).toHaveValue("II");
  });

  it("avisa si en el destino ya hay una caja con muestras y no deja mover", async () => {
    api.listBoxes.mockResolvedValue([
      { id: 9, rack_id: 4, number: 7, box_type: "carton_81", label: null, owner_id: null, is_full: false, active: true },
    ]);
    api.getBoxPositions.mockResolvedValue([
      { position: "1A", occupied: true, sample_id: 1, environ_id: "X", is_core: false, owners: [] },
      { position: "1B", occupied: true, sample_id: 2, environ_id: "Y", is_core: false, owners: [] },
    ]);
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByLabelText(/nuevo lugar/i), "D7");

    expect(await screen.findByText(/en D7 ya hay una caja con 2 muestras/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^mover caja$/i }));
    expect(api.moveBox).not.toHaveBeenCalled();
  });

  it("avisa si el rack no existe o la caja se pasa de la capacidad", async () => {
    const user = userEvent.setup();
    renderModal();
    const input = screen.getByLabelText(/nuevo lugar/i);
    await user.type(input, "G1");
    expect(await screen.findByText(/no existe el rack 'G'/i)).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, "A99");
    expect(await screen.findByText(/el rack A tiene lugar para 28 cajas/i)).toBeInTheDocument();
  });

  it("mientras se escribe la primera letra no reclama el formato", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByLabelText(/nuevo lugar/i), "D");
    await waitFor(() => expect(api.listRacks).toHaveBeenCalled());
    expect(screen.queryByText(/formato inválido/i)).not.toBeInTheDocument();
  });

  it("con un destino libre traslada la caja e informa de dónde a dónde", async () => {
    api.moveBox.mockResolvedValue({ moved: 34, from_label: "I · A3", to_label: "II · D7" });
    const onMoved = vi.fn();
    const user = userEvent.setup();
    renderModal(onMoved);
    await user.type(screen.getByLabelText(/nuevo lugar/i), "D7");
    await screen.findByText(/D7 está libre/i);
    await user.click(screen.getByRole("button", { name: /^mover caja$/i }));

    await waitFor(() =>
      expect(api.moveBox).toHaveBeenCalledWith(5, expect.objectContaining({ rack_letter: "D", box_number: 7 })),
    );
    expect(onMoved).toHaveBeenCalledWith("Caja trasladada: I · A3 → II · D7 (34 muestras).");
  });
});
