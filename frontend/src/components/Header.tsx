import { useEffect, useId, useRef, useState, type ReactNode } from "react";
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
  /** Racks y estantes: mover, dar de baja, crear (parte 3). */
  onOpenFreezerAdmin: () => void;
  onLogout: () => void;
  /** Buscador global (docs/PLAN_FRONTEND.md, D1). */
  search: ReactNode;
  onFreeze: () => void;
  onThaw: () => void;
  /** "Mis muestras": muestras activas de la persona de la sesión (propias y compartidas). */
  myCount: number | null;
  myFilterActive: boolean;
  onToggleMine: () => void;
  alertCount: number;
  alertsOpen: boolean;
  onToggleAlerts: () => void;
}

/** Usuarios, tema y cambio de usuario se usan poco: van a un menú para no competir con las
 * tareas de todos los días (congelar, descongelar, buscar). */
function UserMenu({
  sessionUser,
  theme,
  onToggleTheme,
  onOpenUsers,
  onOpenFreezerAdmin,
  onLogout,
}: Pick<HeaderProps, "sessionUser" | "theme" | "onToggleTheme" | "onOpenUsers" | "onOpenFreezerAdmin" | "onLogout">) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function run(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div className="user-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="btn-ghost session-chip"
        aria-expanded={open}
        aria-controls={menuId}
        title={`Iniciales: ${sessionUser.initials}`}
        onClick={() => setOpen((value) => !value)}
      >
        {userLabel(sessionUser)} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div id={menuId} className="user-menu__list" role="group" aria-label="Menú de usuario">
          <button type="button" onClick={() => run(onOpenUsers)}>
            Usuarios
          </button>
          <button type="button" onClick={() => run(onOpenFreezerAdmin)}>
            Administrar freezer
          </button>
          <button type="button" onClick={() => run(onToggleTheme)}>
            {theme === "dark" ? "Modo claro" : "Modo oscuro"}
          </button>
          <button type="button" onClick={() => run(onLogout)}>
            Cambiar usuario
          </button>
        </div>
      )}
    </div>
  );
}

export function Header(props: HeaderProps) {
  const { viewMode, search, onFreeze, onThaw, alertCount, alertsOpen, onToggleAlerts, myCount, myFilterActive, onToggleMine } =
    props;
  return (
    <header className="app-header">
      <div className="app-brand">
        <img src="/environ-logo.png" alt="Environ" />
        <div>
          <h1>Refri -80</h1>
          <div className="subtitle">{VIEW_SUBTITLES[viewMode]}</div>
        </div>
      </div>
      <div className="app-header__search">{search}</div>
      <div className="header-actions">
        <button
          type="button"
          className={`btn mine-btn${myFilterActive ? " on" : ""}`}
          aria-pressed={myFilterActive}
          onClick={onToggleMine}
        >
          <span aria-hidden="true">★</span> Mis muestras
          {myCount !== null && <span className="mine-btn__count">{myCount}</span>}
        </button>
        <button type="button" className="btn" onClick={onFreeze}>
          + Congelar
        </button>
        <button type="button" className="btn btn-thaw" onClick={onThaw}>
          − Descongelar
        </button>
        {alertCount > 0 && (
          <button
            type="button"
            className={`btn-ghost alerts-toggle${alertsOpen ? " on" : ""}`}
            aria-expanded={alertsOpen}
            onClick={onToggleAlerts}
          >
            <span aria-live="polite">⚠ {alertCount} alertas</span>
          </button>
        )}
        <UserMenu {...props} />
      </div>
    </header>
  );
}
