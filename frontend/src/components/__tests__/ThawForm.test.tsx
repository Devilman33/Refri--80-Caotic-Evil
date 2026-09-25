import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoxOccupancy, MovementResult, SampleWithLocation, UserRead } from "../../api/types";
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
      listBoxOccupancy: vi.fn(),
      getBoxPositions: vi.fn(),
      getSample: vi.fn(),
      createMovement: vi.fn(),
      searchSamples: vi.fn(),
    },
    ApiError: ApiErrorMock,
  };
});

vi.mock("../../api/client", () => ({ api, ApiError }));

function occupancy(overrides: Partial<BoxOccupancy>): BoxOccupancy {
  return {
    box_id: 5,
    number: 1,
    rack_id: 1,
    rack_letter: "A",
    section_code: "I",
    box_type: "carton_81",
    is_full: false,
    active: 1,
    capacity: 81,
    percent: 1.23,
    ...overrides,
  };
}

const boxes: BoxOccupancy[] = [
  occupancy({}),
  occupancy({ box_id: 6, number: 2, active: 0 }),
  occupancy({ box_id: 7, number: 4, rack_id: 3, rack_letter: "F", section_code: "III", active: 12 }),
];
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
  api.listBoxOccupancy.mockResolvedValue(boxes);
  api.getBoxPositions.mockResolvedValue([
    { position: "1A", occupied: true, sample_id: 9, environ_id: "BP009", is_core: true, owners: ["Gonzalo Carrasco"] },
  ]);
  api.getSample.mockResolvedValue(sample);
});

function renderForm(sessionUser: UserRead = gonzalo, onSubmitted = vi.fn()) {
  render(
    <ThawForm
      users={users}
      sessionUser={sessionUser}
      initial={{ sectionCode: "I", rackLetter: "A", boxNumber: 1, position: "1A" }}
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

  it("sección, rack y caja son desplegables encadenados con solo las cajas que tienen muestras", async () => {
    const user = userEvent.setup();
    render(<ThawForm users={users} sessionUser={gonzalo} onClose={vi.fn()} onSubmitted={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("option", { name: "III" })).toBeInTheDocument());
    expect(screen.getByLabelText(/^rack$/i)).toBeDisabled();

    await user.selectOptions(screen.getByLabelText(/sección/i), "III");
    await user.selectOptions(screen.getByLabelText(/^rack$/i), "F");
    // La caja vacía (A2) no se ofrece; la de F sí, con su ocupación.
    expect(screen.queryByRole("option", { name: /A2/ })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/^caja$/i), "F4 · 12 de 81 ocupadas");

    await waitFor(() => expect(api.getBoxPositions).toHaveBeenCalledWith(7));
  });

  it("registra el retiro con su motivo", async () => {
    const result = { sample: { ...sample, status: "withdrawn" }, movement: {} } as unknown as MovementResult;
    api.createMovement.mockResolvedValue(result);
    const onSubmitted = vi.fn();
    const user = userEvent.setup();
    renderForm(gonzalo, onSubmitted);

    await screen.findByRole("region", { name: /muestra a retirar/i });
    await user.type(screen.getByLabelText(/motivo del retiro/i), "Extracción de RNA");
    await user.click(screen.getByRole("button", { name: /^descongelar$/i }));

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
    expect(screen.getByRole("button", { name: /^descongelar$/i })).toBeDisabled();
  });
});

describe("ThawForm · partir por el ID del tubo (F2)", () => {
  const located = {
    ...sample,
    location: "III · F4 · 2C",
    section_code: "III",
    rack_letter: "F",
    box_number: 4,
    box_type: "carton_81" as const,
    position: "2C",
  };

  it("elegir la muestra por su ID rellena sección, rack, caja y posición", async () => {
    api.searchSamples.mockResolvedValue({ items: [located], total: 1, page: 1, page_size: 8 });
    api.getBoxPositions.mockResolvedValue([
      { position: "2C", occupied: true, sample_id: 9, environ_id: "BP009", is_core: true, owners: ["Gonzalo Carrasco"] },
    ]);
    const user = userEvent.setup();
    render(<ThawForm users={users} sessionUser={gonzalo} onClose={vi.fn()} onSubmitted={vi.fn()} />);

    await user.type(screen.getByLabelText(/id environ del tubo/i), "BP009");
    await waitFor(() =>
      expect(api.searchSamples).toHaveBeenCalledWith(expect.objectContaining({ environ_id: "BP009", status: "active" })),
    );
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.getByLabelText(/sección/i)).toHaveValue("III"));
    expect(screen.getByLabelText(/^rack$/i)).toHaveValue("F");
    expect(screen.getByLabelText(/^caja$/i)).toHaveValue("4");
    await waitFor(() => expect(api.getBoxPositions).toHaveBeenCalledWith(7));
    expect(await screen.findByRole("region", { name: /muestra a retirar/i })).toHaveTextContent("BP009");
    expect(api.createMovement).not.toHaveBeenCalled();
  });

  it("con varias muestras activas del mismo ID las lista con su ubicación para elegir", async () => {
    api.searchSamples.mockResolvedValue({
      items: [located, { ...located, id: 10, location: "III · F4 · 2D", position: "2D" }],
      total: 2,
      page: 1,
      page_size: 8,
    });
    const user = userEvent.setup();
    render(<ThawForm users={users} sessionUser={gonzalo} onClose={vi.fn()} onSubmitted={vi.fn()} />);

    await user.type(screen.getByLabelText(/id environ del tubo/i), "BP009");
    const list = await screen.findByRole("list", { name: /muestras con ese id/i });
    expect(list).toHaveTextContent("III · F4 · 2C");
    expect(list).toHaveTextContent("III · F4 · 2D");
    await user.click(within(list).getByRole("button", { name: /2D/ }));
    await waitFor(() => expect(screen.getByLabelText(/^caja$/i)).toHaveValue("4"));
  });

  it("sin muestras activas con ese ID lo dice", async () => {
    api.searchSamples.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 8 });
    const user = userEvent.setup();
    render(<ThawForm users={users} sessionUser={gonzalo} onClose={vi.fn()} onSubmitted={vi.fn()} />);

    await user.type(screen.getByLabelText(/id environ del tubo/i), "ZZ1");
    expect(await screen.findByText(/no hay muestras activas con «zz1»/i)).toBeInTheDocument();
  });
});
