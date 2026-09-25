import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { api, ApiError } from "../api/client";
import {
  RACK_LETTERS,
  SAMPLE_TYPE_LABELS,
  SECTION_CODES,
  type SampleSearchFilters,
  type SampleStatus,
  type SampleType,
  type UserRead,
} from "../api/types";
import { selectableUsers, userLabel } from "../utils/users";

export interface FiltersBarProps {
  filters: SampleSearchFilters;
  onChange: (next: SampleSearchFilters) => void;
  /** Total de la búsqueda actual. El botón de export lo muestra para que se sepa cuánto
   * se está por bajar antes de hacer clic, y se deshabilita en cero. */
  total: number;
  /** Personas registradas: el filtro de Encargado es una lista, no texto libre. */
  users: UserRead[];
  myFilterActive: boolean;
  onToggleMyFilter: () => void;
}

const SAMPLE_TYPE_OPTIONS = Object.entries(SAMPLE_TYPE_LABELS) as [SampleType, string][];

function toOptionalString(value: string): string | undefined {
  return value === "" ? undefined : value;
}

function toOptionalNumber(value: string): number | undefined {
  return value === "" ? undefined : Number(value);
}

export function FiltersBar({
  filters,
  onChange,
  total,
  users,
  myFilterActive,
  onToggleMyFilter,
}: FiltersBarProps) {
  function set<K extends keyof SampleSearchFilters>(key: K, value: SampleSearchFilters[K]) {
    onChange({ ...filters, [key]: value, page: 1 });
  }

  // Los campos de texto se escriben letra por letra, y cada pulsación disparaba una
  // búsqueda: escribir "BP" hacía dos requests y la tabla parpadeaba. 300 ms es el mismo
  // valor que ya usa MovementForm para resolver la caja, así que es el patrón de la casa.
  // Los selects y las fechas NO se debouncean: son un solo gesto, esperar los haría
  // sentir rotos.
  const [text, setText] = useState({
    environ_id: filters.environ_id ?? "",
    description: filters.description ?? "",
  });
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  // Cuando los filtros cambian desde afuera (limpiar, "Mis muestras"), el estado local
  // tiene que seguirlos o el input mostraría lo viejo.
  useEffect(() => {
    setText({
      environ_id: filters.environ_id ?? "",
      description: filters.description ?? "",
    });
  }, [filters.environ_id, filters.description]);

  useEffect(() => {
    const current = filtersRef.current;
    const changed =
      (current.environ_id ?? "") !== text.environ_id ||
      (current.description ?? "") !== text.description;
    if (!changed) return;

    const timer = setTimeout(() => {
      onChange({
        ...filtersRef.current,
        environ_id: toOptionalString(text.environ_id),
        description: toOptionalString(text.description),
        page: 1,
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [text, onChange]);

  function handleText(key: "environ_id" | "description") {
    return (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setText((current) => ({ ...current, [key]: value }));
    };
  }

  function handleDate(key: keyof SampleSearchFilters) {
    return (event: ChangeEvent<HTMLInputElement>) => set(key, toOptionalString(event.target.value) as never);
  }

  function handleNumber(key: keyof SampleSearchFilters) {
    return (event: ChangeEvent<HTMLInputElement>) => set(key, toOptionalNumber(event.target.value) as never);
  }

  function clearFilters() {
    onChange({ page: 1, page_size: filters.page_size });
  }

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  async function exportCsv() {
    setExporting(true);
    setExportError(null);
    try {
      // Se piden TODOS los resultados del filtro, no la página que se está viendo: el
      // export existe para llevarse la búsqueda entera.
      const { page, page_size, sort_by, sort_dir, ...forExport } = filters;
      void page;
      void page_size;
      void sort_by;
      void sort_dir;
      const { blob, filename } = await api.downloadSamplesCsv(forExport);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : "No se pudo generar el archivo");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="panel">
      <div className="filters-bar">
        <div className="field">
          <label htmlFor="filter-environ-id">ID Environ</label>
          <input
            id="filter-environ-id"
            value={text.environ_id}
            onChange={handleText("environ_id")}
            placeholder="p. ej. BP1234"
          />
        </div>

        <div className="field">
          <label htmlFor="filter-description">ID Origen / Descripción</label>
          <input
            id="filter-description"
            value={text.description}
            onChange={handleText("description")}
          />
        </div>

        <div className="field">
          <label htmlFor="filter-owner">Encargado</label>
          <select
            id="filter-owner"
            value={filters.owner_initials ?? ""}
            onChange={(event) => set("owner_initials", toOptionalString(event.target.value))}
          >
            <option value="">Todos</option>
            {selectableUsers(users).map((user) => (
              <option key={user.id} value={user.initials}>
                {userLabel(user)}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="filter-type">Tipo</label>
          <select
            id="filter-type"
            value={filters.type ?? ""}
            onChange={(event) => set("type", toOptionalString(event.target.value) as SampleType | undefined)}
          >
            <option value="">Todos</option>
            {SAMPLE_TYPE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="filter-nucleo">Núcleo</label>
          <select
            id="filter-nucleo"
            value={filters.is_core === undefined ? "" : String(filters.is_core)}
            onChange={(event) => {
              const raw = event.target.value;
              set("is_core", raw === "" ? undefined : raw === "true");
            }}
          >
            <option value="">Todos</option>
            <option value="true">Sí</option>
            <option value="false">No</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="filter-passage">Pasaje</label>
          <input
            id="filter-passage"
            type="number"
            value={filters.passage ?? ""}
            onChange={handleNumber("passage")}
          />
        </div>

        <div className="field">
          <label htmlFor="filter-status">Estado</label>
          <select
            id="filter-status"
            value={filters.status ?? ""}
            onChange={(event) => set("status", toOptionalString(event.target.value) as SampleStatus | undefined)}
          >
            <option value="">Todos</option>
            <option value="active">Activa</option>
            <option value="withdrawn">Retirada</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="filter-date-from">Fecha desde</label>
          <input
            id="filter-date-from"
            type="date"
            value={filters.date_from ?? ""}
            onChange={handleDate("date_from")}
          />
        </div>

        <div className="field">
          <label htmlFor="filter-date-to">Fecha hasta</label>
          <input
            id="filter-date-to"
            type="date"
            value={filters.date_to ?? ""}
            onChange={handleDate("date_to")}
          />
        </div>

        <div className="field">
          <label htmlFor="filter-section">Sección</label>
          <select
            id="filter-section"
            value={filters.section_code ?? ""}
            onChange={(event) => set("section_code", toOptionalString(event.target.value))}
          >
            <option value="">Todas</option>
            {SECTION_CODES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="filter-rack">Rack</label>
          <select
            id="filter-rack"
            value={filters.rack_letter ?? ""}
            onChange={(event) => set("rack_letter", toOptionalString(event.target.value))}
          >
            <option value="">Todos</option>
            {RACK_LETTERS.map((letter) => (
              <option key={letter} value={letter}>
                {letter}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="filter-box">N° caja</label>
          <input id="filter-box" type="number" value={filters.box_number ?? ""} onChange={handleNumber("box_number")} />
        </div>
      </div>

      <div className="filters-actions" style={{ marginTop: 12 }}>
        <button
          type="button"
          className={`btn-ghost${myFilterActive ? " on" : ""}`}
          onClick={onToggleMyFilter}
          aria-pressed={myFilterActive}
        >
          Mis muestras
        </button>
        <button type="button" className="btn-ghost" onClick={clearFilters}>
          Limpiar filtros
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => void exportCsv()}
          disabled={total === 0 || exporting}
          title={total === 0 ? "No hay resultados para exportar" : undefined}
        >
          {exporting ? "Generando…" : `Exportar CSV (${total.toLocaleString("es-CL")})`}
        </button>
      </div>
      {exportError && (
        <p className="field-error" role="alert">
          {exportError}
        </p>
      )}
    </div>
  );
}
