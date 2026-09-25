/**
 * Integración de App: los flujos que cruzan barra, vistas, detalle y formularios.
 *
 *   api (mock, un vi.fn por método bajo demanda) ──► App ──► FreezerViewer (doble sin WebGL)
 *
 * El visor real necesita WebGL; el doble expone lo que App le pasa (focusTarget,
 * reloadToken) y botones para disparar sus callbacks.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SampleWithLocation, UserRead } from "../api/types";
import App from "../App";

const { api, ApiError, viewerMounts } = vi.hoisted(() => {
  class ApiErrorMock extends Error {
    status: number;
    detail: unknown;
    constructor(status: number, message: string, detail?: unknown) {
      super(message);
      this.status = status;
      this.detail = detail;
    }
  }
  // Cualquier método que la app pida existe y devuelve [] salvo que el test lo configure.
  const fns: Record<string, ReturnType<typeof vi.fn>> = {};
  const api = new Proxy(fns, {
    get: (target, key: string) => (target[key] ??= vi.fn().mockResolvedValue([])),
  }) as Record<string, ReturnType<typeof vi.fn>>;
  return { api, ApiError: ApiErrorMock, viewerMounts: { count: 0 } };
});

vi.mock("../api/client", () => ({ api, ApiError, setSessionUserId: vi.fn() }));

vi.mock("../components/FreezerViewer", async () => {
  const { useEffect } = await import("react");
  return {
    FreezerViewer: (props: {
      focusTarget?: { boxId: number; position: string | null } | null;
      reloadToken?: number;
      locationQuery?: { query: string } | null;
      onSelectOccupiedPosition: (selection: { sampleId: number }) => void;
    }) => {
      useEffect(() => {
        viewerMounts.count += 1;
      }, []);
      return (
        <section aria-label="Visor 3D (doble)">
          <p data-testid="viewer-focus">
            {props.focusTarget ? `${props.focusTarget.boxId}:${props.focusTarget.position ?? "-"}` : "sin foco"}
          </p>
          <p data-testid="viewer-location">{props.locationQuery?.query ?? "sin ubicación"}</p>
          <p data-testid="viewer-reload">{props.reloadToken ?? "sin token"}</p>
          <button type="button" onClick={() => props.onSelectOccupiedPosition({ sampleId: 9 })}>
            Posición ocupada 3B
          </button>
        </section>
      );
    },
  };
});

const gonzalo: UserRead = { id: 1, initials: "GC", name: "Gonzalo Carrasco", active: true };

function sample(overrides: Partial<SampleWithLocation> = {}): SampleWithLocation {
  return {
    id: 9,
    environ_id: "BP009",
    description: "Biopsia",
    type: "rna",
    type_other: null,
    owner_ids: [1],
    passage: 3,
    is_core: false,
    box_id: 5,
    position: "3B",
    notes: null,
    status: "active",
    created_at: "2026-01-10T00:00:00Z",
    updated_at: "2026-01-10T00:00:00Z",
    location: "III · F12 · 3B",
    section_code: "III",
    rack_letter: "F",
    box_number: 12,
    box_type: "carton_81",
    ...overrides,
  };
}

const occupiedBox = {
  box_id: 5,
  number: 12,
  rack_id: 3,
  rack_letter: "F",
  section_code: "III",
  box_type: "carton_81",
  is_full: false,
  active: 1,
  capacity: 81,
  percent: 1.2,
};
const occupiedPositions = [
  { position: "3B", occupied: true, sample_id: 9, environ_id: "BP009", is_core: false, owners: ["Gonzalo Carrasco"] },
];

function page(items: SampleWithLocation[]) {
  return { items, total: items.length, page: 1, page_size: 25 };
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset().mockResolvedValue([]);
  viewerMounts.count = 0;
  localStorage.clear();
  localStorage.setItem("refri:sesion-usuario", "1");
  api.listUsers.mockResolvedValue([gonzalo]);
  api.searchSamples.mockResolvedValue(page([sample()]));
  api.getSample.mockResolvedValue(sample());
  api.getAlerts.mockResolvedValue({ unassigned: 0, full_boxes: 0, anomalies: 0 });
});

describe("App · descongelar desde el detalle", () => {
  it("prellena la caja y la posición con la ubicación por partes, sin parsear el texto", async () => {
    const user = userEvent.setup();
    api.listBoxOccupancy.mockResolvedValue([occupiedBox]);
    api.getBoxPositions.mockResolvedValue(occupiedPositions);
    // El texto no se puede parsear: si la app todavía lo usara, el formulario abriría vacío.
    api.searchSamples.mockResolvedValue(page([sample({ location: "ubicación sin formato" })]));
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /vista tabla/i }));
    await user.click(await screen.findByText("BP009"));
    const detail = await screen.findByRole("dialog");
    await user.click(within(detail).getByRole("button", { name: /^descongelar$/i }));

    const thaw = await screen.findByRole("dialog", { name: /retirar muestra/i });
    await waitFor(() => expect(within(thaw).getByLabelText(/sección/i)).toHaveValue("III"));
    await waitFor(() => expect(within(thaw).getByLabelText(/^rack$/i)).toHaveValue("F"));
  });
});

describe("App · recarga del visor", () => {
  it("después de un movimiento el visor recarga sus datos sin desmontarse", async () => {
    const user = userEvent.setup();
    api.listBoxOccupancy.mockResolvedValue([occupiedBox]);
    api.getBoxPositions.mockResolvedValue(occupiedPositions);
    api.createMovement.mockResolvedValue({ sample: sample({ status: "withdrawn" }), movement: {} });
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /posición ocupada 3b/i }));
    const detail = await screen.findByRole("dialog");
    await user.click(within(detail).getByRole("button", { name: /^descongelar$/i }));
    const thaw = await screen.findByRole("dialog", { name: /retirar muestra/i });
    await within(thaw).findByRole("region", { name: /muestra a retirar/i });
    await user.type(within(thaw).getByLabelText(/motivo del retiro/i), "Extracción de RNA");
    await user.click(within(thaw).getByRole("button", { name: /retirar muestra/i }));

    await waitFor(() => expect(screen.getByTestId("viewer-reload")).toHaveTextContent("1"));
    expect(viewerMounts.count).toBe(1);
  });
});

describe("App · buscador global (F3)", () => {
  async function search(text: string) {
    const user = userEvent.setup();
    render(<App />);
    const input = await screen.findByRole("combobox", { name: /buscar muestra o ubicación/i });
    await user.type(input, `${text}{Enter}`);
    return user;
  }

  it("con un resultado va al 3D, enfoca su posición y abre el detalle", async () => {
    api.searchSamples.mockImplementation((filters: { q?: string }) =>
      Promise.resolve(filters.q ? page([sample()]) : page([])),
    );
    await search("BP009");

    await waitFor(() => expect(screen.getByTestId("viewer-focus")).toHaveTextContent("5:3B"));
    expect(await screen.findByRole("dialog")).toHaveTextContent("BP009");
    expect(api.searchSamples).toHaveBeenCalledWith(expect.objectContaining({ q: "BP009", status: "active" }));
  });

  it("con varios resultados abre la tabla filtrada, con el chip para quitar la búsqueda", async () => {
    api.searchSamples.mockImplementation((filters: { q?: string }) =>
      Promise.resolve(filters.q ? page([sample(), sample({ id: 10, environ_id: "BP0091" })]) : page([])),
    );
    const user = await search("BP009");

    const chip = await screen.findByText(/búsqueda: «bp009»/i);
    expect(screen.getByRole("button", { name: /vista tabla/i })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(chip).getByRole("button", { name: /quitar la búsqueda/i }));
    await waitFor(() => expect(screen.queryByText(/búsqueda: «bp009»/i)).not.toBeInTheDocument());
  });

  it("una ubicación va directo al 3D sin buscar muestras", async () => {
    await search("F12-3B");

    await waitFor(() => expect(screen.getByTestId("viewer-location")).toHaveTextContent("F12-3B"));
    expect(api.searchSamples).not.toHaveBeenCalledWith(expect.objectContaining({ q: expect.anything() }));
  });

  it("sin resultados lo dice y ofrece buscar también las retiradas", async () => {
    api.searchSamples.mockResolvedValue(page([]));
    const user = await search("ZZ999");

    expect(await screen.findByText(/no hay muestras activas con «zz999»/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /buscar también retiradas/i }));
    await waitFor(() =>
      expect(api.searchSamples).toHaveBeenLastCalledWith(expect.objectContaining({ q: "ZZ999", status: undefined })),
    );
  });

  it("si la búsqueda falla lo dice y deja reintentar", async () => {
    api.searchSamples.mockImplementation((filters: { q?: string }) =>
      filters.q ? Promise.reject(new Error("red")) : Promise.resolve(page([])),
    );
    await search("BP009");

    expect(await screen.findByText(/no se pudo buscar/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reintentar/i })).toBeInTheDocument();
  });

  it("descarta la respuesta de un texto anterior que llega tarde", async () => {
    let resolveOld: (value: unknown) => void = () => undefined;
    api.searchSamples.mockImplementation((filters: { q?: string }) => {
      if (filters.q === "BP0") return new Promise((resolve) => (resolveOld = resolve));
      if (filters.q === "BP009") return Promise.resolve(page([sample()]));
      return Promise.resolve(page([]));
    });
    const user = userEvent.setup();
    render(<App />);
    const input = await screen.findByRole("combobox", { name: /buscar muestra o ubicación/i });
    await user.type(input, "BP0");
    await waitFor(() => expect(api.searchSamples).toHaveBeenCalledWith(expect.objectContaining({ q: "BP0" })));
    await user.type(input, "09");
    expect(await screen.findByRole("option", { name: /BP009/ })).toBeInTheDocument();

    resolveOld(page([sample({ id: 77, environ_id: "BP0777" })]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole("option", { name: /BP0777/ })).not.toBeInTheDocument();
  });
});

describe("App · barra superior", () => {
  it("muestra el aviso de alertas cuando hay alertas (antes no aparecía nunca)", async () => {
    api.getAlerts.mockResolvedValue({
      unassigned_samples: 2,
      nearly_full_boxes: 1,
      full_boxes: 0,
      inconsistent_full_boxes: 0,
      boxes: [],
    });
    render(<App />);
    expect(await screen.findByRole("button", { name: /3 alertas/i })).toBeInTheDocument();
  });

  it("Usuarios, tema y cambio de usuario viven en el menú de usuario", async () => {
    const user = userEvent.setup();
    render(<App />);
    const menuButton = await screen.findByRole("button", { name: /gonzalo carrasco/i });
    expect(screen.queryByRole("button", { name: /cambiar usuario/i })).not.toBeInTheDocument();
    await user.click(menuButton);
    expect(screen.getByRole("button", { name: /cambiar usuario/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^usuarios$/i })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: /cambiar usuario/i })).not.toBeInTheDocument();
  });
});
