import type { BoxType } from "../api/types";

export interface PositionPickerProps {
  boxType: BoxType;
  /** Posiciones ocupadas por una muestra activa (luz roja); el resto queda libre (luz verde). */
  occupied: ReadonlySet<string>;
  /** ID Environ de la muestra activa en cada posición ocupada, para el modo "occupied". */
  occupantLabels?: ReadonlyMap<string, string | null>;
  /** Posiciones cuya muestra activa es del Núcleo Environ. La regla de dominio exige el
   * warning "visible en todas las vistas" (.github/copilot-instructions.md), y esta grilla
   * era la única que no lo mostraba: el dato ya venía en `BoxPositionStatus.is_core` y se
   * descartaba. */
  corePositions?: ReadonlySet<string>;
  value: string | null;
  onChange: (position: string) => void;
  disabled?: boolean;
  /** "free" (congelamiento: solo se puede elegir una posición libre) u "occupied"
   * (descongelamiento: hay que elegir la muestra activa que se va a retirar). */
  selectMode?: "free" | "occupied";
}

const CARTON_ROWS = "ABCDEFGHI".split("");
const CARTON_COLUMNS = Array.from({ length: 9 }, (_, index) => index + 1);
const PLASTIC_POSITIONS = Array.from({ length: 100 }, (_, index) => String(index + 1));

function Cell({
  position,
  label,
  occupied,
  isCore,
  selected,
  disabled,
  title,
  onChange,
}: {
  position: string;
  label: string;
  occupied: boolean;
  isCore: boolean;
  selected: boolean;
  disabled: boolean;
  title?: string;
  onChange: (position: string) => void;
}) {
  const state = occupied ? "occupied" : "free";
  return (
    <button
      type="button"
      className={`position-cell position-cell--${state}${isCore ? " position-cell--core" : ""}${selected ? " position-cell--selected" : ""}`}
      aria-label={`Posición ${position}${occupied ? ", ocupada" : ", libre"}${isCore ? ", núcleo" : ""}`}
      aria-pressed={selected}
      title={title}
      disabled={disabled}
      onClick={() => onChange(position)}
    >
      {label}
    </button>
  );
}

/** Leyenda de la grilla: es la superficie donde la convención rojo/verde se enseña.
 * El visor 3D ya tenía una (`.bv-legend`); el formulario no. */
function Legend() {
  return (
    <div className="position-cell-legend">
      <span>
        <i className="legend-occupied" /> ocupada
      </span>
      <span>
        <i className="legend-free" /> libre
      </span>
      <span>
        <i className="legend-core" /> núcleo
      </span>
    </div>
  );
}

export function PositionPicker({
  boxType,
  occupied,
  occupantLabels,
  corePositions,
  value,
  onChange,
  disabled,
  selectMode = "free",
}: PositionPickerProps) {
  const positions = boxType === "carton_81" ? null : PLASTIC_POSITIONS;

  function isDisabled(isOccupied: boolean): boolean {
    if (disabled) return true;
    return selectMode === "free" ? isOccupied : !isOccupied;
  }

  function titleFor(position: string, isOccupied: boolean): string | undefined {
    if (!isOccupied) return undefined;
    const environId = occupantLabels?.get(position);
    return environId ? `ID Environ: ${environId}` : undefined;
  }

  if (boxType === "carton_81") {
    return (
      <>
      <div
        className="position-grid position-grid--carton"
        role="group"
        aria-label="Posición en la caja (81 espacios caja cartón)"
      >
        {CARTON_COLUMNS.map((column) =>
          CARTON_ROWS.map((row) => {
            const position = `${column}${row}`;
            const isOccupied = occupied.has(position);
            return (
              <Cell
                key={position}
                position={position}
                label={position}
                occupied={isOccupied}
                isCore={corePositions?.has(position) ?? false}
                selected={value === position}
                disabled={isDisabled(isOccupied)}
                title={titleFor(position, isOccupied)}
                onChange={onChange}
              />
            );
          }),
        )}
      </div>
      <Legend />
      </>
    );
  }

  return (
    <>
    <div
      className="position-grid position-grid--plastic"
      role="group"
      aria-label="Posición en la caja (100 espacios caja plástica)"
    >
      {(positions ?? PLASTIC_POSITIONS).map((position) => {
        const isOccupied = occupied.has(position);
        return (
          <Cell
            key={position}
            position={position}
            label={position}
            occupied={isOccupied}
            isCore={corePositions?.has(position) ?? false}
            selected={value === position}
            disabled={isDisabled(isOccupied)}
            title={titleFor(position, isOccupied)}
            onChange={onChange}
          />
        );
      })}
    </div>
    <Legend />
    </>
  );
}
