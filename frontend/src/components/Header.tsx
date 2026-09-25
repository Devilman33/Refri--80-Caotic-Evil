import type { UserRead } from "../api/types";
import { userLabel } from "../utils/users";

export type HeaderViewMode = "table" | "3d" | "usage" | "anomalies";

/** El subtítulo describe la vista activa. Antes decía "Vista tabla / lista" fijo, así que
 * mentía con el visor 3D o el % de uso en pantalla. */
const VIEW_SUBTITLES: Record<HeaderViewMode, string> = {
  table: "Vista tabla / lista",
  "3d": "Visor 3D del freezer",
  usage: "% de uso por sección, rack y subcaja",
  anomalies: "Anomalías del importador",
};

export interface HeaderProps {
  theme: "light" | "dark";
  onToggleTheme: () => void;
  viewMode: HeaderViewMode;
  sessionUser: UserRead;
  onOpenUsers: () => void;
  onLogout: () => void;
}

export function Header({ theme, onToggleTheme, viewMode, sessionUser, onOpenUsers, onLogout }: HeaderProps) {
  return (
    <header className="app-header">
      <div className="app-brand">
        <img src="/environ-logo.png" alt="Environ" />
        <div>
          <h1>Refri -80 · Inventario de muestras</h1>
          <div className="subtitle">{VIEW_SUBTITLES[viewMode]}</div>
        </div>
      </div>
      <div className="header-actions">
        <span className="session-chip" title={`Iniciales: ${sessionUser.initials}`}>
          {userLabel(sessionUser)}
        </span>
        <button className="btn-ghost" onClick={onLogout}>
          Cambiar usuario
        </button>
        <button className="btn-ghost" onClick={onOpenUsers}>
          Usuarios
        </button>
        <button className="btn-ghost" onClick={onToggleTheme}>
          {theme === "dark" ? "☀ Modo claro" : "☾ Modo oscuro"}
        </button>
      </div>
    </header>
  );
}
