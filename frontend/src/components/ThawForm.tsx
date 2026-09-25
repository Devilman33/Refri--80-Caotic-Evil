import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import {
  SAMPLE_TYPE_LABELS,
  type MovementResult,
  type RackRead,
  type SampleWithLocation,
  type SectionRead,
  type UserRead,
} from "../api/types";
import { useBoxResolution } from "../hooks/useBoxResolution";
import { formatBoolean, todayIso } from "../utils/format";
import { parseBoxName, sectionCodeForBox } from "../utils/positions";
import { canModifySample, ownersLabel, ownersOf } from "../utils/users";
import type { LocationPrefill } from "./FreezeForm";
import { Modal } from "./Modal";
import { NucleoWarning } from "./NucleoWarning";
import { PositionPicker } from "./PositionPicker";
import { UserOptions } from "./UserOptions";

export interface ThawFormProps {
  users: UserRead[];
  sessionUser: UserRead;
  initial?: LocationPrefill;
  onClose: () => void;
  onSubmitted: (result: MovementResult) => void;
}

/**
 * Descongelamiento (retiro). Es un formulario aparte del de congelamiento a pedido del
 * laboratorio: compartían pantalla y se confundían.
 *
 * Se editan solo los datos del retiro (fecha, operador, dónde y motivo). El resto de los
 * campos del Google Form se MUESTRAN con los datos de la muestra elegida: la posición ya
 * la identifica, y pedirlos de nuevo solo permitiría que no coincidan (docs/FORMULARIO.md).
 */
export function ThawForm({ users, sessionUser, initial, onClose, onSubmitted }: ThawFormProps) {
  const [racks, setRacks] = useState<RackRead[]>([]);
  const [sections, setSections] = useState<SectionRead[]>([]);
  const [date, setDate] = useState(todayIso);
  const [operatorInitials, setOperatorInitials] = useState(sessionUser.initials);
  const [boxName, setBoxName] = useState(
    initial?.rackLetter && initial?.boxNumber ? `${initial.rackLetter}${initial.boxNumber}` : "",
  );
  const [position, setPosition] = useState(initial?.position ?? "");
  const [reason, setReason] = useState("");
  const [sample, setSample] = useState<SampleWithLocation | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const box = useBoxResolution(boxName, racks);
  const sectionCode = useMemo(() => sectionCodeForBox(boxName, racks, sections), [boxName, racks, sections]);
  const sampleId = box.positions.find((entry) => entry.position === position && entry.occupied)?.sample_id ?? null;

  useEffect(() => {
    api.listRacks().then(setRacks).catch(() => setRacks([]));
    api.listSections().then(setSections).catch(() => setSections([]));
  }, []);

  // La muestra que se va a retirar, con todos sus datos: es lo que el operador confirma.
  useEffect(() => {
    if (sampleId === null) {
      setSample(null);
      return;
    }
    let cancelled = false;
    api
      .getSample(sampleId)
      .then((loaded) => {
        if (!cancelled) setSample(loaded);
      })
      .catch(() => {
        if (!cancelled) setSample(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sampleId]);

  const owners = sample ? ownersOf(sample, users) : [];
  const allowed = sample ? canModifySample(sample, owners, sessionUser) : true;

  function validate(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!date) errors.date = "La fecha es obligatoria";
    if (!operatorInitials.trim()) errors.operatorInitials = "El operador es obligatorio";
    const parsed = parseBoxName(boxName);
    if (!boxName.trim()) errors.boxName = "El nombre de la caja es obligatorio";
    else if (!parsed) errors.boxName = "Formato inválido: letra de rack + N° de caja (p. ej. A12)";
    else if (!racks.some((rack) => rack.letter === parsed.rackLetter)) {
      errors.boxName = `No existe el rack '${parsed.rackLetter}'`;
    }
    if (!position) errors.position = "Selecciona la posición de la muestra que vas a retirar";
    return errors;
  }

  async function submit() {
    const errors = validate();
    setFieldErrors(errors);
    setSubmitError(null);
    if (Object.keys(errors).length > 0 || !allowed) return;

    const parsed = parseBoxName(boxName)!;
    setSubmitting(true);
    try {
      const result = await api.createMovement({
        action: "thaw",
        date,
        operator_initials: operatorInitials.trim().toUpperCase(),
        rack_letter: parsed.rackLetter,
        box_number: parsed.boxNumber,
        position,
        note: reason.trim() || null,
      });
      onSubmitted(result);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "No se pudo registrar el retiro");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal titleId="tf-title" onClose={onClose} wide>
      <div className="modal-header">
        <h2 id="tf-title" tabIndex={-1}>
          <span className="movement-kind movement-kind--thaw">Descongelamiento</span> Retirar muestra
        </h2>
        <button className="btn-ghost" onClick={onClose} aria-label="Cerrar">
          Cerrar
        </button>
      </div>
      <p className="field-hint">
        La muestra pasa a estado retirada y queda en el historial: nunca se borra. Su posición queda libre.
      </p>

      <form
        className="movement-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="field">
          <label htmlFor="tf-date">Fecha</label>
          <input id="tf-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          {fieldErrors.date && <p className="field-error">{fieldErrors.date}</p>}
        </div>

        <div className="field">
          <label htmlFor="tf-operator">Operador (a)</label>
          <select id="tf-operator" value={operatorInitials} onChange={(event) => setOperatorInitials(event.target.value)}>
            <UserOptions users={users} />
          </select>
          {fieldErrors.operatorInitials && <p className="field-error">{fieldErrors.operatorInitials}</p>}
        </div>

        <div className="field">
          <label htmlFor="tf-box-name">Nombre Caja (Letra rack y N° de caja)</label>
          <input
            id="tf-box-name"
            value={boxName}
            onChange={(event) => {
              setBoxName(event.target.value);
              setPosition("");
            }}
            placeholder="p. ej. A12"
          />
          {fieldErrors.boxName && <p className="field-error">{fieldErrors.boxName}</p>}
        </div>

        <div className="field">
          <label htmlFor="tf-section">Sección</label>
          <input id="tf-section" value={sectionCode ?? ""} readOnly placeholder="Según el rack" />
        </div>

        <div className="field field--full">
          <label>Posición de la muestra a retirar</label>
          <p className="field-hint">Solo se pueden elegir posiciones ocupadas.</p>
          <PositionPicker
            boxType={box.boxType}
            occupied={box.occupied}
            occupantLabels={box.occupantLabels}
            corePositions={box.corePositions}
            value={position || null}
            onChange={setPosition}
            selectMode="occupied"
          />
          {fieldErrors.position && <p className="field-error">{fieldErrors.position}</p>}
        </div>

        {sample && (
          <section className="thaw-sample field--full" aria-label="Muestra a retirar">
            <h3>Muestra a retirar</h3>
            <NucleoWarning isCore={sample.is_core} />
            <dl className="detail-grid">
              <div>
                <dt>ID Environ</dt>
                <dd>{sample.environ_id ?? "Sin ID"}</dd>
              </div>
              <div>
                <dt>Descripción</dt>
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
                <dt>¿Pertenece al Núcleo Environ?</dt>
                <dd>{formatBoolean(sample.is_core)}</dd>
              </div>
              <div>
                <dt>{owners.length > 1 ? "Encargados" : "Encargado"}</dt>
                <dd>{ownersLabel(owners)}</dd>
              </div>
            </dl>
            {!allowed && (
              <p className="field-error" role="alert">
                Esta muestra está a cargo de {ownersLabel(owners)}: solo sus encargados pueden retirarla.
              </p>
            )}
          </section>
        )}

        <div className="field field--full">
          <label htmlFor="tf-reason">Motivo del retiro</label>
          <input
            id="tf-reason"
            value={reason}
            maxLength={255}
            onChange={(event) => setReason(event.target.value)}
            placeholder="p. ej. extracción de RNA, se agotó, se envió a otro laboratorio"
          />
        </div>

        {submitError && (
          <p className="field-error field--full" role="alert">
            {submitError}
          </p>
        )}

        <div className="form-actions field--full">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-danger" disabled={submitting || !allowed}>
            {submitting ? "Retirando…" : "Retirar muestra"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
