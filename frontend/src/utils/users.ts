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

/** Los encargados de una muestra, en el orden en que vienen. */
export function ownersOf(sample: { owner_ids: number[] }, users: UserRead[]): UserRead[] {
  const byId = new Map(users.map((user) => [user.id, user]));
  return sample.owner_ids.map((id) => byId.get(id)).filter((user): user is UserRead => user !== undefined);
}

/** "Ana Soto y MN", "Ana Soto, MN y GC". */
export function ownersLabel(owners: Pick<UserRead, "initials" | "name">[]): string {
  const labels = owners.map(userLabel);
  if (labels.length === 0) return "—";
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} y ${labels[labels.length - 1]}`;
}

/** Espejo de `ensure_can_modify` (backend/app/services/permissions.py): solo sus
 * encargados (cualquiera, si son varios) editan, trasladan o retiran una muestra, salvo
 * las que no tienen encargado. La página lo usa para no ofrecer lo que el backend va a
 * rechazar. */
export function canModifySample(
  sample: { owner_ids: number[] },
  owners: Pick<UserRead, "initials">[],
  sessionUser: Pick<UserRead, "id"> | null,
): boolean {
  if (!sessionUser) return false;
  if (sample.owner_ids.includes(sessionUser.id)) return true;
  return sample.owner_ids.length === 0 || owners.some((owner) => owner.initials === UNASSIGNED_INITIALS);
}
