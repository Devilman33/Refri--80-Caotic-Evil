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
import { ownersLabel, ownersOf } from "../utils/users";
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
  onSubmitted: (results: MovementResult[]) => void;
}

/** Una muestra en la lista de las que se van a retirar. */
interface PickedSample {
  id: number;
  environId: string | null;
  location: string;
  boxId: number;
  position: string;
  isCore: boolean;
  owners: string;
}

/**
 * Descongelamiento (retiro). Es un formulario aparte del de congelamiento a pedido del
 * laboratorio: compartían pantalla y se confundían.
 *
 * Se editan solo los datos del retiro (fecha, operador, dónde y motivo). El resto de los
 * campos del Google Form se MUESTRAN con los datos de la muestra elegida: la posición ya
 * la identifica, y pedirlos de nuevo solo permitiría que no coincidan (docs/FORMULARIO.md).
 *
 * Parte 3: se pueden retirar VARIAS de una vez (por ID o tocando posiciones), con una sola
 * fecha y motivo, y cualquier persona identificada puede hacerlo.
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
  const [picked, setPicked] = useState<PickedSample[]>([]);
  const initialPending = useRef(initial?.position ?? null);
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
  const locationPrefix = selectedBox ? `${selectedBox.section_code} · ${selectedBox.rack_letter}${selectedBox.number}` : "";
  const pickedHere = useMemo(
    () => new Set(picked.filter((item) => item.boxId === selectedBoxId).map((item) => item.position)),
    [picked, selectedBoxId],
  );

  function fromPosition(entry: BoxPositionStatus): PickedSample | null {
    if (!entry.occupied || entry.sample_id === null || selectedBoxId === null) return null;
    return {
      id: entry.sample_id,
      environId: entry.environ_id,
      location: `${locationPrefix} · ${entry.position}`,
      boxId: selectedBoxId,
      position: entry.position,
      isCore: entry.is_core === true,
      owners: entry.owners.join(", "),
    };
  }

  function add(item: PickedSample) {
    setPicked((current) => (current.some((entry) => entry.id === item.id) ? current : [...current, item]));
  }

  function togglePosition(position: string) {
    const entry = positions.find((candidate) => candidate.position === position);
    const item = entry ? fromPosition(entry) : null;
    if (!item) return;
    setPicked((current) =>
      current.some((existing) => existing.id === item.id)
        ? current.filter((existing) => existing.id !== item.id)
        : [...current, item],
    );
  }

  // Si se abrió desde una posición (3D o detalle), esa muestra entra a la lista sola.
  useEffect(() => {
    const pending = initialPending.current;
    if (!pending || positions.length === 0) return;
    const entry = positions.find((candidate) => candidate.position === pending);
    const item = entry ? fromPosition(entry) : null;
    if (item) add(item);
    initialPending.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions]);

  const single = picked.length === 1 ? picked[0] : null;

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
    add({
      id: match.id,
      environId: match.environ_id,
      location: match.location,
      boxId: match.box_id,
      position: match.position,
      isCore: match.is_core === true,
      owners: ownersLabel(ownersOf(match, users)),
    });
    setIdQuery("");
    if (!match.section_code || !match.rack_letter || match.box_number === undefined) return;
    setSectionCode(match.section_code);
    setRackLetter(match.rack_letter);
    setBoxNumber(String(match.box_number));
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
  }

  function chooseRack(value: string) {
    setRackLetter(value);
    setBoxNumber("");
  }

  function chooseBox(value: string) {
    setBoxNumber(value);
  }

  // Con UNA muestra en la lista se muestran todos sus datos: es lo que el operador confirma.
  const sampleId = single?.id ?? null;
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

  function validate(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!date) errors.date = "La fecha es obligatoria";
    if (!operatorInitials.trim()) errors.operatorInitials = "El operador es obligatorio";
    if (picked.length === 0) errors.picked = "Agrega al menos una muestra: por su ID o tocando su posición en la caja";
    return errors;
  }

  async function submit() {
    const errors = validate();
    setFieldErrors(errors);
    setSubmitError(null);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      const results = await api.thawBatch({
        date,
        operator_initials: operatorInitials.trim().toUpperCase(),
        sample_ids: picked.map((item) => item.id),
        note: reason.trim() || null,
      });
      onSubmitted(results);
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
          <span className="movement-kind movement-kind--thaw">Descongelamiento</span> Retirar muestras
        </h2>
        <button className="btn-ghost" onClick={onClose} aria-label="Cerrar">
          Cerrar
        </button>
      </div>
      <p className="field-hint">
        Agrega una o varias muestras por su ID o tocándolas en la caja. Pasan a estado retirada y quedan en el
        historial (nunca se borran); se pueden devolver al refri después.
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
            {idStatus === "idle" && idMatches.length > 1 && `${idMatches.length} muestras activas: elige cuáles agregar.`}
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
          <label>Posiciones a retirar</label>
          <p className="field-hint">Toca las posiciones ocupadas para sumarlas o quitarlas de la lista.</p>
          <PositionPicker
            boxType={selectedBox?.box_type ?? "carton_81"}
            occupied={occupied}
            occupantLabels={occupantLabels}
            corePositions={corePositions}
            value={null}
            selectedSet={pickedHere}
            onChange={togglePosition}
            selectMode="occupied"
          />
        </div>

        <section className="thaw-list field--full" aria-label="Muestras a retirar">
          <h3>
            Muestras a retirar <span className="field-hint">({picked.length})</span>
          </h3>
          {picked.length === 0 ? (
            <p className="field-hint">Todavía no agregaste ninguna.</p>
          ) : (
            <ul>
              {picked.map((item) => (
                <li key={item.id}>
                  <span className="thaw-list__id">{item.environId ?? "Sin ID"}</span>
                  <span className="thaw-list__loc">{item.location}</span>
                  {item.owners && <span className="thaw-list__owners">{item.owners}</span>}
                  {item.isCore && <span className="global-search__core">Núcleo</span>}
                  <button
                    type="button"
                    className="btn-ghost"
                    aria-label={`Quitar ${item.environId ?? "muestra"} de la lista`}
                    onClick={() => setPicked((current) => current.filter((entry) => entry.id !== item.id))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          {fieldErrors.picked && <p className="field-error">{fieldErrors.picked}</p>}
        </section>

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
          <button type="submit" className="btn" disabled={submitting}>
            {submitting
              ? "Descongelando…"
              : picked.length > 1
                ? `Descongelar ${picked.length} muestras`
                : "Descongelar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
