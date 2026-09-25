import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { AnomalyGroup, ImportRunRead } from "../api/types";
import { formatDate } from "../utils/format";

export interface AnomaliesViewProps {
  /** Vuelve al panel de alertas, desde donde se llega acá. */
  onBack: () => void;
  /** Iniciales de quien está operando, para firmar las correcciones. */
  operatorInitials: string;
}

/**
 * Anomalías de las importaciones, agrupadas por motivo.
 *
 * El agrupado es la vista por defecto y no un extra: una lista plana de varios miles de
 * filas es una hoja de cálculo en una página web. "1.412 filas con fecha fuera de rango"
 * es una decisión que alguien toma en un minuto; "página 1 de 37" no es nada.
 */
export function AnomaliesView({ onBack, operatorInitials }: AnomaliesViewProps) {
  const [runs, setRuns] = useState<ImportRunRead[] | null>(null);
  const [runId, setRunId] = useState<number | null>(null);
  const [groups, setGroups] = useState<AnomalyGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api
      .listImportRuns()
      .then((loaded) => {
        setRuns(loaded);
        setRunId((current) => current ?? loaded[0]?.id ?? null);
      })
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : "No se pudieron cargar las importaciones"),
      );
  }, []);

  const loadGroups = useCallback(() => {
    if (runId === null) return;
    api
      .listAnomalyGroups(runId)
      .then(setGroups)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : "No se pudieron cargar las anomalías"),
      );
  }, [runId]);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  async function resolveGroup(group: AnomalyGroup) {
    if (runId === null) return;
    setBusy(group.reason + group.column);
    try {
      await api.resolveAnomalies(runId, {
        operator_initials: operatorInitials,
        reason: group.reason,
        column: group.column,
        status: "resolved",
      });
      loadGroups();
      const updated = await api.listImportRuns();
      setRuns(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo marcar el grupo");
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return (
      <div className="empty-state" role="alert">
        {error}
      </div>
    );
  }
  if (!runs) return <div className="empty-state">Cargando anomalías…</div>;

  // Estado de primera corrida: con datos reales sin cargar todavía, esta es la primera
  // impresión. "No hay datos" no dice qué hacer.
  if (runs.length === 0) {
    return (
      <div className="occupancy-view">
        <button type="button" className="btn-ghost" onClick={onBack}>
          ← Alertas
        </button>
        <div className="empty-state">
          Todavía no se importó ningún archivo. Cuando corras el importador, acá aparecen las
          filas que no pudo interpretar.
        </div>
      </div>
    );
  }

  const run = runs.find((entry) => entry.id === runId) ?? runs[0];

  return (
    <div className="occupancy-view">
      <div className="filters-actions">
        <button type="button" className="btn-ghost" onClick={onBack}>
          ← Alertas
        </button>
        <div className="field" style={{ minWidth: 260 }}>
          <label htmlFor="an-run">Importación</label>
          <select id="an-run" value={run.id} onChange={(event) => setRunId(Number(event.target.value))}>
            {runs.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.source_name} · {formatDate(entry.started_at)} · {entry.anomalies_count} anomalías
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Los contadores de la corrida: dos importaciones seguidas responden "¿mejoró el
          Excel desde la última vez?", que es la métrica que a este proyecto le importa. */}
      <section className="usage-card" aria-label="Resumen de la importación">
        <div className="usage-card__head">
          <h2>{run.source_name}</h2>
          <strong>{formatDate(run.started_at)}</strong>
        </div>
        <div className="fv-stats">
          <div>
            <b>{run.total_rows.toLocaleString("es-CL")}</b> filas leídas
          </div>
          <div>
            <b>{run.imported.toLocaleString("es-CL")}</b> importadas
          </div>
          <div>
            <b>{run.withdrawn.toLocaleString("es-CL")}</b> retiradas
          </div>
          <div>
            <b>{run.skipped_invalid.toLocaleString("es-CL")}</b> inválidas
          </div>
          <div>
            <b>{run.anomalies_count.toLocaleString("es-CL")}</b> anomalías
          </div>
        </div>
      </section>

      <section className="usage-card" aria-label="Anomalías por motivo">
        <h3>Por motivo</h3>
        {groups === null && <p className="empty-state">Cargando…</p>}
        {groups !== null && groups.length === 0 && (
          <p className="empty-state">Esta importación no dejó anomalías.</p>
        )}
        {groups !== null && groups.length > 0 && (
          <div className="table-wrap">
            <table className="samples-table usage-table">
              <thead>
                <tr>
                  <th>Motivo</th>
                  <th>Columna</th>
                  <th>Filas</th>
                  <th>Pendientes</th>
                  <th>
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <tr key={group.reason + group.column}>
                    <td>
                      <strong>{group.reason}</strong>
                    </td>
                    <td>{group.column}</td>
                    <td>{group.total.toLocaleString("es-CL")}</td>
                    <td>
                      {group.pending === 0 ? (
                        <span className="badge badge-active">Al día</span>
                      ) : (
                        <span className="badge badge-warn">{group.pending.toLocaleString("es-CL")}</span>
                      )}
                    </td>
                    <td>
                      {group.pending > 0 && (
                        <button
                          type="button"
                          className="btn-ghost"
                          disabled={busy !== null || !operatorInitials}
                          title={!operatorInitials ? "Elegí quién sos en el encabezado" : undefined}
                          onClick={() => void resolveGroup(group)}
                        >
                          {busy === group.reason + group.column
                            ? "Marcando…"
                            : `Marcar ${group.pending} como corregidas`}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
