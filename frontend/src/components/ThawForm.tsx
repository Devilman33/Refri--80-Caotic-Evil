import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { api, ApiError } from "../api/client";
import {
  SAMPLE_TYPE_LABELS,
  type BoxOccupancy,
  type BoxPositionStatus,
  type MovementResult,
  type SampleWithLocation,
  type UserRead,
} from "../api/types";
import { formatBoolean, todayIso } from "../utils/format";
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
const ID_DEBOUNCE_MS = 250;

export function ThawForm({ users, sessionUser, initial, onClose, onSubmitted }: ThawFormProps) {
  const [boxes, setBoxes] = useState<BoxOccupancy[] | null>(null);
  const [date, setDate] = useState(todayIso);
  const [operatorInitials, setOperatorInitials] = useState(sessionUser.initials);
  const [sectionCode, setSectionCode] = useState(initial?.sectionCode ?? "");
  const [rackLetter, setRackLetter] = useState(initial?.rackLetter ?? "");
  const [boxNumber, setBoxNumber] = useState(initial?.boxNumber ? String(initial.boxNumber) : "");
  const [positions, setPositions] = useState<BoxPositionStatus[]>([]);
  const [position, setPosition] = useState(initial?.position ?? "");
  const [reason, setReason] = useState("");
  const [sample, setSample] = useState<SampleWithLocation | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Frente al freezer se tiene el tubo en la mano y se lee su ID: se puede partir por ahí
  // (docs/PLAN_FRONTEND.md, F2). Elegir una muestra rellena caja y posición; los campos
  // del Google Form no cambian.
  const [idQuery, setIdQuery] = useState("");
  const [idMatches, setIdMatches] = useState<SampleWithLocation[]>([]);
  const [idStatus, setIdStatus] = useState<"idle" | "loading" | "empty" | "error">("idle");
  const idSeq = useRef(0);

  // Solo se ofrecen cajas con muestras activas: no hay nada que retirar de una vacía.
  useEffect(() => {
    api
      .listBoxOccupancy()
      .then((list) => setBoxes(list.filter((box) => box.active > 0)))
      .catch(() => setBoxes([]));
  }, []);

  const sectionOptions = useMemo(
    () => [...new Set((boxes ?? []).map((box) => box.section_code))].sort(),
    [boxes],
  );
  const rackOptions = useMemo(
    () => [...new Set((boxes ?? []).filter((box) => box.section_code === sectionCode).map((box) => box.rack_letter))].sort(),
    [boxes, sectionCode],
  );
  const boxOptions = useMemo(
    () =>
      (boxes ?? [])
        .filter((box) => box.section_code === sectionCode && box.rack_letter === rackLetter)
        .sort((a, b) => a.number - b.number),
    [boxes, sectionCode, rackLetter],
  );
  const selectedBox = boxOptions.find((box) => String(box.number) === boxNumber) ?? null;
  const selectedBoxId = selectedBox?.box_id ?? null;

  useEffect(() => {
    if (selectedBoxId === null) {
      setPositions([]);
      return;
    }
    let cancelled = false;
    api
      .getBoxPositions(selectedBoxId)
      .then((loaded) => {
        if (!cancelled) setPositions(loaded);
      })
      .catch(() => {
        if (!cancelled) setPositions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedBoxId]);

  const occupied = useMemo(() => new Set(positions.filter((entry) => entry.occupied).map((entry) => entry.position)), [positions]);
  const occupantLabels = useMemo(
    () => new Map(positions.filter((entry) => entry.occupied).map((entry) => [entry.position, entry.environ_id])),
    [positions],
  );
  const corePositions = useMemo(
    () => new Set(positions.filter((entry) => entry.occupied && entry.is_core).map((entry) => entry.position)),
    [positions],
  );
  const sampleId = positions.find((entry) => entry.position === position && entry.occupied)?.sample_id ?? null;

  useEffect(() => {
    const text = idQuery.trim();
    const seq = ++idSeq.current;
    if (text.length < 2) {
      setIdMatches([]);
      setIdStatus("idle");
      return;
    }
    const timer = window.setTimeout(() => {
      setIdStatus("loading");
      api
        .searchSamples({ environ_id: text, status: "active", page: 1, page_size: 8 })
        .then((page) => {
          if (seq !== idSeq.current) return;
          setIdMatches(page.items);
          setIdStatus(page.total === 0 ? "empty" : "idle");
        })
        .catch(() => {
          if (seq === idSeq.current) setIdStatus("error");
        });
    }, ID_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [idQuery]);

  function chooseSample(match: SampleWithLocation) {
    idSeq.current += 1;
    setIdQuery(match.environ_id ?? "");
    setIdMatches([]);
    setIdStatus("idle");
    if (!match.section_code || !match.rack_letter || match.box_number === undefined) return;
    setSectionCode(match.section_code);
    setRackLetter(match.rack_letter);
    setBoxNumber(String(match.box_number));
    setPosition(match.position);
  }

  function handleIdKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    // Enter en el ID elige la muestra si hay una sola; no envía el retiro.
    event.preventDefault();
    if (idMatches.length === 1) chooseSample(idMatches[0]);
  }

  function chooseSection(value: string) {
    setSectionCode(value);
    setRackLetter("");
    setBoxNumber("");
    setPosition("");
  }

  function chooseRack(value: string) {
    setRackLetter(value);
    setBoxNumber("");
    setPosition("");
  }

  function chooseBox(value: string) {
    setBoxNumber(value);
    setPosition("");
  }

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
    if (!sectionCode) errors.sectionCode = "Elige la sección";
    else if (!rackLetter) errors.rackLetter = "Elige el rack";
    else if (!selectedBox) errors.boxNumber = "Elige la caja";
    if (!position) errors.position = "Selecciona la posición de la muestra que vas a retirar";
    return errors;
  }

  async function submit() {
    const errors = validate();
    setFieldErrors(errors);
    setSubmitError(null);
    if (Object.keys(errors).length > 0 || !allowed) return;

    setSubmitting(true);
    try {
      const result = await api.createMovement({
        action: "thaw",
        date,
        operator_initials: operatorInitials.trim().toUpperCase(),
        rack_letter: rackLetter,
        box_number: Number(boxNumber),
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
        <div className="field field--full thaw-id">
          <label htmlFor="tf-environ-id">ID Environ del tubo</label>
          <input
            id="tf-environ-id"
            value={idQuery}
            onChange={(event) => setIdQuery(event.target.value)}
            onKeyDown={handleIdKeyDown}
            placeholder="p. ej. BP1234"
            autoComplete="off"
            spellCheck={false}
            aria-describedby="tf-environ-id-hint"
          />
          <p id="tf-environ-id-hint" className="field-hint" role="status">
            {idStatus === "loading" && "Buscando…"}
            {idStatus === "empty" && `No hay muestras activas con «${idQuery.trim()}».`}
            {idStatus === "error" && "No se pudo buscar. Elige la caja y la posición abajo."}
            {idStatus === "idle" && idMatches.length === 0 && "O elige la caja y la posición abajo."}
            {idStatus === "idle" && idMatches.length > 1 && `${idMatches.length} muestras activas: elige cuál.`}
          </p>
          {idMatches.length > 0 && (
            <ul className="thaw-id__matches" aria-label="Muestras con ese ID">
              {idMatches.map((match) => (
                <li key={match.id}>
                  <button type="button" onClick={() => chooseSample(match)}>
                    <span className="thaw-id__id">{match.environ_id ?? "Sin ID"}</span>
                    <span className="thaw-id__loc">{match.location}</span>
                    {match.is_core && <span className="global-search__core">Núcleo</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

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
          <label htmlFor="tf-section">Sección</label>
          <select id="tf-section" value={sectionCode} onChange={(event) => chooseSection(event.target.value)}>
            <option value="">{boxes === null ? "Cargando…" : "Selecciona…"}</option>
            {sectionOptions.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
          {fieldErrors.sectionCode && <p className="field-error">{fieldErrors.sectionCode}</p>}
        </div>

        <div className="field">
          <label htmlFor="tf-rack">Rack</label>
          <select
            id="tf-rack"
            value={rackLetter}
            disabled={!sectionCode}
            onChange={(event) => chooseRack(event.target.value)}
          >
            <option value="">Selecciona…</option>
            {rackOptions.map((letter) => (
              <option key={letter} value={letter}>
                {letter}
              </option>
            ))}
          </select>
          {fieldErrors.rackLetter && <p className="field-error">{fieldErrors.rackLetter}</p>}
        </div>

        <div className="field">
          <label htmlFor="tf-box">Caja</label>
          <select id="tf-box" value={boxNumber} disabled={!rackLetter} onChange={(event) => chooseBox(event.target.value)}>
            <option value="">Selecciona…</option>
            {boxOptions.map((box) => (
              <option key={box.box_id} value={box.number}>
                {box.rack_letter}
                {box.number} · {box.active} de {box.capacity} ocupadas
              </option>
            ))}
          </select>
          {fieldErrors.boxNumber && <p className="field-error">{fieldErrors.boxNumber}</p>}
        </div>

        <div className="field field--full">
          <label>Posición de la muestra a retirar</label>
          <p className="field-hint">Solo se pueden elegir posiciones ocupadas.</p>
          <PositionPicker
            boxType={selectedBox?.box_type ?? "carton_81"}
            occupied={occupied}
            occupantLabels={occupantLabels}
            corePositions={corePositions}
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
          {/* Primario turquesa, no rojo: descongelar no borra nada (DESIGN.md). */}
          <button type="submit" className="btn" disabled={submitting || !allowed}>
            {submitting ? "Descongelando…" : "Descongelar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
