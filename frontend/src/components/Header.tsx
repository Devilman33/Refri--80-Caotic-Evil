export interface HeaderProps {
  theme: "light" | "dark";
  onToggleTheme: () => void;
}

export function Header({ theme, onToggleTheme }: HeaderProps) {
  return (
    <header className="app-header">
      <div>
        <h1>Refri -80 · Inventario de muestras</h1>
        <div className="subtitle">Vista tabla / lista</div>
      </div>
      <button className="btn-ghost" onClick={onToggleTheme}>
        {theme === "dark" ? "☀ Modo claro" : "☾ Modo oscuro"}
      </button>
    </header>
  );
}
