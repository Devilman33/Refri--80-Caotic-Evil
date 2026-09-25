import { UNASSIGNED_INITIALS, type UserRead } from "../api/types";

/** Cómo se muestra una persona: su nombre completo si se registró con uno y, si no (las
 * que creó el importador desde el Excel), sus iniciales. */
export function userLabel(user: Pick<UserRead, "initials" | "name"> | undefined | null): string {
  if (!user) return "—";
  if (user.initials === UNASSIGNED_INITIALS) return "Sin encargado";
  return user.name?.trim() || user.initials;
}

/** Usuarios activos y seleccionables, ordenados por cómo se muestran. El centinela del
 * importador no es una persona y nunca aparece en una lista. */
export function selectableUsers(users: UserRead[]): UserRead[] {
  return users
    .filter((user) => user.active && user.initials !== UNASSIGNED_INITIALS)
    .sort((a, b) => userLabel(a).localeCompare(userLabel(b), "es"));
}
