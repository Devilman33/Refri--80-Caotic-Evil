import { SAMPLE_TYPE_LABELS, UNASSIGNED_INITIALS, type SampleSortKey, type SampleWithLocation } from "../api/types";
import { formatDate } from "../utils/format";
import { NucleoWarning } from "./NucleoWarning";

export interface SortState {
  key: SampleSortKey;
  direction: "asc" | "desc";
}

export interface SamplesTableProps {
  samples: SampleWithLocation[];
  ownerLookup: Record<number, string>;
  onSelect: (sample: SampleWithLocation) => void;
  sort: SortState | null;
  onSortChange: (sort: SortState | null) => void;
  /** "Ver en el refri" (issue #6): enfoca la caja en el visor 3D y resalta la posición. */
  onViewInFreezer?: (sample: SampleWithLocation) => void;
}

const COLUMNS: { key: SampleSortKey; label: string }[] = [
  { key: "environ_id", label: "ID Environ" },
  { key: "description", label: "Descripción" },
  { key: "type", label: "Tipo" },
  { key: "owner", label: "Encargado" },
  { key: "passage", label: "Pasaje" },
  { key: "status", label: "Estado" },
  { key: "location", label: "Ubicación" },
  { key: "created_at", label: "Registrada" },
];

export function SamplesTable({ samples, ownerLookup, onSelect, sort, onSortChange, onViewInFreezer }: SamplesTableProps) {
  function toggleSort(key: SampleSortKey) {
    if (!sort || sort.key !== key) return onSortChange({ key, direction: "asc" });
    if (sort.direction === "asc") return onSortChange({ key, direction: "desc" });
    return onSortChange(null);
  }

  if (samples.length === 0) {
    return <div className="empty-state">No se encontraron muestras con estos filtros.</div>;
  }

  return (
    <div className="table-wrap">
      <table className="samples-table">
        <thead>
          <tr>
            {COLUMNS.map((column) => {
              const active = sort?.key === column.key;
              const arrow = active ? (sort!.direction === "asc" ? " ▲" : " ▼") : "";
              const ariaSort = active ? (sort!.direction === "asc" ? "ascending" : "descending") : "none";
              return (
                <th key={column.key} aria-sort={ariaSort}>
                  <button type="button" className="sort-button" onClick={() => toggleSort(column.key)}>
                    {column.label}
                    {arrow}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {samples.map((sample) => (
            <tr
              key={sample.id}
              tabIndex={0}
              onClick={() => onSelect(sample)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onSelect(sample);
              }}
              data-testid={`sample-row-${sample.id}`}
            >
              <td>
                <code>{sample.environ_id ?? "—"}</code>
              </td>
              <td>{sample.description ?? "—"}</td>
              <td>{SAMPLE_TYPE_LABELS[sample.type]}</td>
              <td>
                {/* SIN_ASIG es el centinela del importador, no una persona: mostrarlo
                    crudo obliga al operador a aprender un código interno. */}
                {ownerLookup[sample.owner_id] === UNASSIGNED_INITIALS ? (
                  <span className="badge badge-withdrawn">Sin encargado</span>
                ) : (
                  (ownerLookup[sample.owner_id] ?? "—")
                )}
              </td>
              <td>{sample.passage ?? "—"}</td>
              <td>
                <span className={`badge ${sample.status === "active" ? "badge-active" : "badge-withdrawn"}`}>
                  {sample.status === "active" ? "Activa" : "Retirada"}
                </span>
                {sample.is_core ? " " : null}
                <NucleoWarning isCore={sample.is_core} />
              </td>
              <td>
                {sample.location}
                {onViewInFreezer && (
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ marginLeft: 8, padding: "2px 8px", fontSize: 11 }}
                    onClick={(event) => {
                      event.stopPropagation();
                      onViewInFreezer(sample);
                    }}
                  >
                    Ver en el refri
                  </button>
                )}
              </td>
              <td>{formatDate(sample.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
