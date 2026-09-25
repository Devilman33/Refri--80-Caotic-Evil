import { useState } from "react";
import { api, ApiError } from "../api/client";
import type { UserRead } from "../api/types";
import { selectableUsers } from "../utils/users";
import { userOptionLabel } from "./UserOptions";

export interface LoginScreenProps {
  users: UserRead[];
  /** `null` mientras se cargan los usuarios. */
  loadError: string | null;
  onLogin: (user: UserRead) => void;
}

/**
 * Pantalla de entrada: cada persona elige quién es, o se registra con su nombre completo.
 *
 * Es identificación, no autenticación (docs/adr/0002-autenticacion.md): no hay
 * contraseña. Sirve para que nadie modifique por error las muestras de otra persona y
 * para que cada cambio quede con su autor.
 */
export function LoginScreen({ users, loadError, onLogin }: LoginScreenProps) {
  const options = selectableUsers(users);
  const [selected, setSelected] = useState("");
  const [registering, setRegistering] = useState(false);
  const [name, setName] = useState("");
  const [initials, setInitials] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function enter() {
    const user = options.find((entry) => String(entry.id) === selected);
    if (!user) {
      setError("Elige tu nombre de la lista");
      return;
    }
    onLogin(user);
  }

  async function register() {
    if (!name.trim()) {
      setError("Escribe tu nombre completo");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const user = await api.createUser({ name: name.trim(), initials: initials.trim() || null });
      onLogin(user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo registrar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="login">
      <div className="login-card panel">
        <img src="/environ-logo.png" alt="Environ" className="login-logo" />
        <h1>Refri -80 · Inventario de muestras</h1>

        {!registering ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              enter();
            }}
          >
            <div className="field">
              <label htmlFor="login-user">¿Quién eres?</label>
              <select id="login-user" value={selected} onChange={(event) => setSelected(event.target.value)} autoFocus>
                <option value="">Selecciona tu nombre…</option>
                {options.map((user) => (
                  <option key={user.id} value={user.id}>
                    {userOptionLabel(user)}
                  </option>
                ))}
              </select>
            </div>
            {loadError && (
              <p className="field-error" role="alert">
                {loadError}
              </p>
            )}
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn login-submit">
              Entrar
            </button>
            <p className="field-hint">
              ¿No estás en la lista?{" "}
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setRegistering(true);
                  setError(null);
                }}
              >
                Regístrate
              </button>
            </p>
          </form>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void register();
            }}
          >
            <div className="field">
              <label htmlFor="login-name">Nombre completo</label>
              <input id="login-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
            </div>
            <div className="field">
              <label htmlFor="login-initials">Iniciales (opcional)</label>
              <input
                id="login-initials"
                value={initials}
                maxLength={10}
                onChange={(event) => setInitials(event.target.value)}
                placeholder="Se calculan de tu nombre"
              />
              <p className="field-hint">Son las que aparecen en el Excel y en el Google Form (p. ej. GC).</p>
            </div>
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn login-submit" disabled={saving}>
              {saving ? "Registrando…" : "Registrarme y entrar"}
            </button>
            <p className="field-hint">
              <button type="button" className="link-button" onClick={() => setRegistering(false)}>
                Volver a la lista
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
