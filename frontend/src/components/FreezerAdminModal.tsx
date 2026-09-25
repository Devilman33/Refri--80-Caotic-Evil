import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import {
  RACK_SLOT_LABELS,
  type RackOccupancy,
  type RackRead,
  type RackSlot,
  type SectionRead,
  type UserRead,
} from "../api/types";
import { todayIso } from "../utils/format";
import { Modal } from "./Modal";
import { UserOptions } from "./UserOptions";

const SLOTS: RackSlot[] = ["center", "right"];
const LETTERS = Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index));

export interface FreezerAdminModalProps {
  users: UserRead[];
  sessionInitials: string;
  onClose: () => void;
  /** Después de cada cambio: la app recarga el visor y muestra el aviso. */
  onChanged: (notice: string) => void;
}

type Place = { sectionCode: string; slot: RackSlot };

/** Qué está haciendo el usuario en este momento; una sola tarea a la vez. */
type Task =
  | { kind: "move"; rack: RackRead }
  | { kind: "create"; place: Place }
  | { kind: "activate"; rack: RackRead }
  | null;

/**
 * Administrar la distribución del freezer: mover racks de estante (con intercambio si el
 * lugar está ocupado), dar de baja racks vacíos, crear racks nuevos en lugares libres y
 * reactivar los dados de baja. La letra de un rack no cambia al moverlo.
 */
export function FreezerAdminModal({ users, sessionInitials, onClose, onChanged }: FreezerAdminModalProps) {
  const [sections, setSections] = useState<SectionRead[]>([]);
  const [racks, setRacks] = useState<RackRead[] | null>(null);
  const [occupancy, setOccupancy] = useState<RackOccupancy[]>([]);
  const [task, setTask] = useState<Task>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    Promise.all([api.listSections(), api.listRacks({ include_inactive: true }), api.listRackOccupancy()])
      .then(([loadedSections, loadedRacks, loadedOccupancy]) => {
        setSections([...loadedSections].sort((a, b) => sectionOrder(a.code) - sectionOrder(b.code)));
        setRacks(loadedRacks);
        setOccupancy(loadedOccupancy);
      })
      .catch(() => setError("No se pudo cargar la distribución del freezer"));
  }, []);

  useEffect(load, [load]);

  const sectionCodeById = useMemo(() => new Map(sections.map((section) => [section.id, section.code])), [sections]);
  const activeByRack = useMemo(() => new Map(occupancy.map((rack) => [rack.rack_id, rack.active])), [occupancy]);
  const racksInUse = (racks ?? []).filter((rack) => rack.active);
  const inactive = (racks ?? []).filter((rack) => !rack.active);
  const usedLetters = new Set((racks ?? []).map((rack) => rack.letter));
  const freeLetters = LETTERS.filter((letter) => !usedLetters.has(letter));

  function rackAt(place: Place): RackRead | undefined {
    return racksInUse.find((rack) => rack.slot === place.slot && sectionCodeById.get(rack.section_id) === place.sectionCode);
  }

  const freePlaces: Place[] = sections.flatMap((section) =>
    SLOTS.map((slot) => ({ sectionCode: section.code, slot })).filter((place) => !rackAt(place)),
  );

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError(null);
    try {
      const notice = await action();
      setTask(null);
      load();
      onChanged(notice);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el cambio");
    } finally {
      setBusy(false);
    }
  }

  function deactivate(rack: RackRead) {
    void run(async () => {
      await api.deactivateRack(rack.id);
      return `Rack ${rack.letter} dado de baja. Su historial se conserva y su lugar quedó libre.`;
    });
  }

  return (
    <Modal titleId="fa-title" onClose={onClose} wide>
      <div className="modal-header">
        <h2 id="fa-title" tabIndex={-1}>
          Administrar freezer
        </h2>
        <button className="btn-ghost" onClick={onClose} aria-label="Cerrar">
          Cerrar
        </button>
      </div>
      <p className="field-hint">
        Cada estante tiene dos lugares, centro y derecha. Mover un rack lleva con él todas sus cajas y muestras, y
        queda registrado en el historial de cada una.
      </p>

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {racks === null && !error && <p>Cargando…</p>}

      {racks !== null && (
        <table className="samples-table freezer-admin">
          <thead>
            <tr>
              <th>Estante</th>
              {SLOTS.map((slot) => (
                <th key={slot}>{RACK_SLOT_LABELS[slot]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sections.map((section) => (
              <tr key={section.id}>
                <th scope="row">{section.code}</th>
                {SLOTS.map((slot) => {
                  const place = { sectionCode: section.code, slot };
                  const rack = rackAt(place);
                  const active = rack ? (activeByRack.get(rack.id) ?? 0) : 0;
                  return (
                    <td key={slot}>
                      {rack ? (
                        <div className="freezer-admin__rack">
                          <span className="freezer-admin__letter">{rack.letter}</span>
                          <span className="field-hint">
                            {active} {active === 1 ? "muestra" : "muestras"}
                          </span>
                          <div className="freezer-admin__actions">
                            <button type="button" className="btn-ghost" onClick={() => setTask({ kind: "move", rack })}>
                              Mover
                            </button>
                            <button
                              type="button"
                              className="btn-ghost"
                              disabled={active > 0 || busy}
                              title={active > 0 ? "Solo se puede dar de baja un rack sin muestras activas" : undefined}
                              onClick={() => deactivate(rack)}
                            >
                              Dar de baja
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button type="button" className="btn-ghost" onClick={() => setTask({ kind: "create", place })}>
                          + Nuevo rack
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {inactive.length > 0 && (
        <section className="freezer-admin__inactive">
          <h3>Dados de baja</h3>
          <ul>
            {inactive.map((rack) => (
              <li key={rack.id}>
                Rack <b>{rack.letter}</b>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={freePlaces.length === 0}
                  title={freePlaces.length === 0 ? "No hay lugares libres" : undefined}
                  onClick={() => setTask({ kind: "activate", rack })}
                >
                  Reactivar
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {task?.kind === "move" && (
        <RackMoveForm
          key={task.rack.id}
          rack={task.rack}
          from={{ sectionCode: sectionCodeById.get(task.rack.section_id) ?? "?", slot: task.rack.slot ?? "center" }}
          sections={sections}
          rackAt={rackAt}
          users={users}
          sessionInitials={sessionInitials}
          busy={busy}
          onCancel={() => setTask(null)}
          onSubmit={(payload, occupant) =>
            run(async () => {
              const result = await api.moveRack(task.rack.id, payload);
              const where = `${payload.section_code} · ${RACK_SLOT_LABELS[payload.slot].toLowerCase()}`;
              const swapped = occupant ? ` y el rack ${occupant.letter} pasó a su lugar anterior` : "";
              return `Rack ${task.rack.letter} movido a ${where}${swapped} (${result.moved_samples} muestras actualizadas).`;
            })
          }
        />
      )}

      {task?.kind === "create" && (
        <PlaceForm
          title={`Nuevo rack en ${task.place.sectionCode} · ${RACK_SLOT_LABELS[task.place.slot].toLowerCase()}`}
          busy={busy}
          letters={freeLetters}
          onCancel={() => setTask(null)}
          onSubmit={(letter, capacity) =>
            run(async () => {
              const section = sections.find((entry) => entry.code === task.place.sectionCode)!;
              await api.createRack({ section_id: section.id, letter, slot: task.place.slot, capacity });
              return `Rack ${letter} creado en ${task.place.sectionCode} · ${RACK_SLOT_LABELS[task.place.slot].toLowerCase()}.`;
            })
          }
        />
      )}

      {task?.kind === "activate" && (
        <ActivateForm
          rack={task.rack}
          places={freePlaces}
          busy={busy}
          onCancel={() => setTask(null)}
          onSubmit={(place) =>
            run(async () => {
              await api.activateRack(task.rack.id, { section_code: place.sectionCode, slot: place.slot });
              return `Rack ${task.rack.letter} reactivado en ${place.sectionCode} · ${RACK_SLOT_LABELS[place.slot].toLowerCase()}.`;
            })
          }
        />
      )}
    </Modal>
  );
}

function sectionOrder(code: string): number {
  const index = ["I", "II", "III", "IV"].indexOf(code);
  return index === -1 ? 99 : index;
}

function placeKey(place: Place): string {
  return `${place.sectionCode}|${place.slot}`;
}

function RackMoveForm({
  rack,
  from,
  sections,
  rackAt,
  users,
  sessionInitials,
  busy,
  onCancel,
  onSubmit,
}: {
  rack: RackRead;
  from: Place;
  sections: SectionRead[];
  rackAt: (place: Place) => RackRead | undefined;
  users: UserRead[];
  sessionInitials: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (
    payload: Parameters<typeof api.moveRack>[1],
    occupant: RackRead | undefined,
  ) => void;
}) {
  const places = sections
    .flatMap((section) => SLOTS.map((slot) => ({ sectionCode: section.code, slot })))
    .filter((place) => placeKey(place) !== placeKey(from));
  const [target, setTarget] = useState("");
  const [date, setDate] = useState(todayIso);
  const [operator, setOperator] = useState(sessionInitials);
  const [note, setNote] = useState("");
  const [confirmSwap, setConfirmSwap] = useState(false);

  const place = places.find((entry) => placeKey(entry) === target);
  const occupant = place ? rackAt(place) : undefined;
  const ready = Boolean(place && operator && date && (!occupant || confirmSwap));

  return (
    <form
      className="movement-form freezer-admin__task"
      aria-label={`Mover rack ${rack.letter}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (!place || !ready) return;
        onSubmit(
          {
            section_code: place.sectionCode,
            slot: place.slot,
            swap: Boolean(occupant),
            date,
            operator_initials: operator,
            note: note.trim() || null,
          },
          occupant,
        );
      }}
    >
      <h3 className="field--full">
        Mover rack {rack.letter} <small>desde {from.sectionCode} · {RACK_SLOT_LABELS[from.slot].toLowerCase()}</small>
      </h3>
      <div className="field">
        <label htmlFor="rm-target">Destino</label>
        <select
          id="rm-target"
          value={target}
          onChange={(event) => {
            setTarget(event.target.value);
            setConfirmSwap(false);
          }}
        >
          <option value="">Selecciona…</option>
          {places.map((entry) => {
            const there = rackAt(entry);
            return (
              <option key={placeKey(entry)} value={placeKey(entry)}>
                {entry.sectionCode} · {RACK_SLOT_LABELS[entry.slot].toLowerCase()}
                {there ? ` (ocupado por ${there.letter})` : " (libre)"}
              </option>
            );
          })}
        </select>
      </div>
      <div className="field">
        <label htmlFor="rm-date">Fecha</label>
        <input id="rm-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="rm-operator">Operador (a)</label>
        <select id="rm-operator" value={operator} onChange={(event) => setOperator(event.target.value)}>
          <UserOptions users={users} />
        </select>
      </div>
      <div className="field">
        <label htmlFor="rm-note">Motivo (opcional)</label>
        <input id="rm-note" value={note} maxLength={255} onChange={(event) => setNote(event.target.value)} />
      </div>
      {occupant && (
        <label className="field--full freezer-admin__swap">
          <input type="checkbox" checked={confirmSwap} onChange={(event) => setConfirmSwap(event.target.checked)} />
          Ese lugar lo ocupa el rack <b>{occupant.letter}</b>: intercambiarlos ({occupant.letter} pasa a{" "}
          {from.sectionCode} · {RACK_SLOT_LABELS[from.slot].toLowerCase()}).
        </label>
      )}
      <div className="form-actions field--full">
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
        <button type="submit" className="btn" disabled={!ready || busy}>
          {busy ? "Moviendo…" : occupant ? "Intercambiar racks" : "Mover rack"}
        </button>
      </div>
    </form>
  );
}

function PlaceForm({
  title,
  letters,
  busy,
  onCancel,
  onSubmit,
}: {
  title: string;
  letters: string[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (letter: string, capacity: number) => void;
}) {
  const [letter, setLetter] = useState(letters[0] ?? "");
  const [capacity, setCapacity] = useState("20");
  return (
    <form
      className="movement-form freezer-admin__task"
      aria-label={title}
      onSubmit={(event) => {
        event.preventDefault();
        if (letter && Number(capacity) > 0) onSubmit(letter, Number(capacity));
      }}
    >
      <h3 className="field--full">{title}</h3>
      <div className="field">
        <label htmlFor="nr-letter">Letra</label>
        <select id="nr-letter" value={letter} onChange={(event) => setLetter(event.target.value)}>
          {letters.map((entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="nr-capacity">Capacidad (cajas)</label>
        <input
          id="nr-capacity"
          type="number"
          min={1}
          value={capacity}
          onChange={(event) => setCapacity(event.target.value)}
        />
      </div>
      <div className="form-actions field--full">
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
        <button type="submit" className="btn" disabled={busy || !letter}>
          Crear rack
        </button>
      </div>
    </form>
  );
}

function ActivateForm({
  rack,
  places,
  busy,
  onCancel,
  onSubmit,
}: {
  rack: RackRead;
  places: Place[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (place: Place) => void;
}) {
  const [target, setTarget] = useState(places[0] ? placeKey(places[0]) : "");
  const place = places.find((entry) => placeKey(entry) === target);
  return (
    <form
      className="movement-form freezer-admin__task"
      aria-label={`Reactivar rack ${rack.letter}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (place) onSubmit(place);
      }}
    >
      <h3 className="field--full">Reactivar rack {rack.letter}</h3>
      <div className="field">
        <label htmlFor="ra-place">Lugar</label>
        <select id="ra-place" value={target} onChange={(event) => setTarget(event.target.value)}>
          {places.map((entry) => (
            <option key={placeKey(entry)} value={placeKey(entry)}>
              {entry.sectionCode} · {RACK_SLOT_LABELS[entry.slot].toLowerCase()}
            </option>
          ))}
        </select>
      </div>
      <div className="form-actions field--full">
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
        <button type="submit" className="btn" disabled={busy || !place}>
          Reactivar
        </button>
      </div>
    </form>
  );
}
