import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { AlertsRead } from "../api/types";
import type { BoxFilter } from "../utils/occupancy";

export type AlertDestination =
  | { kind: "unassigned" }
  | { kind: "boxes"; filter: BoxFilter }
  | { kind: "anomalies" };

export interface AlertsPanelProps {
  /** Se incrementa cuando algo pudo cambiar (un movimiento, una edición) para refrescar. */
  reloadToken: number;
  onNavigate: (destination: AlertDestination) => void;
  onCountChange: (total: number) => void;
}

/** Anomalías pendientes de la última importación. Es una fila más del panel y no una
 * pestaña: corregir datos del Excel es la misma clase de tarea que asignar un encargado. */
function useAnomalyCount(reloadToken: number): number {
  const [pending, setPending] = useState(0);
  useEffect(() => {
    let cancelled = false;
    api
      .listImportRuns()
      .then(async (runs) => {
        if (cancelled || runs.length === 0) return;
        const groups = await api.listAnomalyGroups(runs[0].id);
        if (!cancelled) setPending(groups.reduce((total, group) => total + group.pending, 0));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);
  return pending;
}

interface Row {
  key: string;
  label: (count: number) => string;
  count: (alerts: AlertsRead) => number;
  destination: AlertDestination;
}

// Cada fila lleva a un destino DISTINTO. Ese es el punto del bloque: con un solo estado
// "destacadas", dos de estos contadores caerían en la misma pantalla y alguno sería un
// número sobre el que nadie puede actuar.
const ROWS: Row[] = [
  {
    key: "unassigned",
    label: (count) => `${count} ${count === 1 ? "muestra sin encargado" : "muestras sin encargado"}`,
    count: (alerts) => alerts.unassigned_samples,
    destination: { kind: "unassigned" },
  },
  {
    key: "inconsistent",
    label: (count) => `${count} ${count === 1 ? "caja llena con huecos" : "cajas llenas con huecos"}`,
    count: (alerts) => alerts.inconsistent_full_boxes,
    destination: { kind: "boxes", filter: "inconsistent" },
  },
  {
    key: "near-full",
    label: (count) => `${count} ${count === 1 ? "subcaja casi llena" : "subcajas casi llenas"}`,
    count: (alerts) => alerts.nearly_full_boxes,
    destination: { kind: "boxes", filter: "near-full" },
  },
  {
    key: "full",
    label: (count) => `${count} ${count === 1 ? "subcaja llena" : "subcajas llenas"}`,
    count: (alerts) => alerts.full_boxes,
    destination: { kind: "boxes", filter: "full" },
  },
];

export function AlertsPanel({ reloadToken, onNavigate, onCountChange }: AlertsPanelProps) {
  const [alerts, setAlerts] = useState<AlertsRead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingAnomalies = useAnomalyCount(reloadToken);

  useEffect(() => {
    let cancelled = false;
    api
      .getAlerts()
      .then((data) => {
        if (cancelled) return;
        setAlerts(data);
        setError(null);
        onCountChange(
          data.unassigned_samples + data.nearly_full_boxes + data.full_boxes + data.inconsistent_full_boxes,
        );
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "No se pudieron cargar las alertas");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken, onCountChange]);

  if (error) {
    return (
      <div className="alerts-empty" role="alert">
        {error}
      </div>
    );
  }
  if (!alerts) return <div className="alerts-empty">Revisando…</div>;

  const visible = ROWS.filter((row) => row.count(alerts) > 0);
  const extra: { key: string; label: string; destination: AlertDestination; count: number }[] =
    pendingAnomalies > 0
      ? [
          {
            key: "anomalies",
            label: `${pendingAnomalies} ${pendingAnomalies === 1 ? "anomalía sin revisar" : "anomalías sin revisar"}`,
            destination: { kind: "anomalies" },
            count: pendingAnomalies,
          },
        ]
      : [];

  // El estado vacío es una feature: "nada que revisar" es información que el laboratorio
  // quiere, no un placeholder. Cuatro ceros en fila no dicen lo mismo.
  if (visible.length === 0 && extra.length === 0) {
    return <div className="alerts-empty">Nada que revisar. El inventario está consistente.</div>;
  }

  return (
    <div className="alerts-panel">
      {visible.map((row) => {
        const count = row.count(alerts);
        return (
          <button key={row.key} type="button" onClick={() => onNavigate(row.destination)}>
            <span>{row.label(count)}</span>
            <span className="badge badge-warn">{count}</span>
          </button>
        );
      })}
      {extra.map((row) => (
        <button key={row.key} type="button" onClick={() => onNavigate(row.destination)}>
          <span>{row.label}</span>
          <span className="badge badge-warn">{row.count}</span>
        </button>
      ))}
    </div>
  );
}
