import type { RackOccupancy } from "../api/types";
import { formatPercent, usageLevel } from "../utils/occupancy";
import { UsageBar } from "./OccupancyView";

export interface FreezerUsagePanelProps {
  rack: { sectionCode: string; letter: string; occupancy: RackOccupancy | null } | null;
  /** Subcaja abierta en el visor: el % se calcula con sus luces (ocupadas / total). */
  box: { number: number; occupied: number; total: number } | null;
}

// Panel lateral del visor 3D (issue #7): % de uso del rack y de la subcaja seleccionados.
export function FreezerUsagePanel({ rack, box }: FreezerUsagePanelProps) {
  if (!rack && !box) return null;
  const boxPercent = box && box.total > 0 ? Math.round((box.occupied / box.total) * 10000) / 100 : 0;
  return (
    <aside className="freezer-usage" aria-label="% de uso de la selección">
      {rack && (
        <div className="freezer-usage__row">
          <span>
            Rack {rack.letter} · Sección {rack.sectionCode}
          </span>
          <strong>{rack.occupancy ? formatPercent(rack.occupancy.percent) : "—"}</strong>
          {rack.occupancy && (
            <UsageBar
              percent={rack.occupancy.percent}
              level={usageLevel(rack.occupancy)}
              label={`% de uso del rack ${rack.letter}`}
            />
          )}
        </div>
      )}
      {box && (
        <div className="freezer-usage__row">
          <span>
            Subcaja {box.number} · {box.occupied}/{box.total}
          </span>
          <strong>{formatPercent(boxPercent)}</strong>
          <UsageBar
            percent={boxPercent}
            level={usageLevel({ active: box.occupied, capacity: box.total, percent: boxPercent })}
            label={`% de uso de la subcaja ${box.number}`}
          />
        </div>
      )}
    </aside>
  );
}
