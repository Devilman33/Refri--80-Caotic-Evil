import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import type { BoxPositionStatus, BoxType, PositionConflict, SampleWithLocation, UserRead } from "../api/types";
import { todayIso } from "../utils/format";
import { EMPTY_LOCATION, LocationSelect, type LocationValue, type ResolvedBox } from "./LocationSelect";
import { Modal } from "./Modal";
import { PositionPicker } from "./PositionPicker";
import { UserOptions } from "./UserOptions";

export interface ReturnModalProps {
  sample: SampleWithLocation;
  users: UserRead[];
  sessionInitials: string;
  onClose: () => void;
  onReturned: (sample: SampleWithLocation, summary: string) => void;
}

/**
 * Devolver al freezer una muestra retirada: se sacó por error, o el tubo vuelve después de
 * usarse en parte. Es la misma muestra con su historial, y queda un evento de reingreso.
 * Por defecto vuelve a su lugar de antes; si se ocupó, se ofrece el siguiente libre de la
 * misma caja u otro lugar.
 */
export function ReturnModal({ sample, users, sessionInitials, onClose, onReturned }: ReturnModalProps) {
  const [mode, setMode] = useState<"same" | "other">("same");
  const [date, setDate] = useState(todayIso);
  const [operator, setOperator] = useState(sessionInitials);
  const [note, setNote] = useState("");
  const [conflict, setConflict] = useState<PositionConflict | null>(null);
  const [location, setLocation] = useState<LocationValue>(EMPTY_LOCATION);
  const [box, setBox] = useState<ResolvedBox | null>(null);
  const [newBoxType, setNewBoxType] = useState<BoxType>("carton_81");
  const [positions, setPositions] = useState<BoxPositionStatus[]>([]);
  const [position, setPosition] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const boxId = box?.occupancy?.box_id ?? null;
  useEffect(() => {
    setPosition("");
    if (boxId === null) {
      setPositions([]);
      return;
    }
    let cancelled = false;
    api
      .getBoxPositions(boxId)
      .then((loaded) => {
        if (!cancelled) setPositions(loaded);
      })
      .catch(() => {
        if (!cancelled) setPositions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [boxId]);

  const occupied = useMemo(() => new Set(positions.filter((entry) => entry.occupied).map((entry) => entry.position)), [positions]);
  const boxType: BoxType = box?.occupancy?.box_type ?? newBoxType;

  async function send(target?: { rack_letter: string; box_number: number; position: string }) {
    setSaving(true);
    setError(null);
    try {
      const result = await api.returnSample(sample.id, {
        date,
        operator_initials: operator,
        note: note.trim() || null,
        ...(target ?? {}),
      });
      onReturned(result.sample, `Muestra devuelta al refri: ${result.sample.environ_id ?? "sin ID"} en ${result.sample.location}.`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.detail && typeof err.detail === "object") {
        setConflict(err.detail as PositionConflict);
      } else {
        setError(err instanceof ApiError ? err.message : "No se pudo devolver la muestra");
      }
    } finally {
      setSaving(false);
    }
  }

  function submit() {
    if (!date || !operator) {
      setError("Indica la fecha y el operador");
      return;
    }
    if (mode === "same") {
      void send();
      return;
    }
    if (!box || !position) {
      setError("Elige la caja y la posición");
      return;
    }
    void send({ rack_letter: box.rackLetter, box_number: box.boxNumber, position });
  }

  return (
    <Modal titleId="rt-title" onClose={onClose}>
      <div className="modal-header">
        <h2 id="rt-title" tabIndex={-1}>
          Devolver al refri
        </h2>
        <button className="btn-ghost" onClick={onClose} aria-label="Cerrar">
          Cerrar
        </button>
      </div>
      <p className="field-hint">
        <strong>{sample.environ_id ?? `Muestra #${sample.id}`}</strong> estaba en {sample.location}. Vuelve a estar activa,
        con todo su historial.
      </p>

      <form
        className="movement-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <fieldset className="field field--full return-mode">
          <legend>¿Dónde vuelve?</legend>
          <label>
            <input type="radio" checked={mode === "same"} onChange={() => setMode("same")} /> A su lugar de antes (
            {sample.location})
          </label>
          <label>
            <input type="radio" checked={mode === "other"} onChange={() => setMode("other")} /> A otro lugar
          </label>
        </fieldset>

        {mode === "same" && conflict && (
          <p className="field-error field--full" role="alert">
            {conflict.message}.{" "}
            {conflict.next_free_position && sample.rack_letter && sample.box_number !== undefined && (
              <button
                type="button"
                className="btn-ghost"
                onClick={() =>
                  void send({
                    rack_letter: sample.rack_letter!,
                    box_number: sample.box_number!,
                    position: conflict.next_free_position!,
                  })
                }
              >
                Usar la siguiente libre de la misma caja ({conflict.next_free_position})
              </button>
            )}
          </p>
        )}

        {mode === "other" && (
          <>
            <LocationSelect
              idPrefix="rt"
              mode="with-space"
              value={location}
              onChange={(next, resolved) => {
                setLocation(next);
                setBox(resolved);
              }}
            />
            {box && box.occupancy === null && (
              <div className="field">
                <label htmlFor="rt-box-type">Tipo de la caja nueva</label>
                <select id="rt-box-type" value={newBoxType} onChange={(event) => setNewBoxType(event.target.value as BoxType)}>
                  <option value="carton_81">Cartón (9×9)</option>
                  <option value="plastic_100">Plástica (10×10)</option>
                </select>
              </div>
            )}
            {box && (
              <div className="field field--full">
                <label>Posición</label>
                <PositionPicker
                  boxType={boxType}
                  occupied={occupied}
                  value={position || null}
                  onChange={setPosition}
                  selectMode="free"
                />
              </div>
            )}
          </>
        )}

        <div className="field">
          <label htmlFor="rt-date">Fecha</label>
          <input id="rt-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="rt-operator">Operador (a)</label>
          <select id="rt-operator" value={operator} onChange={(event) => setOperator(event.target.value)}>
            <UserOptions users={users} />
          </select>
        </div>
        <div className="field field--full">
          <label htmlFor="rt-note">Motivo (opcional)</label>
          <input
            id="rt-note"
            value={note}
            maxLength={255}
            placeholder="p. ej. se sacó por error, sobró después de usarla"
            onChange={(event) => setNote(event.target.value)}
          />
        </div>

        {error && (
          <p className="field-error field--full" role="alert">
            {error}
          </p>
        )}

        <div className="form-actions field--full">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? "Devolviendo…" : "Devolver al refri"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
