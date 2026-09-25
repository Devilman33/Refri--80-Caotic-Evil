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
      listBoxOccupancy: vi.fn(),
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
  api.listBoxOccupancy.mockResolvedValue([]);
  api.getBoxPositions.mockResolvedValue([]);
});

function occupancy(box_id: number, rack_id: number, rack_letter: string, section_code: string, number: number, active: number) {
  return { box_id, number, rack_id, rack_letter, section_code, box_type: "carton_81" as const, is_full: false, active, capacity: 81, percent: 0 };
}

/** Nuevo lugar como listas (parte 3). */
async function choosePlace(user: ReturnType<typeof userEvent.setup>, section: string, rack: string, number: string) {
  await screen.findByRole("option", { name: section });
  await user.selectOptions(screen.getByLabelText(/^sección$/i), section);
  await user.selectOptions(screen.getByLabelText(/^rack$/i), rack);
  await user.selectOptions(screen.getByLabelText(/^caja$/i), number);
}

describe("BoxMoveModal · destino como listas (F4, parte 3)", () => {
  it("solo ofrece lugares sin muestras: libres o con una caja vacía", async () => {
    api.listBoxOccupancy.mockResolvedValue([
      occupancy(5, 1, "A", "I", 3, 34),
      occupancy(9, 4, "D", "II", 7, 2),
      occupancy(10, 4, "D", "II", 8, 0),
    ]);
    const user = userEvent.setup();
    renderModal();

    await screen.findByRole("option", { name: "II" });
    await user.selectOptions(screen.getByLabelText(/^sección$/i), "II");
    await user.selectOptions(screen.getByLabelText(/^rack$/i), "D");

    expect(screen.queryByRole("option", { name: /^D7 ·/ })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "D8 · caja vacía" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "D1 · lugar libre" })).toBeInTheDocument();
  });

  it("dice que el destino está libre antes de confirmar", async () => {
    const user = userEvent.setup();
    renderModal();
    await choosePlace(user, "II", "D", "7");
    expect(await screen.findByText(/D7 está libre/i)).toBeInTheDocument();
  });

  it("con un destino libre traslada la caja e informa de dónde a dónde", async () => {
    api.moveBox.mockResolvedValue({ moved: 34, from_label: "I · A3", to_label: "II · D7" });
    const onMoved = vi.fn();
    const user = userEvent.setup();
    renderModal(onMoved);
    await choosePlace(user, "II", "D", "7");
    await screen.findByText(/D7 está libre/i);
    await user.click(screen.getByRole("button", { name: /^mover caja$/i }));

    await waitFor(() =>
      expect(api.moveBox).toHaveBeenCalledWith(5, expect.objectContaining({ rack_letter: "D", box_number: 7 })),
    );
    expect(onMoved).toHaveBeenCalledWith("Caja trasladada: I · A3 → II · D7 (34 muestras).");
  });
});
