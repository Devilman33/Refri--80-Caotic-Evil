export type HeaderViewMode = "table" | "3d" | "usage";

/** El subtítulo describe la vista activa. Antes decía "Vista tabla / lista" fijo, así que
 * mentía con el visor 3D o el % de uso en pantalla. */
const VIEW_SUBTITLES: Record<HeaderViewMode, string> = {
  table: "Vista tabla / lista",
  "3d": "Visor 3D del freezer",
  usage: "% de uso por sección, rack y subcaja",
};

export interface HeaderProps {
  theme: "light" | "dark";
  onToggleTheme: () => void;
  viewMode: HeaderViewMode;
}

export function Header({ theme, onToggleTheme, viewMode }: HeaderProps) {
  return (
    <header className="app-header">
      <div>
        <h1>Refri -80 · Inventario de muestras</h1>
        <div className="subtitle">{VIEW_SUBTITLES[viewMode]}</div>
      </div>
      <button className="btn-ghost" onClick={onToggleTheme}>
        {theme === "dark" ? "☀ Modo claro" : "☾ Modo oscuro"}
      </button>
    </header>
  );
}
