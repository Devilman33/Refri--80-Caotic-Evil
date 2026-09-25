import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import type { RackRead, SectionRead, UserRead } from "../api/types";
import { useBoxResolution } from "../hooks/useBoxResolution";
import { todayIso } from "../utils/format";
import { parseBoxName, sectionCodeForBox } from "../utils/positions";
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
  const [sections, setSections] = useState<SectionRead[]>([]);
  const [date, setDate] = useState(todayIso);
  const [operatorInitials, setOperatorInitials] = useState(sessionInitials);
  const [boxName, setBoxName] = useState("");
  const [note, setNote] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const destination = useBoxResolution(boxName, racks);
  const sectionCode = useMemo(() => sectionCodeForBox(boxName, racks, sections), [boxName, racks, sections]);
  const destinationBusy = destination.occupied.size > 0;

  useEffect(() => {
    api.listRacks().then(setRacks).catch(() => setRacks([]));
    api.listSections().then(setSections).catch(() => setSections([]));
  }, []);

  function validate(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!date) errors.date = "La fecha es obligatoria";
    if (!operatorInitials) errors.operatorInitials = "El operador es obligatorio";
    const parsed = parseBoxName(boxName);
    if (!boxName.trim()) errors.boxName = "Indica el lugar de destino";
    else if (!parsed) errors.boxName = "Formato inválido: letra de rack + N° de caja (p. ej. B7)";
    else {
      const rack = racks.find((entry) => entry.letter === parsed.rackLetter);
      if (!rack) errors.boxName = `No existe el rack '${parsed.rackLetter}'`;
      else if (parsed.boxNumber > rack.capacity) {
        errors.boxName = `El rack ${rack.letter} tiene lugar para ${rack.capacity} cajas`;
      } else if (destinationBusy) {
        errors.boxName = "En ese lugar ya hay una caja con muestras";
      }
    }
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
        <div className="field">
          <label htmlFor="bm-box">Nuevo lugar (Letra rack y N° de caja)</label>
          <input id="bm-box" value={boxName} onChange={(event) => setBoxName(event.target.value)} placeholder="p. ej. B7" />
          {fieldErrors.boxName && <p className="field-error">{fieldErrors.boxName}</p>}
          {!fieldErrors.boxName && destinationBusy && (
            <p className="field-error">En ese lugar ya hay una caja con muestras.</p>
          )}
        </div>
        <div className="field">
          <label htmlFor="bm-section">Sección</label>
          <input id="bm-section" value={sectionCode ?? ""} readOnly placeholder="Según el rack" />
        </div>
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
