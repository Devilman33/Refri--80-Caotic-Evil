import type { UserRead } from "../api/types";
import { selectableUsers } from "../utils/users";

/** Nombre completo con las iniciales al lado (son la clave que usan el Excel y el Google
 * Form), o solo las iniciales si la persona no registró su nombre. */
export function userOptionLabel(user: Pick<UserRead, "initials" | "name">): string {
  const name = user.name?.trim();
  return name ? `${name} (${user.initials})` : user.initials;
}

/** Opciones de un `<select>` de personas. El valor de cada opción son las iniciales. */
export function UserOptions({ users, placeholder = "Selecciona…" }: { users: UserRead[]; placeholder?: string }) {
  return (
    <>
      <option value="">{placeholder}</option>
      {selectableUsers(users).map((user) => (
        <option key={user.id} value={user.initials}>
          {userOptionLabel(user)}
        </option>
      ))}
    </>
  );
}
