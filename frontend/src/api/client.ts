import type {
  MovementRead,
  Page,
  SampleSearchFilters,
  SampleWithLocation,
  UserRead,
} from "./types";

const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ??
  "http://localhost:8000";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
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

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message =
      (typeof body?.detail === "string" ? body.detail : undefined) ?? res.statusText;
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
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
};
