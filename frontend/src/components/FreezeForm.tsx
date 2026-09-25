import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import {
  SAMPLE_TYPE_LABELS,
  type BoxPositionStatus,
  type BoxType,
  type MovementCreate,
  type MovementResult,
  type PositionConflict,
  type RackRead,
  type SampleType,
  type SectionRead,
  type UserRead,
} from "../api/types";
import { nextFreePosition, parseBoxName } from "../utils/positions";
import { todayIso } from "../utils/format";
import { sectionCodeForBox } from "../utils/positions";
import { Modal } from "./Modal";
import { OwnersPicker } from "./OwnersPicker";
import { PositionPicker } from "./PositionPicker";
import { UserOptions } from "./UserOptions";

const SAMPLE_TYPE_OPTIONS = Object.entries(SAMPLE_TYPE_LABELS) as [SampleType, string][];

interface FormState {
  date: string;
  environId: string;
  description: string;
  sampleType: SampleType | "";
  typeOther: string;
  operatorInitials: string;
  passage: string;
  boxName: string;
  boxType: BoxType;
  position: string;
  isCore: "" | "true" | "false";
  ownerInitials: string[];
}

/** Prellenado desde el visor 3D (issue #6): clic en una posición libre abre el
 * congelamiento con esa caja y posición ya elegidas. */
export interface LocationPrefill {
  sectionCode?: string;
  rackLetter?: string;
  boxNumber?: number;
  boxType?: BoxType;
  position?: string;
}

function emptyForm(sessionInitials: string, initial?: LocationPrefill): FormState {
  return {
    date: todayIso(),
    environId: "",
    description: "",
    sampleType: "",
    typeOther: "",
    operatorInitials: sessionInitials,
    passage: "",
    boxName: initial?.rackLetter && initial?.boxNumber ? `${initial.rackLetter}${initial.boxNumber}` : "",
    boxType: initial?.boxType ?? "carton_81",
    position: initial?.position ?? "",
    isCore: "",
    // Lo más común es congelar muestras propias: el encargado parte siendo quien registra.
    ownerInitials: sessionInitials ? [sessionInitials] : [],
  };
}

export interface FreezeFormProps {
  users: UserRead[];
  /** Iniciales de la persona de la sesión: prellenan Operador y Encargado. */
  sessionInitials: string;
  initial?: LocationPrefill;
  onClose: () => void;
  onSubmitted: (result: MovementResult) => void;
}

/**
 * Congelamiento (ingreso) de una muestra: el Google Form del laboratorio con las
 * desviaciones acordadas de docs/FORMULARIO.md. El descongelamiento es `ThawForm`, a
 * propósito un formulario aparte: compartían pantalla y se confundían.
 */
export function FreezeForm({ users, sessionInitials, initial, onClose, onSubmitted }: FreezeFormProps) {
  const [form, setForm] = useState<FormState>(() => emptyForm(sessionInitials, initial));
  const [racks, setRacks] = useState<RackRead[]>([]);
  const [sections, setSections] = useState<SectionRead[]>([]);
  const [boxExists, setBoxExists] = useState(false);
  const [boxPositions, setBoxPositions] = useState<BoxPositionStatus[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<PositionConflict | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const occupied = useMemo(
    () => new Set(boxPositions.filter((entry) => entry.occupied).map((entry) => entry.position)),
    [boxPositions],
  );
  const occupantLabels = useMemo(
    () => new Map(boxPositions.filter((entry) => entry.occupied).map((entry) => [entry.position, entry.environ_id])),
    [boxPositions],
  );
  // `is_core` ya venía en la respuesta de /boxes/{id}/positions y se descartaba, así que la
  // grilla del formulario era la única vista sin el warning de Núcleo (regla no negociable).
  const corePositions = useMemo(
    () => new Set(boxPositions.filter((entry) => entry.occupied && entry.is_core).map((entry) => entry.position)),
    [boxPositions],
  );

  useEffect(() => {
    api
      .listRacks()
      .then(setRacks)
      .catch(() => setRacks([]));
    api
      .listSections()
      .then(setSections)
      .catch(() => setSections([]));
  }, []);

  // Sección se deduce del rack de "Nombre Caja": pedirla aparte solo permitía que no
  // coincidieran (docs/FORMULARIO.md, desviaciones).
  const sectionCode = useMemo(() => sectionCodeForBox(form.boxName, racks, sections), [form.boxName, racks, sections]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  // Resuelve la caja existente a partir de "Nombre Caja" para detectar su tipo
  // real (cartón/plástica) y pintar las luces roja/verde de sus posiciones
  // (docs/FORMULARIO.md: campos 11/12 y las luces del visor).
  useEffect(() => {
    const parsed = parseBoxName(form.boxName);
    const rack = parsed ? racks.find((entry) => entry.letter === parsed.rackLetter) : undefined;
    if (!parsed || !rack) {
      setBoxExists(false);
      setBoxPositions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .listBoxes({ rack_id: rack.id })
        .then((boxes) => {
          if (cancelled) return null;
          const box = boxes.find((entry) => entry.number === parsed.boxNumber);
          if (!box) {
            setBoxExists(false);
            setBoxPositions([]);
            return null;
          }
          setBoxExists(true);
          setForm((current) => (current.boxType === box.box_type ? current : { ...current, boxType: box.box_type }));
          return api.getBoxPositions(box.id);
        })
        .then((positions) => {
          if (!cancelled && positions) setBoxPositions(positions);
        })
        .catch(() => {
          if (!cancelled) {
            setBoxExists(false);
            setBoxPositions([]);
          }
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [form.boxName, racks]);

  // Autocompletado por ID Environ: sugiere Tipo, Descripción, Pasaje, Núcleo,
  // propietario y caja de otras muestras con el mismo ID (docs/FORMULARIO.md).
  useEffect(() => {
    const environId = form.environId.trim();
    if (environId.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .getAutocompleteSuggestions({ environ_id: environId })
        .then((suggestion) => {
          if (cancelled || !suggestion.environ_id) return;
          setForm((current) => {
            if (current.environId.trim() !== environId) return current;
            return {
              ...current,
              description: suggestion.description ?? current.description,
              sampleType: suggestion.sample_type ?? current.sampleType,
              typeOther: suggestion.type_other ?? current.typeOther,
              passage: suggestion.passage !== null ? String(suggestion.passage) : current.passage,
              isCore: suggestion.is_core === null ? current.isCore : suggestion.is_core ? "true" : "false",
              ownerInitials: suggestion.owner_initials.length > 0 ? suggestion.owner_initials : current.ownerInitials,
              boxName:
                suggestion.rack_letter && suggestion.box_number
                  ? `${suggestion.rack_letter}${suggestion.box_number}`
                  : current.boxName,
              position: suggestion.next_free_position ?? current.position,
            };
          });
        })
        .catch(() => undefined);
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [form.environId]);

  function validate(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!form.date) errors.date = "La fecha es obligatoria";
    if (!form.operatorInitials.trim()) errors.operatorInitials = "El operador es obligatorio";

    const parsedBox = parseBoxName(form.boxName);
    if (!form.boxName.trim()) {
      errors.boxName = "El nombre de la caja es obligatorio";
    } else if (!parsedBox) {
      errors.boxName = "Formato inválido: letra de rack + N° de caja (p. ej. A12)";
    } else {
      const rack = racks.find((entry) => entry.letter === parsedBox.rackLetter);
      if (!rack) errors.boxName = `No existe el rack '${parsedBox.rackLetter}'`;
    }

    if (!form.position) errors.position = "Selecciona una posición libre en la caja";
    if (!form.environId.trim()) errors.environId = "El ID Environ es obligatorio";
    if (!form.sampleType) errors.sampleType = "El tipo es obligatorio";
    if (form.sampleType === "otros" && !form.typeOther.trim()) {
      errors.typeOther = "Especifica el tipo cuando seleccionas 'Otros'";
    }
    if (!form.isCore) errors.isCore = "Indica si pertenece al Núcleo Environ";
    if (form.ownerInitials.length === 0) errors.ownerInitials = "Indica al menos un encargado de la muestra";
    return errors;
  }

  function buildPayload(): MovementCreate {
    const parsedBox = parseBoxName(form.boxName)!;
    return {
      action: "freeze",
      date: form.date,
      operator_initials: form.operatorInitials.trim().toUpperCase(),
      rack_letter: parsedBox.rackLetter,
      box_number: parsedBox.boxNumber,
      position: form.position,
      environ_id: form.environId.trim(),
      description: form.description.trim() || null,
      sample_type: form.sampleType as SampleType,
      type_other: form.sampleType === "otros" ? form.typeOther.trim() : undefined,
      passage: form.passage.trim() !== "" ? Number(form.passage) : undefined,
      is_core: form.isCore === "true",
      owner_initials: form.ownerInitials,
    };
  }

  async function submit(sameSet: boolean) {
    const errors = validate();
    setFieldErrors(errors);
    setConflict(null);
    setSubmitError(null);
    setNotice(null);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      const payload = buildPayload();
      const result = await api.createMovement(payload);
      onSubmitted(result);

      if (sameSet) {
        const updatedOccupied = new Set(occupied);
        updatedOccupied.add(form.position);
        setBoxPositions((current) => [
          ...current.filter((entry) => entry.position !== form.position),
          {
            position: form.position,
            occupied: true,
            sample_id: result.sample.id,
            environ_id: result.sample.environ_id,
            is_core: result.sample.is_core,
          },
        ]);
        const next = nextFreePosition(form.boxType, updatedOccupied);
        setForm((current) => ({ ...current, position: next ?? "" }));
        setNotice(
          next ? `Muestra guardada. Siguiente posición libre: ${next}.` : "Muestra guardada. No quedan posiciones libres en esta caja.",
        );
      } else {
        onClose();
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.detail && typeof err.detail === "object") {
        const detail = err.detail as PositionConflict;
        setConflict(detail);
        setFieldErrors((current) => ({ ...current, position: detail.message }));
      } else {
        setSubmitError(err instanceof ApiError ? err.message : "No se pudo registrar el movimiento");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal titleId="mf-title" onClose={onClose} wide>
        <div className="modal-header">
          <h2 id="mf-title" tabIndex={-1}>
            <span className="movement-kind movement-kind--freeze">Congelamiento</span> Ingresar muestra
          </h2>
          <button className="btn-ghost" onClick={onClose} aria-label="Cerrar">
            Cerrar
          </button>
        </div>

        <form
          className="movement-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(false);
          }}
        >
          <div className="field">
            <label htmlFor="mf-date">Fecha</label>
            <input
              id="mf-date"
              type="date"
              value={form.date}
              onChange={(event) => set("date", event.target.value)}
            />
            {fieldErrors.date && <p className="field-error">{fieldErrors.date}</p>}
          </div>

          <div className="field">
            <label htmlFor="mf-environ-id">ID Environ</label>
            <input
              id="mf-environ-id"
              value={form.environId}
              onChange={(event) => set("environId", event.target.value)}
              placeholder="p. ej. BP1234"
            />
            {fieldErrors.environId && <p className="field-error">{fieldErrors.environId}</p>}
          </div>

          <div className="field">
            <label htmlFor="mf-description">Descripción</label>
            <input
              id="mf-description"
              value={form.description}
              onChange={(event) => set("description", event.target.value)}
            />
            <p className="field-hint">Corresponde a "ID Origen o Descripción" en el Excel.</p>
          </div>

          <div className="field">
            <label htmlFor="mf-type">Tipo</label>
            <select
              id="mf-type"
              value={form.sampleType}
              onChange={(event) => set("sampleType", event.target.value as SampleType | "")}
            >
              <option value="">Selecciona…</option>
              {SAMPLE_TYPE_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {fieldErrors.sampleType && <p className="field-error">{fieldErrors.sampleType}</p>}
          </div>

          {form.sampleType === "otros" && (
            <div className="field">
              <label htmlFor="mf-type-other">En caso de haber seleccionado otros, especifique el tipo:</label>
              <input
                id="mf-type-other"
                value={form.typeOther}
                onChange={(event) => set("typeOther", event.target.value)}
              />
              {fieldErrors.typeOther && <p className="field-error">{fieldErrors.typeOther}</p>}
            </div>
          )}

          <div className="field">
            <label htmlFor="mf-operator">Operador (a)</label>
            <select
              id="mf-operator"
              value={form.operatorInitials}
              onChange={(event) => set("operatorInitials", event.target.value)}
            >
              <UserOptions users={users} />
            </select>
            {fieldErrors.operatorInitials && <p className="field-error">{fieldErrors.operatorInitials}</p>}
          </div>

          <div className="field">
            <label htmlFor="mf-passage">Pasaje (Si es que existe)</label>
            <input
              id="mf-passage"
              type="number"
              min={0}
              value={form.passage}
              onChange={(event) => set("passage", event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="mf-box-name">Nombre Caja (Letra rack y N° de caja)</label>
            <input
              id="mf-box-name"
              value={form.boxName}
              onChange={(event) => set("boxName", event.target.value)}
              placeholder="p. ej. A12"
            />
            {fieldErrors.boxName && <p className="field-error">{fieldErrors.boxName}</p>}
          </div>

          <div className="field">
            <label htmlFor="mf-section">Sección</label>
            <input id="mf-section" value={sectionCode ?? ""} readOnly placeholder="Según el rack" />
            <p className="field-hint">Se completa sola según la letra del rack.</p>
          </div>

          <div className="field">
            <label htmlFor="mf-box-type">Tipo de subcaja</label>
            <select
              id="mf-box-type"
              value={form.boxType}
              disabled={boxExists}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  boxType: event.target.value as BoxType,
                  position: "",
                }))
              }
            >
              <option value="carton_81">Cartón (9×9)</option>
              <option value="plastic_100">Plástica (10×10)</option>
            </select>
            <p className="field-hint">
              {boxExists
                ? "Detectado automáticamente de la caja existente."
                : "La caja aún no existe: elige el tipo para mostrar la grilla o la lista correspondiente."}
            </p>
          </div>

          <div className="field field--full">
            <label>
              {form.boxType === "carton_81"
                ? "Posición en la caja (81 espacios caja cartón)"
                : "Posición en la caja (100 espacios caja plástica)"}
            </label>
            <p className="field-hint">
              {form.boxType === "carton_81"
                ? "Caja de cartón: el orden de los tubos se lee de arriba hacia abajo y de izquierda a derecha."
                : "Caja plástica: el orden de los tubos se lee de izquierda a derecha y de arriba hacia abajo."}
            </p>
            <PositionPicker
              boxType={form.boxType}
              occupied={occupied}
              occupantLabels={occupantLabels}
              corePositions={corePositions}
              value={form.position || null}
              onChange={(position) => set("position", position)}
              selectMode="free"
            />
            {fieldErrors.position && <p className="field-error">{fieldErrors.position}</p>}
            {conflict && (
              <p className="field-error">
                {conflict.message}.{" "}
                {conflict.next_free_position && (
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => {
                      set("position", conflict.next_free_position!);
                      setConflict(null);
                      setFieldErrors((current) => ({ ...current, position: "" }));
                    }}
                  >
                    Usar siguiente libre ({conflict.next_free_position})
                  </button>
                )}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="mf-nucleo">¿Pertenece al Núcleo Environ?</label>
            <select
              id="mf-nucleo"
              value={form.isCore}
              onChange={(event) => set("isCore", event.target.value as FormState["isCore"])}
            >
              <option value="">Selecciona…</option>
              <option value="true">Si</option>
              <option value="false">No</option>
            </select>
            {fieldErrors.isCore && <p className="field-error">{fieldErrors.isCore}</p>}
          </div>

          <div className="field">
            <label htmlFor="mf-owner">Encargados de la muestra</label>
            <OwnersPicker
              id="mf-owner"
              users={users}
              value={form.ownerInitials}
              onChange={(value) => set("ownerInitials", value)}
            />
            <p className="field-hint">Una o varias personas, también si la muestra es de Núcleo.</p>
            {fieldErrors.ownerInitials && <p className="field-error">{fieldErrors.ownerInitials}</p>}
          </div>

          {submitError && (
            <p className="field-error field--full" role="alert">
              {submitError}
            </p>
          )}
          {notice && (
            <p className="field-notice field--full" role="status">
              {notice}
            </p>
          )}

          <div className="form-actions field--full">
            <button type="button" className="btn-ghost" onClick={onClose} disabled={submitting}>
              Cancelar
            </button>
            <button type="button" className="btn-ghost" disabled={submitting} onClick={() => void submit(true)}>
              Guardar y agregar otra del mismo set
            </button>
            <button type="submit" className="btn" disabled={submitting}>
              Guardar
            </button>
          </div>
        </form>
    </Modal>
  );
}
