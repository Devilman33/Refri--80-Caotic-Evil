import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { RackRead, UserRead } from "../api/types";
import { useBoxResolution } from "../hooks/useBoxResolution";
import { todayIso } from "../utils/format";
import { parseBoxName } from "../utils/positions";
import { EMPTY_LOCATION, LocationSelect, type LocationValue } from "./LocationSelect";
import { Modal } from "./Modal";
import { UserOptions } from "./UserOptions";

export interface BoxMoveTarget {
  boxId: number;
  /** Nombre legible del lugar actual, p. ej. `I · A3`. */
  label: string;
  /** Muestras activas que se van a trasladar con la caja. */
  active: number;
}

export interface BoxMoveModalProps {
  box: BoxMoveTarget;
  users: UserRead[];
  sessionInitials: string;
  onClose: () => void;
  onMoved: (summary: string) => void;
}

/**
 * Traslada una subcaja entera a otro rack o número. La ubicación de todas sus muestras
 * cambia sola y cada una queda con su evento de traslado en el historial.
 */
export function BoxMoveModal({ box, users, sessionInitials, onClose, onMoved }: BoxMoveModalProps) {
  const [racks, setRacks] = useState<RackRead[]>([]);
  const [date, setDate] = useState(todayIso);
  const [operatorInitials, setOperatorInitials] = useState(sessionInitials);
  const [boxName, setBoxName] = useState("");
  const [location, setLocation] = useState<LocationValue>(EMPTY_LOCATION);
  const [note, setNote] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const destination = useBoxResolution(boxName, racks);
  const destinationBusy = destination.occupied.size > 0;

  useEffect(() => {
    api.listRacks().then(setRacks).catch(() => setRacks([]));
  }, []);

  /** Qué pasa con el destino escrito, en vivo (docs/PLAN_FRONTEND.md, F4): se sabe si está
   * libre antes de confirmar, no después de un error del servidor. */
  function destinationProblem(): string | null {
    const parsed = parseBoxName(boxName);
    if (!boxName.trim()) return "Indica el lugar de destino";
    if (!parsed) return "Formato inválido: letra de rack + N° de caja (p. ej. B7)";
    const rack = racks.find((entry) => entry.letter === parsed.rackLetter);
    if (!rack) return `No existe el rack '${parsed.rackLetter}'`;
    if (parsed.boxNumber > rack.capacity) return `El rack ${rack.letter} tiene lugar para ${rack.capacity} cajas`;
    if (destinationBusy) return `En ${parsed.rackLetter}${parsed.boxNumber} ya hay una caja con ${destination.occupied.size} muestras`;
    return null;
  }

  // Mientras se escribe no se reclama el formato: "B" es el comienzo de "B7", no un error.
  const typed = boxName.trim();
  const liveProblem = typed.length >= 2 && racks.length > 0 ? destinationProblem() : null;
  const liveOk =
    typed.length >= 2 && racks.length > 0 && !liveProblem
      ? `${typed.toUpperCase()} está libre${destination.boxExists ? " (hay una caja registrada, vacía)" : ""}.`
      : null;

  function validate(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!date) errors.date = "La fecha es obligatoria";
    if (!operatorInitials) errors.operatorInitials = "El operador es obligatorio";
    const problem = destinationProblem();
    if (problem) errors.boxName = problem;
    return errors;
  }

  async function submit() {
    const errors = validate();
    setFieldErrors(errors);
    setSubmitError(null);
    if (Object.keys(errors).length > 0) return;

    const parsed = parseBoxName(boxName)!;
    setSaving(true);
    try {
      const result = await api.moveBox(box.boxId, {
        date,
        operator_initials: operatorInitials,
        rack_letter: parsed.rackLetter,
        box_number: parsed.boxNumber,
        note: note.trim() || null,
      });
      const plural = result.moved === 1 ? "muestra" : "muestras";
      onMoved(`Caja trasladada: ${result.from_label} → ${result.to_label} (${result.moved} ${plural}).`);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "No se pudo trasladar la caja");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal titleId="bm-title" onClose={onClose}>
      <div className="modal-header">
        <h2 id="bm-title" tabIndex={-1}>
          Mover caja
        </h2>
        <button className="btn-ghost" onClick={onClose} aria-label="Cerrar">
          Cerrar
        </button>
      </div>
      <p className="field-hint">
        Desde <strong>{box.label}</strong>, con sus {box.active} muestras activas. Todas cambian de ubicación y
        mantienen su posición dentro de la caja.
      </p>

      <form
        className="movement-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="field">
          <label htmlFor="bm-date">Fecha</label>
          <input id="bm-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          {fieldErrors.date && <p className="field-error">{fieldErrors.date}</p>}
        </div>
        <div className="field">
          <label htmlFor="bm-operator">Operador (a)</label>
          <select id="bm-operator" value={operatorInitials} onChange={(event) => setOperatorInitials(event.target.value)}>
            <UserOptions users={users} />
          </select>
          {fieldErrors.operatorInitials && <p className="field-error">{fieldErrors.operatorInitials}</p>}
        </div>
        {/* Nuevo lugar como listas (parte 3): solo lugares sin muestras. */}
        <LocationSelect
          idPrefix="bm"
          mode="empty-place"
          value={location}
          excludeBoxId={box.boxId}
          onChange={(next, resolved) => {
            setLocation(next);
            setBoxName(resolved ? `${resolved.rackLetter}${resolved.boxNumber}` : "");
            setFieldErrors((current) => ({ ...current, boxName: "" }));
          }}
        />
        <p
          id="bm-box-status"
          role="status"
          className={`field--full ${fieldErrors.boxName || liveProblem ? "field-error" : "field-notice"}`}
        >
          {fieldErrors.boxName || liveProblem || liveOk}
        </p>
        <div className="field field--full">
          <label htmlFor="bm-note">Motivo (opcional)</label>
          <input id="bm-note" value={note} maxLength={255} onChange={(event) => setNote(event.target.value)} />
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
            {saving ? "Moviendo…" : "Mover caja"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
