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
    }) => {
      useEffect(() => {
        viewerMounts.count += 1;
      }, []);
      return (
        <section aria-label="Visor 3D (doble)">
          <p data-testid="viewer-focus">
            {props.focusTarget ? `${props.focusTarget.boxId}:${props.focusTarget.position ?? "-"}` : "sin foco"}
          </p>
          <p data-testid="viewer-reload">{props.reloadToken ?? "sin token"}</p>
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
    api.listBoxOccupancy.mockResolvedValue([
      {
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
      },
    ]);
    api.getBoxPositions.mockResolvedValue([
      { position: "3B", occupied: true, sample_id: 9, environ_id: "BP009", is_core: false, owners: ["Gonzalo Carrasco"] },
    ]);
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
