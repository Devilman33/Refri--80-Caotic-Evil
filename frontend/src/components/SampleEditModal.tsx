import { useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import {
  SAMPLE_TYPE_LABELS,
  type SampleType,
  type SampleUpdate,
  type SampleWithLocation,
  type UserRead,
} from "../api/types";
import { selectableUsers } from "../utils/users";
import { Modal } from "./Modal";
import { userOptionLabel } from "./UserOptions";

const SAMPLE_TYPE_OPTIONS = Object.entries(SAMPLE_TYPE_LABELS) as [SampleType, string][];

export interface SampleEditModalProps {
  sample: SampleWithLocation;
  users: UserRead[];
  onClose: () => void;
  onSaved: (sample: SampleWithLocation) => void;
}

interface FormState {
  environId: string;
  description: string;
  type: SampleType;
  typeOther: string;
  ownerId: string;
  passage: string;
  isCore: "" | "true" | "false";
  notes: string;
}

function initialForm(sample: SampleWithLocation): FormState {
  return {
    environId: sample.environ_id ?? "",
    description: sample.description ?? "",
    type: sample.type,
    typeOther: sample.type_other ?? "",
    ownerId: String(sample.owner_id),
    passage: sample.passage === null ? "" : String(sample.passage),
    isCore: sample.is_core === null ? "" : sample.is_core ? "true" : "false",
    notes: sample.notes ?? "",
  };
}

/**
 * Corrige los datos descriptivos de una muestra sobre el `PATCH /samples/{id}` que ya
 * existía en la API y que el frontend nunca llamaba.
 *
 * Sin esto, la alerta "muestras sin encargado" avisa de un problema que la web no deja
 * arreglar. El campo Encargado es justo el que la apaga.
 *
 * Los campos van en el orden de docs/FORMULARIO.md. Ubicación y estado aparecen en solo
 * lectura: cambian por movimientos, para no romper la trazabilidad.
 */
export function SampleEditModal({ sample, users, onClose, onSaved }: SampleEditModalProps) {
  const [form, setForm] = useState<FormState>(() => initialForm(sample));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const ownerOptions = useMemo(() => selectableUsers(users), [users]);
  const currentOwner = users.find((user) => user.id === sample.owner_id);

  const pristine = useMemo(
    () => JSON.stringify(form) === JSON.stringify(initialForm(sample)),
    [form, sample],
  );

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function buildPayload(): SampleUpdate {
    return {
      environ_id: form.environId.trim() || null,
      description: form.description.trim() || null,
      type: form.type,
      type_other: form.type === "otros" ? form.typeOther.trim() : null,
      owner_id: Number(form.ownerId),
      passage: form.passage.trim() === "" ? null : Number(form.passage),
      is_core: form.isCore === "" ? null : form.isCore === "true",
      notes: form.notes.trim() || null,
    };
  }

  async function submit() {
    const errors: Record<string, string> = {};
    if (form.type === "otros" && !form.typeOther.trim()) {
      errors.typeOther = "Especifica el tipo cuando seleccionas 'Otros'";
    }
    if (!form.ownerId) errors.ownerId = "El encargado es obligatorio";
    setFieldErrors(errors);
    setSubmitError(null);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    try {
      const updated = await api.updateSample(sample.id, buildPayload());
      onSaved(updated);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal titleId="se-title" onClose={onClose}>
      <div className="modal-header">
        <h2 id="se-title" tabIndex={-1}>
          Editar muestra
        </h2>
        <button className="btn-ghost" onClick={onClose} aria-label="Cerrar">
          Cerrar
        </button>
      </div>

      <form
        className="movement-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="field">
          <label htmlFor="se-environ-id">ID Environ</label>
          <input id="se-environ-id" value={form.environId} onChange={(event) => set("environId", event.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="se-description">Descripción</label>
          <input
            id="se-description"
            value={form.description}
            onChange={(event) => set("description", event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="se-type">Tipo</label>
          <select id="se-type" value={form.type} onChange={(event) => set("type", event.target.value as SampleType)}>
            {SAMPLE_TYPE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {form.type === "otros" && (
          <div className="field">
            <label htmlFor="se-type-other">Especifica el tipo</label>
            <input
              id="se-type-other"
              value={form.typeOther}
              onChange={(event) => set("typeOther", event.target.value)}
            />
            {fieldErrors.typeOther && <p className="field-error">{fieldErrors.typeOther}</p>}
          </div>
        )}

        <div className="field">
          <label htmlFor="se-owner">Encargado</label>
          <select id="se-owner" value={form.ownerId} onChange={(event) => set("ownerId", event.target.value)}>
            {/* El encargado actual se ofrece aunque no sea seleccionable (p. ej. "sin
                encargado"), para que el select muestre lo que la muestra tiene hoy. */}
            {!ownerOptions.some((user) => user.id === sample.owner_id) && (
              <option value={sample.owner_id}>
                {currentOwner ? userOptionLabel(currentOwner) : "—"}
              </option>
            )}
            {ownerOptions.map((user) => (
              <option key={user.id} value={user.id}>
                {userOptionLabel(user)}
              </option>
            ))}
          </select>
          {fieldErrors.ownerId && <p className="field-error">{fieldErrors.ownerId}</p>}
        </div>

        <div className="field">
          <label htmlFor="se-passage">Pasaje</label>
          <input
            id="se-passage"
            type="number"
            value={form.passage}
            onChange={(event) => set("passage", event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="se-core">¿Pertenece al Núcleo Environ?</label>
          <select id="se-core" value={form.isCore} onChange={(event) => set("isCore", event.target.value as FormState["isCore"])}>
            <option value="">Sin dato</option>
            <option value="true">Si</option>
            <option value="false">No</option>
          </select>
          {fieldErrors.isCore && <p className="field-error">{fieldErrors.isCore}</p>}
        </div>

        <div className="field field--full">
          <label htmlFor="se-notes">Comentarios</label>
          <input id="se-notes" value={form.notes} onChange={(event) => set("notes", event.target.value)} />
        </div>

        <div className="field field--full">
          <label>Ubicación y estado</label>
          <p className="field-hint">
            {sample.location} · {sample.status === "active" ? "Activa" : "Retirada"} — se cambian registrando un
            movimiento, no desde acá, para no romper la trazabilidad.
          </p>
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
          <button type="submit" className="btn" disabled={saving || pristine}>
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
