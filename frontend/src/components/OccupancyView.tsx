import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import type { BoxOccupancy, FreezerOccupancy, RackOccupancy, SectionOccupancy } from "../api/types";
import {
  boxLabel,
  formatPercent,
  isHighlighted,
  sortBoxes,
  usageLevel,
  USAGE_LEVEL_LABELS,
  type BoxSortKey,
  type SortDirection,
} from "../utils/occupancy";

export interface OccupancyViewProps {
  /** "Ver en el refri": abre el visor 3D enfocado en esa subcaja. */
  onViewBox: (box: BoxOccupancy) => void;
}

interface OccupancyData {
  freezer: FreezerOccupancy;
  sections: SectionOccupancy[];
  racks: RackOccupancy[];
  boxes: BoxOccupancy[];
}

export function UsageBar({ percent, level, label }: { percent: number; level: string; label: string }) {
  const width = Math.min(Math.max(percent, 0), 100);
  return (
    <div
      className={`usage-bar usage-bar--${level}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
    >
      <span className="usage-bar__fill" style={{ width: `${width}%` }} />
    </div>
  );
}

const SORT_LABELS: Record<BoxSortKey, string> = {
  percent: "% de uso",
  location: "Ubicación",
  free: "Posiciones libres",
};

// Vista de almacenamiento (issue #7): % de uso del freezer, por sección, por rack
// y por subcaja (la cajita 9×9 o 10×10), con las llenas y casi llenas destacadas.
export function OccupancyView({ onViewBox }: OccupancyViewProps) {
  const [data, setData] = useState<OccupancyData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<BoxSortKey>("percent");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [onlyHighlighted, setOnlyHighlighted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.getFreezerOccupancy(),
      api.listSectionOccupancy(),
      api.listRackOccupancy(),
      api.listBoxOccupancy(),
    ])
      .then(([freezer, sections, racks, boxes]) => {
        if (!cancelled) setData({ freezer, sections, racks, boxes });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "No se pudo cargar el % de uso");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const boxes = useMemo(() => {
    if (!data) return [];
    const filtered = onlyHighlighted ? data.boxes.filter(isHighlighted) : data.boxes;
    return sortBoxes(filtered, sortKey, sortDir);
  }, [data, onlyHighlighted, sortKey, sortDir]);

  const highlightedCount = useMemo(() => data?.boxes.filter(isHighlighted).length ?? 0, [data]);

  if (error) {
    return (
      <div className="empty-state" role="alert">
        {error}
      </div>
    );
  }
  if (!data) return <div className="empty-state">Cargando % de uso…</div>;

  function toggleSort(key: BoxSortKey) {
    if (key === sortKey) setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "location" ? "asc" : "desc");
    }
  }

  const freezerLevel = usageLevel(data.freezer);

  return (
    <div className="occupancy-view">
      <section className="usage-card" aria-label="Freezer completo">
        <div className="usage-card__head">
          <h2>Freezer completo</h2>
          <strong>{formatPercent(data.freezer.percent)}</strong>
        </div>
        <UsageBar percent={data.freezer.percent} level={freezerLevel} label="% de uso del freezer" />
        <p className="usage-card__meta">
          {data.freezer.active} de {data.freezer.capacity} posiciones ocupadas
        </p>
      </section>

      <div className="usage-grid">
        <section className="usage-card" aria-label="Uso por sección">
          <h3>Por sección</h3>
          <ul className="usage-list">
            {data.sections.map((section) => (
              <li key={section.section_id}>
                <span className="usage-list__name">Sección {section.code}</span>
                <UsageBar percent={section.percent} level={usageLevel(section)} label={`% de uso de la sección ${section.code}`} />
                <span className="usage-list__value">{formatPercent(section.percent)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="usage-card" aria-label="Uso por rack">
          <h3>Por rack</h3>
          <ul className="usage-list">
            {data.racks.map((rack) => (
              <li key={rack.rack_id}>
                <span className="usage-list__name">
                  Rack {rack.letter} <small>· Sección {rack.section_code}</small>
                </span>
                <UsageBar percent={rack.percent} level={usageLevel(rack)} label={`% de uso del rack ${rack.letter}`} />
                <span className="usage-list__value">{formatPercent(rack.percent)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="usage-card" aria-label="Uso por subcaja">
        <div className="usage-card__head">
          <h3>Por subcaja</h3>
          <label className="tog">
            <input type="checkbox" checked={onlyHighlighted} onChange={(event) => setOnlyHighlighted(event.target.checked)} />
            Solo llenas y casi llenas ({highlightedCount})
          </label>
        </div>
        {boxes.length === 0 ? (
          <p className="empty-state">
            {onlyHighlighted ? "No hay subcajas llenas ni casi llenas." : "Todavía no hay subcajas registradas."}
          </p>
        ) : (
          <div className="table-wrap">
            <table className="samples-table usage-table">
              <thead>
                <tr>
                  {(["location", "percent", "free"] as BoxSortKey[]).map((key) => (
                    <th key={key} aria-sort={sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                      <button type="button" className="sort-button" onClick={() => toggleSort(key)}>
                        {SORT_LABELS[key]}
                        {sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                      </button>
                    </th>
                  ))}
                  <th>Estado</th>
                  <th>
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {boxes.map((box) => {
                  const level = usageLevel(box);
                  return (
                    <tr key={box.box_id} className={`usage-row usage-row--${level}`}>
                      <td>
                        <strong>{boxLabel(box)}</strong>{" "}
                        <small>{box.box_type === "carton_81" ? "9 × 9" : "10 × 10"}</small>
                      </td>
                      <td>
                        <div className="usage-cell">
                          <UsageBar percent={box.percent} level={level} label={`% de uso de la subcaja ${boxLabel(box)}`} />
                          <span>{formatPercent(box.percent)}</span>
                        </div>
                      </td>
                      <td>
                        {box.capacity - box.active} / {box.capacity}
                      </td>
                      <td>
                        <span className={`badge usage-badge usage-badge--${level}`}>{USAGE_LEVEL_LABELS[level]}</span>
                      </td>
                      <td>
                        <button type="button" className="btn-ghost" onClick={() => onViewBox(box)}>
                          Ver en el refri
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
