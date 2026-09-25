import type {
  AlertsRead,
  AnomalyGroup,
  AnomalyResolveRequest,
  AutocompleteSuggestion,
  IdLookupResult,
  ImportRunRead,
  BoxPositionStatus,
  BoxOccupancy,
  BoxMoveCreate,
  BoxMoveResult,
  BoxRead,
  FreezerOccupancy,
  MovementCreate,
  MovementRead,
  MovementResult,
  Page,
  PositionConflict,
  RackOccupancy,
  RackRead,
  SampleMoveCreate,
  SampleSearchFilters,
  SampleUpdate,
  SampleWithLocation,
  SectionOccupancy,
  SectionRead,
  UserCreate,
  UserRead,
  UserUpdate,
} from "./types";

const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ??
  "http://localhost:8000";

export class ApiError extends Error {
  status: number;
  /** Cuerpo `detail` crudo de la respuesta, p. ej. `PositionConflict` en un 409. */
  detail: unknown;

  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

function buildQuery<T extends object>(params: T): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params) as [string, unknown][]) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

// Persona que eligió quién es al entrar (docs/adr/0002-autenticacion.md). Viaja en cada
// request como `X-User-Id`; el backend la exige para registrar cambios sobre muestras.
let sessionUserId: number | null = null;

export function setSessionUserId(id: number | null): void {
  sessionUserId = id;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (sessionUserId !== null) headers.set("X-User-Id", String(sessionUserId));
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail;
    const message =
      (typeof detail === "string" ? detail : undefined) ??
      (typeof detail?.message === "string" ? detail.message : undefined) ??
      res.statusText;
    throw new ApiError(res.status, message, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patch<T>(path: string, body: unknown): Promise<T> {
  return request(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export const api = {
  searchSamples(filters: SampleSearchFilters): Promise<Page<SampleWithLocation>> {
    return request(`/samples/search${buildQuery(filters)}`);
  },
  getSample(id: number): Promise<SampleWithLocation> {
    return request(`/samples/${id}`);
  },
  getSampleMovements(id: number): Promise<MovementRead[]> {
    return request(`/samples/${id}/movements`);
  },
  listUsers(): Promise<UserRead[]> {
    return request(`/users`);
  },
  createUser(payload: UserCreate): Promise<UserRead> {
    return post(`/users`, payload);
  },
  updateUser(id: number, payload: UserUpdate): Promise<UserRead> {
    return patch(`/users/${id}`, payload);
  },
  listSections(): Promise<SectionRead[]> {
    return request(`/sections`);
  },
  listRacks(): Promise<RackRead[]> {
    return request(`/racks`);
  },
  listBoxes(params: { rack_id?: number } = {}): Promise<BoxRead[]> {
    return request(`/boxes${buildQuery(params)}`);
  },
  getBoxPositions(boxId: number): Promise<BoxPositionStatus[]> {
    return request(`/boxes/${boxId}/positions`);
  },
  getAutocompleteSuggestions(params: {
    environ_id?: string;
    owner_initials?: string;
  }): Promise<AutocompleteSuggestion> {
    return request(`/autocomplete/suggestions${buildQuery(params)}`);
  },
  getFreezerOccupancy(): Promise<FreezerOccupancy> {
    return request(`/occupancy/freezer`);
  },
  listSectionOccupancy(): Promise<SectionOccupancy[]> {
    return request(`/occupancy/sections`);
  },
  listRackOccupancy(): Promise<RackOccupancy[]> {
    return request(`/occupancy/racks`);
  },
  listBoxOccupancy(): Promise<BoxOccupancy[]> {
    return request(`/occupancy/boxes`);
  },
  /** Descarga el CSV de la búsqueda.
   *
   * Va por `fetch` y NO navegando a la URL: `request()` siempre hace `res.json()`, y una
   * navegación entregaría el 422 del tope como un archivo `.csv` con un JSON adentro. Acá
   * se ramifica sobre `res.ok` ANTES de tocar el cuerpo, así el error llega como ApiError
   * y la UI lo muestra donde corresponde.
   */
  async downloadSamplesCsv(filters: SampleSearchFilters): Promise<{ blob: Blob; filename: string }> {
    const res = await fetch(`${API_URL}/samples/export${buildQuery(filters)}`);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const detail = body?.detail;
      throw new ApiError(res.status, typeof detail === "string" ? detail : res.statusText, detail);
    }
    const disposition = res.headers.get("content-disposition") ?? "";
    const match = /filename="?([^"]+)"?/.exec(disposition);
    return { blob: await res.blob(), filename: match?.[1] ?? "muestras.csv" };
  },
  lookupByIds(environIdExact: string): Promise<IdLookupResult> {
    return request(`/samples/by-ids${buildQuery({ environ_id_exact: environIdExact })}`);
  },
  moveSample(id: number, payload: SampleMoveCreate): Promise<MovementResult> {
    return post(`/samples/${id}/movements`, payload);
  },
  moveBox(boxId: number, payload: BoxMoveCreate): Promise<BoxMoveResult> {
    return post(`/boxes/${boxId}/move`, payload);
  },
  listImportRuns(): Promise<ImportRunRead[]> {
    return request(`/imports`);
  },
  listAnomalyGroups(runId: number): Promise<AnomalyGroup[]> {
    return request(`/imports/${runId}/anomalies/groups`);
  },
  resolveAnomalies(runId: number, payload: AnomalyResolveRequest): Promise<{ updated: number }> {
    return request(`/imports/${runId}/anomalies`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  getAlerts(): Promise<AlertsRead> {
    return request(`/alerts`);
  },
  updateSample(id: number, payload: SampleUpdate): Promise<SampleWithLocation> {
    return patch(`/samples/${id}`, payload);
  },
  createMovement(payload: MovementCreate): Promise<MovementResult> {
    return post(`/movements`, payload);
  },
};

export type { PositionConflict };
