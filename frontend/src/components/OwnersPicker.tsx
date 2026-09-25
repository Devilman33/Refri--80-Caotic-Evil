import type { UserRead } from "../api/types";
import { selectableUsers, userLabel } from "../utils/users";
import { userOptionLabel } from "./UserOptions";

export interface OwnersPickerProps {
  id: string;
  users: UserRead[];
  /** Iniciales de los encargados elegidos. */
  value: string[];
  onChange: (value: string[]) => void;
}

/**
 * Encargados de una muestra: una o varias personas (en el Excel, `AS/MN`). Las elegidas
 * se muestran como fichas que se pueden quitar; el desplegable agrega otra.
 */
export function OwnersPicker({ id, users, value, onChange }: OwnersPickerProps) {
  const byInitials = new Map(users.map((user) => [user.initials, user]));
  const available = selectableUsers(users).filter((user) => !value.includes(user.initials));

  return (
    <div className="owners-picker">
      {value.length > 0 && (
        <ul className="owners-chips" aria-label="Encargados elegidos">
          {value.map((initials) => {
            const user = byInitials.get(initials);
            const label = user ? userLabel(user) : initials;
            return (
              <li key={initials} className="owner-chip">
                {label}
                <button
                  type="button"
                  aria-label={`Quitar a ${label}`}
                  onClick={() => onChange(value.filter((entry) => entry !== initials))}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <select
        id={id}
        value=""
        onChange={(event) => {
          if (event.target.value) onChange([...value, event.target.value]);
        }}
      >
        <option value="">{value.length === 0 ? "Selecciona…" : "Agregar otro encargado…"}</option>
        {available.map((user) => (
          <option key={user.id} value={user.initials}>
            {userOptionLabel(user)}
          </option>
        ))}
      </select>
    </div>
  );
}
