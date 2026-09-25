import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MovementResult, RackRead, SectionRead, UserRead } from "../../api/types";
import { FreezeForm } from "../FreezeForm";

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
      getAutocompleteSuggestions: vi.fn(),
      createMovement: vi.fn(),
    },
    ApiError: ApiErrorMock,
  };
});

vi.mock("../../api/client", () => ({ api, ApiError }));

const racks: RackRead[] = [{ id: 1, section_id: 1, letter: "A", slot: "center", capacity: 30 }];
const sections: SectionRead[] = [{ id: 1, code: "I" }];
const users: UserRead[] = [
  { id: 1, initials: "GC", name: "Guillermo", active: true },
  { id: 2, initials: "DB", name: "Daniela Bravo", active: true },
];

function baseMovementResult(overrides: Partial<MovementResult["sample"]> = {}): MovementResult {
  return {
    sample: {
      id: 1,
      environ_id: "BP001",
      description: null,
      type: "vial_celulas",
      type_other: null,
      owner_id: 1,
      passage: null,
      is_core: true,
      box_id: 1,
      position: "1A",
      notes: null,
      status: "active",
      created_at: "2026-01-10T00:00:00Z",
      updated_at: "2026-01-10T00:00:00Z",
      location: "I · A1 · 1A",
      ...overrides,
    },
    movement: {
      id: 1,
      sample_id: 1,
      action: "freeze",
      date: "2026-01-10",
      operator_id: 1,
      operator_initials: "GC",
      box_id: 1,
      position: "1A",
      location: "I · A1 · 1A",
      from_box_id: null,
      from_position: null,
      from_location: null,
      note: null,
      created_at: "2026-01-10T00:00:00Z",
    },
  };
}

async function fillRequiredFreezeFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/id environ/i), "BP001");
  await user.selectOptions(screen.getByLabelText(/^tipo$/i), "vial_celulas");
  await user.type(screen.getByLabelText(/nombre caja/i), "A1");
  await user.selectOptions(screen.getByLabelText(/núcleo environ/i), "true");
  await waitFor(() => expect(api.listBoxes).toHaveBeenCalled());
  await user.click(screen.getByRole("button", { name: /^posición 1a,/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listRacks.mockResolvedValue(racks);
  api.listSections.mockResolvedValue(sections);
  api.listBoxes.mockResolvedValue([]);
  api.getBoxPositions.mockResolvedValue([]);
  api.getAutocompleteSuggestions.mockResolvedValue({
    environ_id: null,
    description: null,
    sample_type: null,
    type_other: null,
    passage: null,
    is_core: null,
    owner_initials: null,
    rack_letter: null,
    box_number: null,
    box_id: null,
    next_free_position: null,
  });
});

function renderForm(props: Partial<Parameters<typeof FreezeForm>[0]> = {}) {
  return render(
    <FreezeForm users={users} sessionInitials="GC" onClose={vi.fn()} onSubmitted={vi.fn()} {...props} />,
  );
}

describe("FreezeForm", () => {
  it("muestra los campos del Google Form con las desviaciones de docs/FORMULARIO.md", async () => {
    renderForm();

    for (const label of [
      /^fecha$/i,
      /id environ/i,
      /descripción/i,
      /^tipo$/i,
      /operador/i,
      /pasaje/i,
      /sección/i,
      /nombre caja/i,
      /núcleo environ/i,
      /encargado de la muestra/i,
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole("group", { name: /posición en la caja/i })).toBeInTheDocument();
    // Ya no se pregunta: se calcula. Y congelar no comparte pantalla con descongelar.
    expect(screen.queryByLabelText(/caja está llena/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/acción/i)).not.toBeInTheDocument();
  });

  it("Operador y Encargado parten siendo la persona de la sesión, con su nombre", () => {
    renderForm();

    expect(screen.getByLabelText(/operador/i)).toHaveValue("GC");
    expect(screen.getByLabelText(/encargado de la muestra/i)).toHaveValue("GC");
    expect(screen.getAllByRole("option", { name: "Daniela Bravo (DB)" }).length).toBe(2);
  });

  it("Tipo = Otros muestra el campo para especificar y lo exige", async () => {
    const user = userEvent.setup();
    renderForm();

    expect(screen.queryByLabelText(/especifique el tipo/i)).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/^tipo$/i), "otros");
    expect(screen.getByLabelText(/especifique el tipo/i)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/^tipo$/i), "rna");
    expect(screen.queryByLabelText(/especifique el tipo/i)).not.toBeInTheDocument();
  });

  it("Núcleo es solo una marca: el encargado se pide y se envía igual", async () => {
    api.createMovement.mockResolvedValue(baseMovementResult());
    const user = userEvent.setup();
    renderForm();

    await fillRequiredFreezeFields(user);
    await user.selectOptions(screen.getByLabelText(/encargado de la muestra/i), "DB");
    await user.click(screen.getByRole("button", { name: /^guardar$/i }));

    await waitFor(() =>
      expect(api.createMovement).toHaveBeenCalledWith(
        expect.objectContaining({ action: "freeze", is_core: true, owner_initials: "DB" }),
      ),
    );
    expect(api.createMovement.mock.calls[0][0]).not.toHaveProperty("box_is_full");
  });

  it("muestra la grilla de cartón o la lista plástica según el tipo de subcaja elegido", async () => {
    const user = userEvent.setup();
    renderForm();

    expect(screen.getByRole("group", { name: /81 espacios caja cartón/i })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /100 espacios caja plástica/i })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/tipo de subcaja/i), "plastic_100");

    expect(screen.getByRole("group", { name: /100 espacios caja plástica/i })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /81 espacios caja cartón/i })).not.toBeInTheDocument();
  });

  it("no envía el movimiento y muestra errores si faltan campos obligatorios", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("button", { name: /^guardar$/i }));

    expect(api.createMovement).not.toHaveBeenCalled();
    expect(screen.getByText(/id environ es obligatorio/i)).toBeInTheDocument();
    expect(screen.getByText(/el tipo es obligatorio/i)).toBeInTheDocument();
  });

  it("la sección se completa sola según el rack de la caja", async () => {
    const user = userEvent.setup();
    renderForm();

    expect(screen.getByLabelText(/sección/i)).toHaveValue("");
    await user.type(screen.getByLabelText(/nombre caja/i), "A1");

    await waitFor(() => expect(screen.getByLabelText(/sección/i)).toHaveValue("I"));
  });

  it("autocompletado: sugiere los datos de otras muestras con el mismo ID Environ", async () => {
    api.getAutocompleteSuggestions.mockResolvedValue({
      environ_id: "BP001",
      description: "Biopsia de próstata",
      sample_type: "rna",
      type_other: null,
      passage: 4,
      is_core: false,
      owner_initials: "DB",
      rack_letter: "A",
      box_number: 1,
      box_id: 5,
      next_free_position: "2A",
    });
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/id environ/i), "BP001");

    await waitFor(() => expect(api.getAutocompleteSuggestions).toHaveBeenCalledWith({ environ_id: "BP001" }));
    await waitFor(() => expect(screen.getByLabelText(/descripción/i)).toHaveValue("Biopsia de próstata"));
    expect(screen.getByLabelText(/^tipo$/i)).toHaveValue("rna");
    expect(screen.getByLabelText(/núcleo environ/i)).toHaveValue("false");
    expect(screen.getByLabelText(/encargado de la muestra/i)).toHaveValue("DB");
    expect(screen.getByLabelText(/nombre caja/i)).toHaveValue("A1");
  });

  it('"Guardar y agregar otra del mismo set" conserva los datos y avanza a la siguiente posición libre', async () => {
    api.createMovement.mockResolvedValue(baseMovementResult());
    const onSubmitted = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderForm({ onClose, onSubmitted });

    await fillRequiredFreezeFields(user);

    await user.click(screen.getByRole("button", { name: /agregar otra del mismo set/i }));

    await waitFor(() => expect(api.createMovement).toHaveBeenCalledTimes(1));
    expect(api.createMovement).toHaveBeenCalledWith(expect.objectContaining({ position: "1A", environ_id: "BP001" }));
    expect(onSubmitted).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    await waitFor(() => expect(screen.getByRole("button", { name: /^posición 1b,/i })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByLabelText(/id environ/i)).toHaveValue("BP001");

    await user.click(screen.getByRole("button", { name: /^guardar$/i }));
    await waitFor(() => expect(api.createMovement).toHaveBeenCalledTimes(2));
    expect(api.createMovement).toHaveBeenLastCalledWith(expect.objectContaining({ position: "1B", environ_id: "BP001" }));
  });

  it("ante una posición ocupada (409) muestra el error y ofrece la siguiente libre", async () => {
    api.createMovement.mockRejectedValue(
      new ApiError(409, "La posición 1A ya está ocupada", {
        message: "La posición 1A ya está ocupada",
        next_free_position: "1B",
      }),
    );
    const user = userEvent.setup();
    renderForm();

    await fillRequiredFreezeFields(user);
    await user.click(screen.getByRole("button", { name: /^guardar$/i }));

    const useSuggested = await screen.findByRole("button", { name: /usar siguiente libre \(1b\)/i });

    await user.click(useSuggested);

    expect(screen.getByRole("button", { name: /^posición 1b,/i })).toHaveAttribute("aria-pressed", "true");
  });

  it("prellena caja, sección y posición cuando viene de un clic en el visor 3D", async () => {
    renderForm({ initial: { sectionCode: "I", rackLetter: "A", boxNumber: 1, boxType: "carton_81", position: "1A" } });

    expect(screen.getByLabelText(/nombre caja/i)).toHaveValue("A1");
    await waitFor(() => expect(screen.getByLabelText(/sección/i)).toHaveValue("I"));
    await waitFor(() => expect(screen.getByRole("button", { name: /^posición 1a,/i })).toHaveAttribute("aria-pressed", "true"));
  });

  it("la grilla marca el núcleo y trae leyenda", async () => {
    api.listBoxes.mockResolvedValue([{ id: 5, rack_id: 1, number: 1, box_type: "carton_81", label: null, owner_id: null, is_full: null }]);
    api.getBoxPositions.mockResolvedValue([
      { position: "1A", occupied: true, sample_id: 9, environ_id: "BP009", is_core: true },
    ]);
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/nombre caja/i), "A1");
    await waitFor(() => expect(api.getBoxPositions).toHaveBeenCalled());

    // Regla no negociable: el warning de Núcleo es visible en TODAS las vistas.
    const core = await screen.findByRole("button", { name: /^posición 1a, ocupada, núcleo$/i });
    expect(core).toHaveClass("position-cell--core");
    expect(screen.getByText(/ocupada/)).toBeInTheDocument();
  });
});

