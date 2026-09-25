import { useRef, useState, type KeyboardEvent } from "react";
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
  /** Varias posiciones elegidas a la vez (retirar varias muestras). Se suman a `value`. */
  selectedSet?: ReadonlySet<string>;
  onChange: (position: string) => void;
  disabled?: boolean;
  /** "free" (congelamiento: solo se puede elegir una posición libre) u "occupied"
   * (descongelamiento: hay que elegir la muestra activa que se va a retirar). */
  selectMode?: "free" | "occupied";
}

const CARTON_ROWS = "ABCDEFGHI".split("");
const CARTON_COLUMNS = Array.from({ length: 9 }, (_, index) => index + 1);
const PLASTIC_POSITIONS = Array.from({ length: 100 }, (_, index) => String(index + 1));

/** Filas visuales de la grilla, de arriba hacia abajo. En cartón la columna es el número y
 * la fila la letra (`3B` = columna 3, fila B); en plástica, 10 por fila. */
const CARTON_LAYOUT = CARTON_ROWS.map((row) => CARTON_COLUMNS.map((column) => `${column}${row}`));
const PLASTIC_LAYOUT = Array.from({ length: 10 }, (_, row) => PLASTIC_POSITIONS.slice(row * 10, row * 10 + 10));

const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

function Cell({
  position,
  label,
  occupied,
  isCore,
  selected,
  disabled,
  tabbable,
  title,
  onChange,
  onFocus,
  buttonRef,
}: {
  position: string;
  label: string;
  occupied: boolean;
  isCore: boolean;
  selected: boolean;
  disabled: boolean;
  tabbable: boolean;
  title?: string;
  onChange: (position: string) => void;
  onFocus: (position: string) => void;
  buttonRef: (element: HTMLButtonElement | null) => void;
}) {
  const state = occupied ? "occupied" : "free";
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`position-cell position-cell--${state}${isCore ? " position-cell--core" : ""}${selected ? " position-cell--selected" : ""}`}
      aria-label={`Posición ${position}${occupied ? ", ocupada" : ", libre"}${isCore ? ", núcleo" : ""}`}
      aria-pressed={selected}
      title={title}
      disabled={disabled}
      tabIndex={tabbable ? 0 : -1}
      onClick={() => onChange(position)}
      onFocus={() => onFocus(position)}
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
  selectedSet,
  onChange,
  disabled,
  selectMode = "free",
}: PositionPickerProps) {
  const isCarton = boxType === "carton_81";
  const layout = isCarton ? CARTON_LAYOUT : PLASTIC_LAYOUT;
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [focused, setFocused] = useState<string | null>(null);

  function isDisabled(isOccupied: boolean): boolean {
    if (disabled) return true;
    return selectMode === "free" ? isOccupied : !isOccupied;
  }

  const enabled = (position: string) => !isDisabled(occupied.has(position));

  function titleFor(position: string, isOccupied: boolean): string | undefined {
    if (!isOccupied) return undefined;
    const environId = occupantLabels?.get(position);
    return environId ? `ID Environ: ${environId}` : undefined;
  }

  // Roving tabindex (docs/QOL.md §3): la grilla es UNA parada de Tab, no 81 o 100. Entra
  // por la posición elegida, o por la última enfocada, o por la primera habilitada; dentro
  // se recorre con flechas, Inicio y Fin, y Enter o Espacio elige.
  const flat = layout.flat();
  const tabStop = [value, focused, flat.find(enabled)].find((position) => position && enabled(position)) ?? null;

  function move(from: string, key: string): string | null {
    if (key === "Home") return flat.find(enabled) ?? null;
    if (key === "End") return [...flat].reverse().find(enabled) ?? null;
    const step = ARROWS[key];
    if (!step) return null;
    let row = layout.findIndex((cells) => cells.includes(from));
    let column = layout[row].indexOf(from);
    // Salta las posiciones deshabilitadas en la misma dirección, como una hoja de cálculo
    // que salta celdas bloqueadas; si no queda ninguna, el foco no se mueve.
    for (;;) {
      row += step[0];
      column += step[1];
      const next = layout[row]?.[column];
      if (next === undefined) return null;
      if (enabled(next)) return next;
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const from = (event.target as HTMLElement).dataset.position ?? focused;
    if (!from) return;
    const next = move(from, event.key);
    if (next === null) {
      if (event.key in ARROWS || event.key === "Home" || event.key === "End") event.preventDefault();
      return;
    }
    event.preventDefault();
    buttons.current.get(next)?.focus();
  }

  return (
    <>
      <div
        className={`position-grid position-grid--${isCarton ? "carton" : "plastic"}`}
        role="group"
        aria-label={
          isCarton ? "Posición en la caja (81 espacios caja cartón)" : "Posición en la caja (100 espacios caja plástica)"
        }
        onKeyDown={handleKeyDown}
      >
        {flat.map((position) => {
          const isOccupied = occupied.has(position);
          return (
            <Cell
              key={position}
              position={position}
              label={position}
              occupied={isOccupied}
              isCore={corePositions?.has(position) ?? false}
              selected={value === position || (selectedSet?.has(position) ?? false)}
              disabled={isDisabled(isOccupied)}
              tabbable={position === tabStop}
              title={titleFor(position, isOccupied)}
              onChange={onChange}
              onFocus={setFocused}
              buttonRef={(element) => {
                if (element) {
                  element.dataset.position = position;
                  buttons.current.set(position, element);
                } else buttons.current.delete(position);
              }}
            />
          );
        })}
      </div>
      <Legend />
    </>
  );
}
