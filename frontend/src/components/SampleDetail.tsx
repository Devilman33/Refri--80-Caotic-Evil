import { useEffect, useState } from "react";
import { api } from "../api/client";
import { MOVEMENT_ACTION_LABELS, SAMPLE_TYPE_LABELS, type MovementRead, type SampleWithLocation } from "../api/types";
import { formatBoolean, formatDate } from "../utils/format";
import { Modal } from "./Modal";
import { NucleoWarning } from "./NucleoWarning";

export interface SampleDetailProps {
  sample: SampleWithLocation;
  ownerLabel: string;
  onClose: () => void;
  /** Solo se ofrece cuando el detalle se abrió desde una posición ocupada del
   * visor 3D (issue #6): ahí ya se conoce la caja/posición sin otro round-trip. */
  onThaw?: () => void;
  /** Corregir los datos descriptivos. Es lo que hace accionable la alerta de muestras
   * sin encargado: sin esto, la alerta avisa de algo que la web no deja arreglar. */
  onEdit?: () => void;
  /** Trasladar la muestra. Abre su propio diálogo y CIERRA este: dos `.modal-backdrop`
   * apilados doblan el oscurecido y vuelven ambiguo a cuál de los dos cierra un clic. */
  onMove?: () => void;
}

export function SampleDetail({ sample, ownerLabel, onClose, onThaw, onEdit, onMove }: SampleDetailProps) {
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
    <Modal titleId="sd-title" onClose={onClose}>
        <div className="modal-header">
          <h2 id="sd-title" tabIndex={-1}>
            <code>{sample.environ_id ?? `Muestra #${sample.id}`}</code>
          </h2>
          <button className="btn-ghost" onClick={onClose} aria-label="Cerrar">
            Cerrar
          </button>
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

        {sample.status === "active" ? (
          <div className="form-actions" style={{ marginTop: 12 }}>
            {onMove && (
              <button className="btn" onClick={onMove}>
                Mover
              </button>
            )}
            {onEdit && (
              <button className="btn-ghost" onClick={onEdit}>
                Editar
              </button>
            )}
            {onThaw && (
              <button className="btn-ghost" onClick={onThaw}>
                Descongelar
              </button>
            )}
          </div>
        ) : (
          <p className="field-hint" style={{ marginTop: 12 }}>
            Muestra retirada: queda en el historial y no se puede modificar desde acá.
          </p>
        )}

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
                  {/* En un traslado se muestra de dónde a dónde; en los demás, solo dónde
                      ocurrió. El origen viene en la misma fila del evento. */}
                  {movement.from_location
                    ? `${movement.from_location} → ${movement.location ?? movement.position}`
                    : `posición ${movement.position}`}{" "}
                  · {movement.operator_initials ?? "importado"}
                  {movement.note ? ` · ${movement.note}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
    </Modal>
  );
}
