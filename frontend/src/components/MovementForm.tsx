import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import {
  DEFAULT_OPERATOR_INITIALS,
  DEFAULT_OWNER_INITIALS,
  MOVEMENT_ACTION_LABELS,
  SAMPLE_TYPE_LABELS,
  SECTION_CODES,
  type BoxPositionStatus,
  type BoxType,
  type MovementAction,
  type MovementCreate,
  type MovementResult,
  type PositionConflict,
  type RackRead,
  type SampleType,
  type SectionRead,
  type UserRead,
} from "../api/types";
import { nextFreePosition, parseBoxName } from "../utils/positions";
import { PositionPicker } from "./PositionPicker";

const LAST_OPERATOR_KEY = "refri:ultimo-operador";
const SAMPLE_TYPE_OPTIONS = Object.entries(SAMPLE_TYPE_LABELS) as [SampleType, string][];
const ACTION_OPTIONS = Object.entries(MOVEMENT_ACTION_LABELS) as [MovementAction, string][];

function todayIso(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function mergeInitials(defaults: readonly string[], users: UserRead[]): string[] {
  const extra = users
    .filter((user) => user.active && !defaults.includes(user.initials))
    .map((user) => user.initials)
    .sort();
  return [...defaults, ...extra];
}

interface FormState {
  action: MovementAction;
  date: string;
  environId: string;
  description: string;
  sampleType: SampleType | "";
  typeOther: string;
  operatorInitials: string;
  passage: string;
  sectionCode: string;
  boxName: string;
  boxType: BoxType;
  position: string;
  isCore: "" | "true" | "false";
  nonCoreOwnerInitials: string;
  boxIsFull: "" | "true" | "false";
}

// Prellenado desde el visor 3D (issue #6): clic en una posición libre arma un
// congelamiento con esa caja/posición; clic en una ocupada arma un descongelamiento.
export interface MovementFormPrefill {
  action?: MovementAction;
  sectionCode?: string;
  rackLetter?: string;
  boxNumber?: number;
  boxType?: BoxType;
  position?: string;
}

function emptyForm(lastOperator: string, initial?: MovementFormPrefill): FormState {
  return {
    action: initial?.action ?? "freeze",
    date: todayIso(),
    environId: "",
    description: "",
    sampleType: "",
    typeOther: "",
    operatorInitials: lastOperator,
    passage: "",
    sectionCode: initial?.sectionCode ?? "",
    boxName: initial?.rackLetter && initial?.boxNumber ? `${initial.rackLetter}${initial.boxNumber}` : "",
    boxType: initial?.boxType ?? "carton_81",
    position: initial?.position ?? "",
    isCore: "",
    nonCoreOwnerInitials: "",
    boxIsFull: "",
  };
}

export interface MovementFormProps {
  users: UserRead[];
  initial?: MovementFormPrefill;
  onClose: () => void;
  onSubmitted: (result: MovementResult) => void;
}

export function MovementForm({ users, initial, onClose, onSubmitted }: MovementFormProps) {
  const [lastOperator] = useState(() => localStorage.getItem(LAST_OPERATOR_KEY) ?? "");
  const [form, setForm] = useState<FormState>(() => emptyForm(lastOperator, initial));
  const [racks, setRacks] = useState<RackRead[]>([]);
  const [sections, setSections] = useState<SectionRead[]>([]);
  const [boxExists, setBoxExists] = useState(false);
  const [boxPositions, setBoxPositions] = useState<BoxPositionStatus[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<PositionConflict | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const operatorOptions = useMemo(() => mergeInitials(DEFAULT_OPERATOR_INITIALS, users), [users]);
  const ownerOptions = useMemo(() => mergeInitials(DEFAULT_OWNER_INITIALS, users), [users]);

  const occupied = useMemo(
    () => new Set(boxPositions.filter((entry) => entry.occupied).map((entry) => entry.position)),
    [boxPositions],
  );
  const occupantLabels = useMemo(
    () => new Map(boxPositions.filter((entry) => entry.occupied).map((entry) => [entry.position, entry.environ_id])),
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

  const sectionCodeByRackId = useMemo(
    () => new Map(racks.map((rack) => [rack.id, sections.find((section) => section.id === rack.section_id)?.code])),
    [racks, sections],
  );

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
    if (environId.length < 2 || form.action !== "freeze") return;
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
              nonCoreOwnerInitials:
                suggestion.is_core === false && suggestion.owner_initials
                  ? suggestion.owner_initials
                  : current.nonCoreOwnerInitials,
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
  }, [form.environId, form.action]);

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
      if (!rack) {
        errors.boxName = `No existe el rack '${parsedBox.rackLetter}'`;
      } else if (form.sectionCode) {
        const rackSectionCode = sectionCodeByRackId.get(rack.id);
        if (rackSectionCode && rackSectionCode !== form.sectionCode) {
          errors.sectionCode = `El rack '${rack.letter}' pertenece a la sección ${rackSectionCode}, no a ${form.sectionCode}`;
        }
      }
    }

    if (!form.position) {
      errors.position =
        form.action === "thaw" ? "Selecciona la posición que quieres retirar" : "Selecciona una posición libre en la caja";
    }

    if (form.action === "freeze") {
      if (!form.environId.trim()) errors.environId = "El ID Environ es obligatorio";
      if (!form.sampleType) errors.sampleType = "El tipo es obligatorio";
      if (form.sampleType === "otros" && !form.typeOther.trim()) {
        errors.typeOther = "Especifica el tipo cuando seleccionas 'Otros'";
      }
      if (!form.isCore) errors.isCore = "Indica si pertenece al Núcleo Environ";
      if (form.isCore === "false" && !form.nonCoreOwnerInitials.trim()) {
        errors.nonCoreOwnerInitials = "Indica el propietario cuando no es del Núcleo";
      }
      if (!form.boxIsFull) errors.boxIsFull = "Indica si la caja quedó llena";
    }
    return errors;
  }

  function buildPayload(): MovementCreate {
    const parsedBox = parseBoxName(form.boxName)!;
    const isFreeze = form.action === "freeze";
    return {
      action: form.action,
      date: form.date,
      operator_initials: form.operatorInitials.trim().toUpperCase(),
      rack_letter: parsedBox.rackLetter,
      box_number: parsedBox.boxNumber,
      position: form.position,
      environ_id: isFreeze ? form.environId.trim() : undefined,
      description: isFreeze ? form.description.trim() || null : undefined,
      sample_type: isFreeze ? (form.sampleType as SampleType) : undefined,
      type_other: isFreeze && form.sampleType === "otros" ? form.typeOther.trim() : undefined,
      passage: isFreeze && form.passage.trim() !== "" ? Number(form.passage) : undefined,
      is_core: isFreeze ? form.isCore === "true" : undefined,
      non_core_owner_initials:
        isFreeze && form.isCore === "false" ? form.nonCoreOwnerInitials.trim().toUpperCase() : undefined,
      box_is_full: isFreeze ? form.boxIsFull === "true" : undefined,
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
      localStorage.setItem(LAST_OPERATOR_KEY, payload.operator_initials);
      onSubmitted(result);

      if (sameSet && form.action === "freeze") {
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

  const thawTarget = form.action === "thaw" && form.position ? occupantLabels.get(form.position) : undefined;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mf-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="mf-title">Nuevo movimiento</h2>
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
            <label htmlFor="mf-action">Acción</label>
            <select
              id="mf-action"
              value={form.action}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  action: event.target.value as MovementAction,
                  position: "",
                }))
              }
            >
              {ACTION_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {form.action === "thaw" && (
              <p className="field-hint">
                Para un retiro no hace falta completar Descripción, Tipo, Pasaje, Núcleo ni si la caja quedó llena.
              </p>
            )}
          </div>

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
              <option value="">Selecciona…</option>
              {operatorOptions.map((initials) => (
                <option key={initials} value={initials}>
                  {initials}
                </option>
              ))}
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
            <label htmlFor="mf-section">Sección</label>
            <select id="mf-section" value={form.sectionCode} onChange={(event) => set("sectionCode", event.target.value)}>
              <option value="">Selecciona…</option>
              {SECTION_CODES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
            {fieldErrors.sectionCode && <p className="field-error">{fieldErrors.sectionCode}</p>}
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
              value={form.position || null}
              onChange={(position) => set("position", position)}
              selectMode={form.action === "thaw" ? "occupied" : "free"}
            />
            {form.action === "thaw" && form.position && (
              <p className="field-hint">
                Vas a retirar: <strong>{thawTarget ?? "muestra sin ID Environ"}</strong>
              </p>
            )}
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

          {form.isCore === "false" && (
            <div className="field">
              <label htmlFor="mf-owner">Si la respuesta es no, indicar propietario de lo ingresado</label>
              <select
                id="mf-owner"
                value={form.nonCoreOwnerInitials}
                onChange={(event) => set("nonCoreOwnerInitials", event.target.value)}
              >
                <option value="">Selecciona…</option>
                {ownerOptions.map((initials) => (
                  <option key={initials} value={initials}>
                    {initials}
                  </option>
                ))}
              </select>
              {fieldErrors.nonCoreOwnerInitials && <p className="field-error">{fieldErrors.nonCoreOwnerInitials}</p>}
            </div>
          )}

          <div className="field">
            <label htmlFor="mf-box-full">¿La caja está llena?</label>
            <select
              id="mf-box-full"
              value={form.boxIsFull}
              onChange={(event) => set("boxIsFull", event.target.value as FormState["boxIsFull"])}
            >
              <option value="">Selecciona…</option>
              <option value="true">SI</option>
              <option value="false">No</option>
            </select>
            {fieldErrors.boxIsFull && <p className="field-error">{fieldErrors.boxIsFull}</p>}
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
            {form.action === "freeze" && (
              <button type="button" className="btn-ghost" disabled={submitting} onClick={() => void submit(true)}>
                Guardar y agregar otra del mismo set
              </button>
            )}
            <button type="submit" className="btn" disabled={submitting}>
              Guardar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
