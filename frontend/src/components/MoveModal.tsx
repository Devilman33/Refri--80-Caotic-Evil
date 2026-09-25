import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { PositionConflict, RackRead, SampleWithLocation, SectionRead, UserRead } from "../api/types";
import { useBoxResolution } from "../hooks/useBoxResolution";
import { parseBoxName } from "../utils/positions";
import { Modal } from "./Modal";
import { PositionPicker } from "./PositionPicker";

const LAST_OPERATOR_KEY = "refri:ultimo-operador";

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export interface MoveModalProps {
  sample: SampleWithLocation;
  users: UserRead[];
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
export function MoveModal({ sample, users, onClose, onMoved }: MoveModalProps) {
  const [racks, setRacks] = useState<RackRead[]>([]);
  const [sections, setSections] = useState<SectionRead[]>([]);
  const [sectionCode, setSectionCode] = useState("");
  const [boxName, setBoxName] = useState("");
  const [position, setPosition] = useState("");
  const [operatorInitials, setOperatorInitials] = useState(
    () => localStorage.getItem(LAST_OPERATOR_KEY) ?? "",
  );
  const [date, setDate] = useState(todayIso);
  const [note, setNote] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<PositionConflict | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const box = useBoxResolution(boxName, racks);

  useEffect(() => {
    api.listRacks().then(setRacks).catch(() => setRacks([]));
    api.listSections().then(setSections).catch(() => setSections([]));
  }, []);

  function validate(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!date) errors.date = "La fecha es obligatoria";
    if (!operatorInitials.trim()) errors.operatorInitials = "El operador es obligatorio";
    if (!sectionCode) errors.sectionCode = "La sección es obligatoria";

    const parsed = parseBoxName(boxName);
    if (!boxName.trim()) {
      errors.boxName = "El nombre de la caja es obligatorio";
    } else if (!parsed) {
      errors.boxName = "Formato inválido: letra de rack + N° de caja (p. ej. A12)";
    } else {
      const rack = racks.find((entry) => entry.letter === parsed.rackLetter);
      if (!rack) {
        errors.boxName = `No existe el rack '${parsed.rackLetter}'`;
      } else if (sectionCode) {
        const rackSection = sections.find((section) => section.id === rack.section_id)?.code;
        if (rackSection && rackSection !== sectionCode) {
          errors.sectionCode = `El rack '${rack.letter}' pertenece a la sección ${rackSection}, no a ${sectionCode}`;
        }
      }
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
      localStorage.setItem(LAST_OPERATOR_KEY, operatorInitials.trim().toUpperCase());
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
            <option value="">Selecciona…</option>
            {users.map((user) => (
              <option key={user.id} value={user.initials}>
                {user.initials}
              </option>
            ))}
          </select>
          {fieldErrors.operatorInitials && <p className="field-error">{fieldErrors.operatorInitials}</p>}
        </div>

        <div className="field">
          <label htmlFor="mv-section">Sección</label>
          <select id="mv-section" value={sectionCode} onChange={(event) => setSectionCode(event.target.value)}>
            <option value="">Selecciona…</option>
            {sections.map((section) => (
              <option key={section.id} value={section.code}>
                {section.code}
              </option>
            ))}
          </select>
          {fieldErrors.sectionCode && <p className="field-error">{fieldErrors.sectionCode}</p>}
        </div>

        <div className="field">
          <label htmlFor="mv-box">Nombre Caja (Letra rack y N° de caja)</label>
          <input
            id="mv-box"
            value={boxName}
            onChange={(event) => {
              setBoxName(event.target.value);
              setPosition("");
            }}
            placeholder="p. ej. A12"
          />
          {fieldErrors.boxName && <p className="field-error">{fieldErrors.boxName}</p>}
          {!fieldErrors.boxName && boxName.trim() !== "" && (
            <p className="field-hint">
              {box.boxExists ? "Caja existente: se muestran sus posiciones." : "Caja nueva: se creará al mover."}
            </p>
          )}
        </div>

        <div className="field field--full">
          <label>Posición de destino</label>
          <PositionPicker
            boxType={box.boxType}
            occupied={box.occupied}
            occupantLabels={box.occupantLabels}
            corePositions={box.corePositions}
            value={position}
            onChange={setPosition}
            disabled={saving}
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
