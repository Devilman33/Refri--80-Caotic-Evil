import { useMemo, useState } from "react";
import { SAMPLE_TYPE_LABELS, type SampleWithLocation } from "../api/types";
import { formatDate } from "../utils/format";
import { NucleoWarning } from "./NucleoWarning";

export interface SamplesTableProps {
  samples: SampleWithLocation[];
  ownerLookup: Record<number, string>;
  onSelect: (sample: SampleWithLocation) => void;
}

type SortKey = "environ_id" | "description" | "type" | "owner" | "passage" | "status" | "location" | "created_at";

interface SortState {
  key: SortKey;
  direction: "asc" | "desc";
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "environ_id", label: "ID Environ" },
  { key: "description", label: "Descripción" },
  { key: "type", label: "Tipo" },
  { key: "owner", label: "Encargado" },
  { key: "passage", label: "Pasaje" },
  { key: "status", label: "Estado" },
  { key: "location", label: "Ubicación" },
  { key: "created_at", label: "Registrada" },
];

function sortValue(sample: SampleWithLocation, key: SortKey, ownerLookup: Record<number, string>): string | number {
  switch (key) {
    case "environ_id":
      return sample.environ_id ?? "";
    case "description":
      return sample.description ?? "";
    case "type":
      return SAMPLE_TYPE_LABELS[sample.type];
    case "owner":
      return ownerLookup[sample.owner_id] ?? "";
    case "passage":
      return sample.passage ?? -1;
    case "status":
      return sample.status;
    case "location":
      return sample.location;
    case "created_at":
      return sample.created_at;
  }
}

export function SamplesTable({ samples, ownerLookup, onSelect }: SamplesTableProps) {
  const [sort, setSort] = useState<SortState | null>(null);

  const sorted = useMemo(() => {
    if (!sort) return samples;
    const copy = [...samples];
    copy.sort((a, b) => {
      const va = sortValue(a, sort.key, ownerLookup);
      const vb = sortValue(b, sort.key, ownerLookup);
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return sort.direction === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [samples, sort, ownerLookup]);

  function toggleSort(key: SortKey) {
    setSort((current) => {
      if (!current || current.key !== key) return { key, direction: "asc" };
      if (current.direction === "asc") return { key, direction: "desc" };
      return null;
    });
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
              const ariaSort = active ? (sort!.direction === "asc" ? "ascending" : "descending") : undefined;
              return (
                <th key={column.key} onClick={() => toggleSort(column.key)} aria-sort={ariaSort}>
                  {column.label}
                  {arrow}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((sample) => (
            <tr key={sample.id} onClick={() => onSelect(sample)} data-testid={`sample-row-${sample.id}`}>
              <td>
                <code>{sample.environ_id ?? "—"}</code>
              </td>
              <td>{sample.description ?? "—"}</td>
              <td>{SAMPLE_TYPE_LABELS[sample.type]}</td>
              <td>{ownerLookup[sample.owner_id] ?? "—"}</td>
              <td>{sample.passage ?? "—"}</td>
              <td>
                <span className={`badge ${sample.status === "active" ? "badge-active" : "badge-withdrawn"}`}>
                  {sample.status === "active" ? "Activa" : "Retirada"}
                </span>
                {sample.is_core ? " " : null}
                <NucleoWarning isCore={sample.is_core} />
              </td>
              <td>{sample.location}</td>
              <td>{formatDate(sample.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
