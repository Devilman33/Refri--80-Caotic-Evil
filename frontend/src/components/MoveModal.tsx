import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { PositionConflict, RackRead, SampleWithLocation, UserRead } from "../api/types";
import { useBoxResolution } from "../hooks/useBoxResolution";
import { todayIso } from "../utils/format";
import { parseBoxName } from "../utils/positions";
import { EMPTY_LOCATION, LocationSelect, type LocationValue } from "./LocationSelect";
import { Modal } from "./Modal";
import { PositionPicker } from "./PositionPicker";
import { UserOptions } from "./UserOptions";

export interface MoveModalProps {
  sample: SampleWithLocation;
  users: UserRead[];
  /** Iniciales de la persona de la sesión: prellenan el Operador. */
  sessionInitials: string;
  onClose: () => void;
  onMoved: (sample: SampleWithLocation, summary: string) => void;
}

/**
 * Traslada una muestra a otra caja o posición.
 *
 * Presenta los mismos tres controles y en el mismo orden que el formulario de movimientos
 * (Sección, Nombre Caja, grilla), para que elegir una ubicación se vea igual en toda la
 * app. La lógica de resolver la caja es `useBoxResolution`, compartida con ese formulario.
 */
export function MoveModal({ sample, users, sessionInitials, onClose, onMoved }: MoveModalProps) {
  const [racks, setRacks] = useState<RackRead[]>([]);
  const [boxName, setBoxName] = useState("");
  const [location, setLocation] = useState<LocationValue>(EMPTY_LOCATION);
  const [position, setPosition] = useState("");
  const [operatorInitials, setOperatorInitials] = useState(sessionInitials);
  const [date, setDate] = useState(todayIso);
  const [note, setNote] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<PositionConflict | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const box = useBoxResolution(boxName, racks);
  // Sin una caja de destino válida la grilla mostraba 81 posiciones "libres" que no eran de
  // ninguna caja: se deshabilita hasta saber cuál es.
  const parsedDestination = parseBoxName(boxName);
  const destinationReady =
    parsedDestination !== null && racks.some((rack) => rack.letter === parsedDestination.rackLetter);

  useEffect(() => {
    api.listRacks().then(setRacks).catch(() => setRacks([]));
  }, []);

  function validate(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!date) errors.date = "La fecha es obligatoria";
    if (!operatorInitials.trim()) errors.operatorInitials = "El operador es obligatorio";

    const parsed = parseBoxName(boxName);
    if (!boxName.trim()) {
      errors.boxName = "Elige la sección, el rack y la caja de destino";
    } else if (!parsed) {
      errors.boxName = "Formato inválido: letra de rack + N° de caja (p. ej. A12)";
    } else {
      const rack = racks.find((entry) => entry.letter === parsed.rackLetter);
      if (!rack) errors.boxName = `No existe el rack '${parsed.rackLetter}'`;
    }
    if (!position) errors.position = "Elegí la posición de destino";
    return errors;
  }

  async function submit() {
    const errors = validate();
    setFieldErrors(errors);
    setConflict(null);
    setSubmitError(null);
    if (Object.keys(errors).length > 0) return;

    const parsed = parseBoxName(boxName)!;
    setSaving(true);
    try {
      const result = await api.moveSample(sample.id, {
        date,
        operator_initials: operatorInitials.trim().toUpperCase(),
        rack_letter: parsed.rackLetter,
        box_number: parsed.boxNumber,
        position,
        note: note.trim() || null,
      });
      // El momento que importa: decir de dónde a dónde se movió. Sin esto el operador
      // cierra un diálogo y ve una tabla que se refrescó sola, sin confirmación de nada.
      onMoved(result.sample, `Movida: ${sample.location} → ${result.sample.location}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.detail && typeof err.detail === "object") {
        const detail = err.detail as PositionConflict;
        setConflict(detail);
        setFieldErrors((current) => ({ ...current, position: detail.message }));
      } else {
        setSubmitError(err instanceof ApiError ? err.message : "No se pudo mover la muestra");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal titleId="mv-title" onClose={onClose} wide>
      <div className="modal-header">
        <h2 id="mv-title" tabIndex={-1}>
          Mover muestra
        </h2>
        <button className="btn-ghost" onClick={onClose} aria-label="Cerrar">
          Cerrar
        </button>
      </div>

      <p className="field-hint">
        Desde <strong>{sample.location}</strong>
        {sample.environ_id ? ` · ${sample.environ_id}` : ""}
      </p>

      <form
        className="movement-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="field">
          <label htmlFor="mv-date">Fecha</label>
          <input id="mv-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          {fieldErrors.date && <p className="field-error">{fieldErrors.date}</p>}
        </div>

        <div className="field">
          <label htmlFor="mv-operator">Operador (a)</label>
          <select
            id="mv-operator"
            value={operatorInitials}
            onChange={(event) => setOperatorInitials(event.target.value)}
          >
            <UserOptions users={users} />
          </select>
          {fieldErrors.operatorInitials && <p className="field-error">{fieldErrors.operatorInitials}</p>}
        </div>

        {/* Destino como listas (parte 3): solo cajas con espacio o lugares sin caja. */}
        <LocationSelect
          idPrefix="mv"
          mode="with-space"
          value={location}
          onChange={(next, resolved) => {
            setLocation(next);
            setBoxName(resolved ? `${resolved.rackLetter}${resolved.boxNumber}` : "");
            setPosition("");
          }}
        />
        <div className="field">
          {fieldErrors.boxName && <p className="field-error">{fieldErrors.boxName}</p>}
          {!fieldErrors.boxName && boxName.trim() !== "" && (
            <p className="field-hint">
              {box.boxExists ? "Caja existente: se muestran sus posiciones." : "Caja nueva: se creará al mover."}
            </p>
          )}
        </div>

        <div className="field field--full">
          <label>Posición de destino</label>
          {!destinationReady && <p className="field-hint">Elige la caja de destino para ver sus posiciones.</p>}
          <PositionPicker
            boxType={box.boxType}
            occupied={box.occupied}
            occupantLabels={box.occupantLabels}
            corePositions={box.corePositions}
            value={position}
            onChange={setPosition}
            disabled={saving || !destinationReady}
          />
          {fieldErrors.position && <p className="field-error">{fieldErrors.position}</p>}
          {conflict?.next_free_position && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setPosition(conflict.next_free_position!);
                setConflict(null);
                setFieldErrors((current) => ({ ...current, position: "" }));
              }}
            >
              Usar siguiente libre ({conflict.next_free_position})
            </button>
          )}
        </div>

        <div className="field field--full">
          <label htmlFor="mv-note">Motivo (opcional)</label>
          <input id="mv-note" value={note} onChange={(event) => setNote(event.target.value)} />
        </div>

        {submitError && (
          <p className="field-error field--full" role="alert">
            {submitError}
          </p>
        )}

        <div className="form-actions field--full">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? "Moviendo…" : "Mover"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
