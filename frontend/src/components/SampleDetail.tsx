import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { api } from "../api/client";
import {
  MOVEMENT_ACTION_LABELS,
  SAMPLE_TYPE_LABELS,
  type MovementRead,
  type SampleWithLocation,
  type UserRead,
} from "../api/types";
import { formatBoolean, formatDate } from "../utils/format";
import { ownersLabel, ownersOf } from "../utils/users";
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
  /** Devolver al refri una muestra retirada (parte 3). */
  onReturn?: () => void;
  /** Solo fuera del visor 3D: vuelve al 3D con esta posición resaltada. */
  onViewInFreezer?: () => void;
}

/**
 * Detalle de una muestra como PANEL, no modal (docs/PLAN_FRONTEND.md, D2): mirar una
 * muestra no escribe nada, y un modal tapaba el 3D justo cuando se quería ver dónde está.
 * En el 3D va arriba del panel derecho; en la tabla, a la derecha en PC y como hoja
 * inferior en tablet (lo decide el CSS de `.detail-panel`).
 */
export function SampleDetail({
  sample,
  users,
  canModify,
  onClose,
  onThaw,
  onEdit,
  onMove,
  onReturn,
  onViewInFreezer,
}: SampleDetailProps) {
  const titleRef = useRef<HTMLHeadingElement | null>(null);
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
  const owners = ownersOf(sample, users);

  // Al elegir otra muestra, el foco va a su título: quien navega con teclado o lector de
  // pantalla se entera de que el panel cambió.
  useEffect(() => {
    titleRef.current?.focus();
  }, [sample.id]);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    onClose();
  }
  // El congelamiento que la trajo al freezer (el primero) y el retiro, si lo hubo.
  const frozen = movements?.find((movement) => movement.action === "freeze");
  const thawed = movements ? [...movements].reverse().find((movement) => movement.action === "thaw") : undefined;

  function operatorLabel(movement: MovementRead): string {
    if (movement.operator_id === null) return "importado del Excel";
    const operator = usersById.get(movement.operator_id);
    return operator ? userOptionLabel(operator) : (movement.operator_initials ?? "—");
  }

  return (
    <aside className="detail-panel" aria-labelledby="sd-title" onKeyDown={handleKeyDown}>
      <div className="detail-panel__header">
        <div>
          <p className="eyebrow">Muestra seleccionada</p>
          <h2 id="sd-title" ref={titleRef} tabIndex={-1} className="detail-panel__id">
            {sample.environ_id ?? `Muestra #${sample.id}`}
          </h2>
          <p className="detail-panel__loc">{sample.location}</p>
        </div>
        <button className="btn-ghost" onClick={onClose} aria-label="Cerrar detalle">
          Cerrar
        </button>
      </div>

      <NucleoWarning isCore={sample.is_core} />

      <dl className="detail-grid">
        <div>
          <dt>{owners.length > 1 ? "Encargados" : "Encargado"}</dt>
          <dd>{owners.length > 0 ? owners.map(userOptionLabel).join(", ") : "—"}</dd>
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
        {/* La ubicación ya está en el encabezado de la ficha: no se repite acá. */}
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
        <div className="detail-panel__actions">
          <p className="field-hint">Muestra retirada: queda en el historial.</p>
          {onReturn && (
            <button className="btn" onClick={onReturn}>
              Devolver al refri
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="detail-panel__actions">
            {/* Retirar lo puede hacer cualquiera (parte 3); mover y editar, sus encargados. */}
            {onThaw && (
              <button className="btn" onClick={onThaw}>
                Descongelar
              </button>
            )}
            {canModify && onMove && (
              <button className="btn-ghost" onClick={onMove}>
                Mover
              </button>
            )}
            {canModify && onEdit && (
              <button className="btn-ghost" onClick={onEdit}>
                Editar
              </button>
            )}
          </div>
          {!canModify && (
            <p className="field-hint">
              {owners.length > 1
                ? `Mover o editar: solo sus encargados (${ownersLabel(owners)}).`
                : `Mover o editar: solo ${ownersLabel(owners)}, su encargado.`}
            </p>
          )}
        </>
      )}

      {onViewInFreezer && (
        <button className="btn-ghost detail-panel__locate" onClick={onViewInFreezer}>
          Ver en el refri
        </button>
      )}

      <h3 className="detail-panel__h3">Historial de movimientos</h3>
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
    </aside>
  );
}
