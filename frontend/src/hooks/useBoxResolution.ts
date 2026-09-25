import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { BoxPositionStatus, BoxType, RackRead } from "../api/types";
import { parseBoxName } from "../utils/positions";

export interface BoxResolution {
  /** `true` cuando la caja ya existe en la base. Si es `false` y el nombre es válido, se
   * creará con el primer movimiento. */
  boxExists: boolean;
  /** Tipo real de la caja existente; `carton_81` mientras no se sepa. */
  boxType: BoxType;
  occupied: ReadonlySet<string>;
  /** ID Environ de la muestra activa en cada posición ocupada. */
  occupantLabels: ReadonlyMap<string, string | null>;
  /** Posiciones cuya muestra activa es del Núcleo Environ. */
  corePositions: ReadonlySet<string>;
  positions: BoxPositionStatus[];
}

/**
 * Resuelve "Nombre Caja" (`A12`) a una caja concreta y al estado de sus posiciones.
 *
 * Extraído de `MovementForm` porque es la lógica que carga el peso, no `PositionPicker`:
 * la grilla necesita saber el tipo de caja y qué posiciones están ocupadas, y eso sale de
 * encadenar rack → listBoxes → getBoxPositions. Sin esto, cada pantalla que quiera elegir
 * una posición se arma su propia versión, peor.
 *
 * El debounce de 300 ms evita una consulta por tecla mientras se escribe el nombre.
 */
export function useBoxResolution(boxName: string, racks: RackRead[]): BoxResolution {
  const [boxExists, setBoxExists] = useState(false);
  const [boxType, setBoxType] = useState<BoxType>("carton_81");
  const [positions, setPositions] = useState<BoxPositionStatus[]>([]);

  useEffect(() => {
    const parsed = parseBoxName(boxName);
    const rack = parsed ? racks.find((entry) => entry.letter === parsed.rackLetter) : undefined;
    if (!parsed || !rack) {
      setBoxExists(false);
      setPositions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .listBoxes({ rack_id: rack.id })
        .then((boxes) => {
          if (cancelled) return null;
          const box = boxes.find((entry) => entry.number === parsed.boxNumber);
          if (!box) {
            setBoxExists(false);
            setPositions([]);
            return null;
          }
          setBoxExists(true);
          setBoxType(box.box_type);
          return api.getBoxPositions(box.id);
        })
        .then((loaded) => {
          if (!cancelled && loaded) setPositions(loaded);
        })
        .catch(() => {
          if (!cancelled) {
            setBoxExists(false);
            setPositions([]);
          }
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [boxName, racks]);

  const occupied = useMemo(
    () => new Set(positions.filter((entry) => entry.occupied).map((entry) => entry.position)),
    [positions],
  );
  const occupantLabels = useMemo(
    () => new Map(positions.filter((entry) => entry.occupied).map((entry) => [entry.position, entry.environ_id])),
    [positions],
  );
  const corePositions = useMemo(
    () => new Set(positions.filter((entry) => entry.occupied && entry.is_core).map((entry) => entry.position)),
    [positions],
  );

  return { boxExists, boxType, occupied, occupantLabels, corePositions, positions };
}
