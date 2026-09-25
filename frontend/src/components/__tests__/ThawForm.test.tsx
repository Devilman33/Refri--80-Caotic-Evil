import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MovementResult, RackRead, SampleWithLocation, SectionRead, UserRead } from "../../api/types";
import { ThawForm } from "../ThawForm";

const { api, ApiError } = vi.hoisted(() => {
  class ApiErrorMock extends Error {
    status: number;
    detail: unknown;
    constructor(status: number, message: string, detail?: unknown) {
      super(message);
      this.status = status;
      this.detail = detail;
    }
  }
  return {
    api: {
      listRacks: vi.fn(),
      listSections: vi.fn(),
      listBoxes: vi.fn(),
      getBoxPositions: vi.fn(),
      getSample: vi.fn(),
      createMovement: vi.fn(),
    },
    ApiError: ApiErrorMock,
  };
});

vi.mock("../../api/client", () => ({ api, ApiError }));

const racks: RackRead[] = [{ id: 1, section_id: 1, letter: "A", slot: "center", capacity: 20 }];
const sections: SectionRead[] = [{ id: 1, code: "I" }];
const gonzalo: UserRead = { id: 1, initials: "GC", name: "Gonzalo Carrasco", active: true };
const daniela: UserRead = { id: 2, initials: "DB", name: "Daniela Bravo", active: true };
const users = [gonzalo, daniela];

const sample: SampleWithLocation = {
  id: 9,
  environ_id: "BP009",
  description: "Biopsia de próstata",
  type: "rna",
  type_other: null,
  owner_ids: [1],
  passage: 3,
  is_core: true,
  box_id: 5,
  position: "1A",
  notes: null,
  status: "active",
  created_at: "2026-01-10T00:00:00Z",
  updated_at: "2026-01-10T00:00:00Z",
  location: "I · A1 · 1A",
};

beforeEach(() => {
  vi.clearAllMocks();
  api.listRacks.mockResolvedValue(racks);
  api.listSections.mockResolvedValue(sections);
  api.listBoxes.mockResolvedValue([
    { id: 5, rack_id: 1, number: 1, box_type: "carton_81", label: null, owner_id: null, is_full: false },
  ]);
  api.getBoxPositions.mockResolvedValue([
    { position: "1A", occupied: true, sample_id: 9, environ_id: "BP009", is_core: true },
  ]);
  api.getSample.mockResolvedValue(sample);
});

function renderForm(sessionUser: UserRead = gonzalo, onSubmitted = vi.fn()) {
  render(
    <ThawForm
      users={users}
      sessionUser={sessionUser}
      initial={{ rackLetter: "A", boxNumber: 1, position: "1A" }}
      onClose={vi.fn()}
      onSubmitted={onSubmitted}
    />,
  );
}

describe("ThawForm", () => {
  it("es un formulario aparte, que muestra los datos de la muestra que se va a retirar", async () => {
    renderForm();

    expect(screen.getByRole("heading", { name: /descongelamiento/i })).toBeInTheDocument();
    const card = await screen.findByRole("region", { name: /muestra a retirar/i });
    expect(card).toHaveTextContent("BP009");
    expect(card).toHaveTextContent("Biopsia de próstata");
    expect(card).toHaveTextContent("RNA");
    expect(card).toHaveTextContent("Gonzalo Carrasco");
    expect(card).toHaveTextContent(/núcleo environ/i);
    // Solo se editan los datos del retiro: nada de Tipo ni Núcleo como campos.
    expect(screen.queryByRole("combobox", { name: /^tipo$/i })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText(/sección/i)).toHaveValue("I"));
  });

  it("registra el retiro con su motivo", async () => {
    const result = { sample: { ...sample, status: "withdrawn" }, movement: {} } as unknown as MovementResult;
    api.createMovement.mockResolvedValue(result);
    const onSubmitted = vi.fn();
    const user = userEvent.setup();
    renderForm(gonzalo, onSubmitted);

    await screen.findByRole("region", { name: /muestra a retirar/i });
    await user.type(screen.getByLabelText(/motivo del retiro/i), "Extracción de RNA");
    await user.click(screen.getByRole("button", { name: /retirar muestra/i }));

    await waitFor(() =>
      expect(api.createMovement).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "thaw",
          operator_initials: "GC",
          rack_letter: "A",
          box_number: 1,
          position: "1A",
          note: "Extracción de RNA",
        }),
      ),
    );
    expect(onSubmitted).toHaveBeenCalledWith(result);
  });

  it("no deja retirar una muestra de otra persona", async () => {
    renderForm(daniela);

    expect(await screen.findByText(/solo sus encargados pueden retirarla/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retirar muestra/i })).toBeDisabled();
  });
});
