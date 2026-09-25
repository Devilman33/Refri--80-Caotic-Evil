import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RackOccupancy, RackRead, SectionRead, UserRead } from "../../api/types";
import { FreezerAdminModal } from "../FreezerAdminModal";

const { api, ApiError } = vi.hoisted(() => ({
  api: {
    listSections: vi.fn(),
    listRacks: vi.fn(),
    listRackOccupancy: vi.fn(),
    moveRack: vi.fn(),
    deactivateRack: vi.fn(),
    createRack: vi.fn(),
    activateRack: vi.fn(),
  },
  ApiError: class extends Error {},
}));

vi.mock("../../api/client", () => ({ api, ApiError }));

const sections: SectionRead[] = [
  { id: 1, code: "I" },
  { id: 3, code: "III" },
];
const racks: RackRead[] = [
  { id: 1, section_id: 1, letter: "A", slot: "center", capacity: 20, active: true },
  { id: 2, section_id: 1, letter: "B", slot: "right", capacity: 20, active: true },
  { id: 5, section_id: 3, letter: "E", slot: "center", capacity: 20, active: true },
  { id: 6, section_id: 3, letter: "F", slot: "right", capacity: 20, active: true },
  { id: 9, section_id: 3, letter: "J", slot: null, capacity: 20, active: false },
];
const occupancy = (rack_id: number, letter: string, active: number): RackOccupancy => ({
  rack_id,
  letter,
  section_code: "I",
  active,
  capacity: 1620,
  percent: 0,
});
const users: UserRead[] = [{ id: 1, initials: "GC", name: "Gonzalo", active: true }];

beforeEach(() => {
  vi.clearAllMocks();
  api.listSections.mockResolvedValue(sections);
  api.listRacks.mockResolvedValue(racks);
  api.listRackOccupancy.mockResolvedValue([
    occupancy(1, "A", 0),
    occupancy(2, "B", 12),
    occupancy(5, "E", 0),
    occupancy(6, "F", 40),
  ]);
  api.moveRack.mockResolvedValue({ rack: racks[3], swapped_with: racks[1], moved_samples: 52 });
});

function renderModal(onChanged = vi.fn()) {
  render(<FreezerAdminModal users={users} sessionInitials="GC" onClose={vi.fn()} onChanged={onChanged} />);
  return onChanged;
}

describe("FreezerAdminModal", () => {
  it("mover F a un lugar ocupado exige confirmar el intercambio", async () => {
    const onChanged = renderModal();
    const user = userEvent.setup();

    const rowIII = (await screen.findByRole("rowheader", { name: "III" })).closest("tr")!;
    await user.click(within(rowIII).getAllByRole("button", { name: "Mover" })[1]);
    await user.selectOptions(screen.getByLabelText(/destino/i), "I · derecha (ocupado por B)");

    const submit = screen.getByRole("button", { name: /intercambiar racks/i });
    expect(submit).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    await user.click(submit);

    await waitFor(() =>
      expect(api.moveRack).toHaveBeenCalledWith(
        6,
        expect.objectContaining({ section_code: "I", slot: "right", swap: true, operator_initials: "GC" }),
      ),
    );
    expect(onChanged).toHaveBeenCalledWith(expect.stringMatching(/Rack F movido a I · derecha y el rack B pasó/));
  });

  it("solo deja dar de baja un rack sin muestras, y lista los dados de baja", async () => {
    renderModal();

    const rowI = (await screen.findByRole("rowheader", { name: "I" })).closest("tr")!;
    const [bajaA, bajaB] = within(rowI).getAllByRole("button", { name: "Dar de baja" });
    expect(bajaA).toBeEnabled();
    expect(bajaB).toBeDisabled();
    expect(screen.getByText("Dados de baja")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reactivar" })).toBeInTheDocument();
  });
});
