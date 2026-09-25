import { useEffect, useState } from "react";
import { api } from "../api/client";
import { MOVEMENT_ACTION_LABELS, SAMPLE_TYPE_LABELS, type MovementRead, type SampleWithLocation } from "../api/types";
import { formatBoolean, formatDate } from "../utils/format";
import { NucleoWarning } from "./NucleoWarning";

export interface SampleDetailProps {
  sample: SampleWithLocation;
  ownerLabel: string;
  onClose: () => void;
  /** Solo se ofrece cuando el detalle se abrió desde una posición ocupada del
   * visor 3D (issue #6): ahí ya se conoce la caja/posición sin otro round-trip. */
  onThaw?: () => void;
}

export function SampleDetail({ sample, ownerLabel, onClose, onThaw }: SampleDetailProps) {
  const [movements, setMovements] = useState<MovementRead[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMovements(null);
    setError(null);
    api
      .getSampleMovements(sample.id)
      .then((data) => {
        if (!cancelled) setMovements(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [sample.id]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2>
            <code>{sample.environ_id ?? `Muestra #${sample.id}`}</code>
          </h2>
          <div style={{ display: "flex", gap: 8 }}>
            {onThaw && sample.status === "active" && (
              <button className="btn-ghost" onClick={onThaw}>
                Descongelar
              </button>
            )}
            <button className="btn-ghost" onClick={onClose} aria-label="Cerrar">
              Cerrar
            </button>
          </div>
        </div>

        <NucleoWarning isCore={sample.is_core} />

        <dl className="detail-grid" style={{ marginTop: 12 }}>
          <div>
            <dt>Descripción / ID Origen</dt>
            <dd>{sample.description ?? "—"}</dd>
          </div>
          <div>
            <dt>Tipo</dt>
            <dd>{SAMPLE_TYPE_LABELS[sample.type]}{sample.type === "otros" && sample.type_other ? ` (${sample.type_other})` : ""}</dd>
          </div>
          <div>
            <dt>Encargado</dt>
            <dd>{ownerLabel}</dd>
          </div>
          <div>
            <dt>Pasaje</dt>
            <dd>{sample.passage ?? "—"}</dd>
          </div>
          <div>
            <dt>Núcleo Environ</dt>
            <dd>{formatBoolean(sample.is_core)}</dd>
          </div>
          <div>
            <dt>Estado</dt>
            <dd>{sample.status === "active" ? "Activa" : "Retirada"}</dd>
          </div>
          <div>
            <dt>Ubicación</dt>
            <dd>{sample.location}</dd>
          </div>
          <div>
            <dt>Registrada</dt>
            <dd>{formatDate(sample.created_at)}</dd>
          </div>
        </dl>

        <h3>Historial de movimientos</h3>
        {error && <p role="alert">No se pudo cargar el historial: {error}</p>}
        {!error && movements === null && <p>Cargando historial…</p>}
        {movements && movements.length === 0 && <p>Sin movimientos registrados.</p>}
        {movements && movements.length > 0 && (
          <ul className="movements-list">
            {movements.map((movement) => (
              <li key={movement.id}>
                <span>
                  <strong>{MOVEMENT_ACTION_LABELS[movement.action]}</strong> · {formatDate(movement.date)} ·{" "}
                  posición {movement.position}
                  {movement.note ? ` · ${movement.note}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
