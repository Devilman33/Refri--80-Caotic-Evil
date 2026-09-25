import { useState } from "react";
import { api, ApiError } from "../api/client";
import { UNASSIGNED_INITIALS, type UserRead } from "../api/types";
import { userLabel } from "../utils/users";
import { Modal } from "./Modal";

export interface UsersModalProps {
  users: UserRead[];
  onClose: () => void;
  /** Se llama después de cada cambio para que la app recargue la lista. */
  onChanged: () => void;
}

interface Draft {
  name: string;
  initials: string;
}

/**
 * Personas del laboratorio: agregar nuevas, completar el nombre de las que vinieron del
 * Excel solo con iniciales, y desactivar a quien ya no está. Nunca se borran: tienen
 * muestras y movimientos asociados.
 */
export function UsersModal({ users, onClose, onChanged }: UsersModalProps) {
  const people = users
    .filter((user) => user.initials !== UNASSIGNED_INITIALS)
    .sort((a, b) => Number(b.active) - Number(a.active) || userLabel(a).localeCompare(userLabel(b), "es"));
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: "", initials: "" });
  const [newUser, setNewUser] = useState<Draft>({ name: "", initials: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    if (!newUser.name.trim()) {
      setError("Escribe el nombre completo");
      return;
    }
    const ok = await run(() =>
      api.createUser({ name: newUser.name.trim(), initials: newUser.initials.trim() || null }),
    );
    if (ok) setNewUser({ name: "", initials: "" });
  }

  async function save(user: UserRead) {
    const ok = await run(() =>
      api.updateUser(user.id, {
        name: draft.name.trim() || null,
        ...(draft.initials.trim() && draft.initials.trim().toUpperCase() !== user.initials
          ? { initials: draft.initials.trim() }
          : {}),
      }),
    );
    if (ok) setEditingId(null);
  }

  return (
    <Modal titleId="users-title" onClose={onClose} wide>
      <div className="modal-header">
        <h2 id="users-title" tabIndex={-1}>
          Usuarios
        </h2>
        <button className="btn-ghost" onClick={onClose} aria-label="Cerrar">
          Cerrar
        </button>
      </div>

      <form
        className="users-add"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <div className="field">
          <label htmlFor="new-user-name">Nombre completo</label>
          <input
            id="new-user-name"
            value={newUser.name}
            onChange={(event) => setNewUser((current) => ({ ...current, name: event.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor="new-user-initials">Iniciales (opcional)</label>
          <input
            id="new-user-initials"
            value={newUser.initials}
            maxLength={10}
            onChange={(event) => setNewUser((current) => ({ ...current, initials: event.target.value }))}
          />
        </div>
        <button type="submit" className="btn" disabled={busy}>
          Agregar usuario
        </button>
      </form>

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      <div className="table-wrap">
        <table className="samples-table users-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Iniciales</th>
              <th>Estado</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {people.map((user) =>
              editingId === user.id ? (
                <tr key={user.id}>
                  <td>
                    <input
                      aria-label={`Nombre de ${user.initials}`}
                      value={draft.name}
                      onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`Iniciales de ${user.initials}`}
                      value={draft.initials}
                      maxLength={10}
                      onChange={(event) => setDraft((current) => ({ ...current, initials: event.target.value }))}
                    />
                  </td>
                  <td>{user.active ? "Activo" : "Inactivo"}</td>
                  <td className="users-actions">
                    <button type="button" className="btn" disabled={busy} onClick={() => void save(user)}>
                      Guardar
                    </button>
                    <button type="button" className="btn-ghost" onClick={() => setEditingId(null)}>
                      Cancelar
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={user.id} className={user.active ? undefined : "is-inactive"}>
                  <td>{user.name ?? <span className="field-hint">Sin nombre registrado</span>}</td>
                  <td>
                    <code>{user.initials}</code>
                  </td>
                  <td>{user.active ? "Activo" : "Inactivo"}</td>
                  <td className="users-actions">
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => {
                        setEditingId(user.id);
                        setDraft({ name: user.name ?? "", initials: user.initials });
                      }}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={busy}
                      onClick={() => void run(() => api.updateUser(user.id, { active: !user.active }))}
                    >
                      {user.active ? "Desactivar" : "Reactivar"}
                    </button>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
