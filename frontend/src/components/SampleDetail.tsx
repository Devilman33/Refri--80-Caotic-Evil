import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import {
  MOVEMENT_ACTION_LABELS,
  SAMPLE_TYPE_LABELS,
  type MovementRead,
  type SampleWithLocation,
  type UserRead,
} from "../api/types";
import { formatBoolean, formatDate } from "../utils/format";
import { userLabel } from "../utils/users";
import { Modal } from "./Modal";
import { NucleoWarning } from "./NucleoWarning";
import { userOptionLabel } from "./UserOptions";

export interface SampleDetailProps {
  sample: SampleWithLocation;
  users: UserRead[];
  /** Si la persona de la sesión puede modificarla: solo su encargado (ADR 0002). */
  canModify: boolean;
  onClose: () => void;
  /** Abre el formulario de descongelamiento con la ubicación de esta muestra. */
  onThaw?: () => void;
  /** Corregir los datos descriptivos. Es lo que hace accionable la alerta de muestras
   * sin encargado: sin esto, la alerta avisa de algo que la web no deja arreglar. */
  onEdit?: () => void;
  /** Trasladar la muestra. Abre su propio diálogo y CIERRA este: dos `.modal-backdrop`
   * apilados doblan el oscurecido y vuelven ambiguo a cuál de los dos cierra un clic. */
  onMove?: () => void;
}

/** `III · F12 · 3B` → sus tres partes, para mostrarlas por separado. */
function splitLocation(location: string): { section: string; box: string; position: string } | null {
  const parts = location.split(" · ");
  return parts.length === 3 ? { section: parts[0], box: parts[1], position: parts[2] } : null;
}

export function SampleDetail({ sample, users, canModify, onClose, onThaw, onEdit, onMove }: SampleDetailProps) {
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

  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const owner = usersById.get(sample.owner_id);
  const location = splitLocation(sample.location);
  // El congelamiento que la trajo al freezer (el primero) y el retiro, si lo hubo.
  const frozen = movements?.find((movement) => movement.action === "freeze");
  const thawed = movements ? [...movements].reverse().find((movement) => movement.action === "thaw") : undefined;

  function operatorLabel(movement: MovementRead): string {
    if (movement.operator_id === null) return "importado del Excel";
    const operator = usersById.get(movement.operator_id);
    return operator ? userOptionLabel(operator) : (movement.operator_initials ?? "—");
  }

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
          <dt>Encargado</dt>
          <dd>{owner ? userOptionLabel(owner) : "—"}</dd>
        </div>
        <div>
          <dt>Estado</dt>
          <dd>{sample.status === "active" ? "Activa" : "Retirada"}</dd>
        </div>
        <div>
          <dt>Descripción / ID Origen</dt>
          <dd>{sample.description ?? "—"}</dd>
        </div>
        <div>
          <dt>Tipo</dt>
          <dd>
            {SAMPLE_TYPE_LABELS[sample.type]}
            {sample.type === "otros" && sample.type_other ? ` (${sample.type_other})` : ""}
          </dd>
        </div>
        <div>
          <dt>Pasaje</dt>
          <dd>{sample.passage ?? "—"}</dd>
        </div>
        <div>
          <dt>Núcleo Environ</dt>
          <dd>{formatBoolean(sample.is_core)}</dd>
        </div>
        {location ? (
          <>
            <div>
              <dt>Sección</dt>
              <dd>{location.section}</dd>
            </div>
            <div>
              <dt>Caja</dt>
              <dd>{location.box}</dd>
            </div>
            <div>
              <dt>Posición</dt>
              <dd>{location.position}</dd>
            </div>
          </>
        ) : (
          <div>
            <dt>Ubicación</dt>
            <dd>{sample.location}</dd>
          </div>
        )}
        <div>
          <dt>Fecha de congelamiento</dt>
          <dd>{frozen ? formatDate(frozen.date) : movements ? "—" : "…"}</dd>
        </div>
        <div>
          <dt>Congelada por</dt>
          <dd>{frozen ? operatorLabel(frozen) : movements ? "—" : "…"}</dd>
        </div>
        {sample.status === "withdrawn" && thawed && (
          <>
            <div>
              <dt>Retirada el</dt>
              <dd>{formatDate(thawed.date)}</dd>
            </div>
            <div>
              <dt>Retirada por</dt>
              <dd>{operatorLabel(thawed)}</dd>
            </div>
            <div>
              <dt>Motivo del retiro</dt>
              <dd>{thawed.note ?? "—"}</dd>
            </div>
          </>
        )}
        {sample.notes && (
          <div>
            <dt>Comentarios</dt>
            <dd>{sample.notes}</dd>
          </div>
        )}
      </dl>

      {sample.status !== "active" ? (
        <p className="field-hint" style={{ marginTop: 12 }}>
          Muestra retirada: queda en el historial y no se puede modificar.
        </p>
      ) : canModify ? (
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
            <button className="btn-ghost btn-ghost--danger" onClick={onThaw}>
              Descongelar
            </button>
          )}
        </div>
      ) : (
        <p className="field-hint" style={{ marginTop: 12 }}>
          Solo {userLabel(owner)}, su encargado, puede moverla, editarla o descongelarla.
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
                · {operatorLabel(movement)}
                {movement.note ? ` · ${movement.note}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
