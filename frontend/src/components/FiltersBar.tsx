import type { ChangeEvent } from "react";
import {
  RACK_LETTERS,
  SAMPLE_TYPE_LABELS,
  SECTION_CODES,
  type SampleSearchFilters,
  type SampleStatus,
  type SampleType,
} from "../api/types";

export interface FiltersBarProps {
  filters: SampleSearchFilters;
  onChange: (next: SampleSearchFilters) => void;
  myInitials: string;
  onMyInitialsChange: (initials: string) => void;
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
  myInitials,
  onMyInitialsChange,
  myFilterActive,
  onToggleMyFilter,
}: FiltersBarProps) {
  function set<K extends keyof SampleSearchFilters>(key: K, value: SampleSearchFilters[K]) {
    onChange({ ...filters, [key]: value, page: 1 });
  }

  function handleText(key: keyof SampleSearchFilters) {
    return (event: ChangeEvent<HTMLInputElement>) => set(key, toOptionalString(event.target.value) as never);
  }

  function handleNumber(key: keyof SampleSearchFilters) {
    return (event: ChangeEvent<HTMLInputElement>) => set(key, toOptionalNumber(event.target.value) as never);
  }

  function clearFilters() {
    onChange({ page: 1, page_size: filters.page_size });
  }

  return (
    <div className="panel">
      <div className="filters-bar">
        <div className="field">
          <label htmlFor="filter-environ-id">ID Environ</label>
          <input
            id="filter-environ-id"
            value={filters.environ_id ?? ""}
            onChange={handleText("environ_id")}
            placeholder="p. ej. BP1234"
          />
        </div>

        <div className="field">
          <label htmlFor="filter-description">ID Origen / Descripción</label>
          <input
            id="filter-description"
            value={filters.description ?? ""}
            onChange={handleText("description")}
          />
        </div>

        <div className="field">
          <label htmlFor="filter-owner">Encargado</label>
          <input
            id="filter-owner"
            value={filters.owner_initials ?? ""}
            onChange={handleText("owner_initials")}
            placeholder="Iniciales"
          />
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
            onChange={handleText("date_from")}
          />
        </div>

        <div className="field">
          <label htmlFor="filter-date-to">Fecha hasta</label>
          <input
            id="filter-date-to"
            type="date"
            value={filters.date_to ?? ""}
            onChange={handleText("date_to")}
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
        <input
          aria-label="Mis iniciales"
          placeholder="Mis iniciales"
          value={myInitials}
          onChange={(event) => onMyInitialsChange(event.target.value)}
          style={{
            width: 110,
            background: "var(--chip)",
            border: "1px solid var(--line)",
            borderRadius: 6,
            padding: "7px 8px",
          }}
        />
        <button
          type="button"
          className={`btn-ghost${myFilterActive ? " on" : ""}`}
          onClick={onToggleMyFilter}
          disabled={myInitials.trim() === ""}
          aria-pressed={myFilterActive}
        >
          Mis muestras
        </button>
        <button type="button" className="btn-ghost" onClick={clearFilters}>
          Limpiar filtros
        </button>
      </div>
    </div>
  );
}
