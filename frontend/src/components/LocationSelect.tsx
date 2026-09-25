import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { BoxOccupancy, RackRead, SectionRead } from "../api/types";

/** Qué lugares se ofrecen según la tarea. */
export type LocationMode =
  /** Retirar: cajas con muestras activas. */
  | "with-samples"
  /** Congelar, trasladar o devolver una muestra: cajas con espacio, y lugares sin caja (caja nueva). */
  | "with-space"
  /** Mover una caja entera: lugares sin muestras (sin caja, o con una caja vacía). */
  | "empty-place";

export interface LocationValue {
  sectionCode: string;
  rackLetter: string;
  boxNumber: number | null;
}

export const EMPTY_LOCATION: LocationValue = { sectionCode: "", rackLetter: "", boxNumber: null };

/** Lo que el formulario necesita saber de la caja elegida. */
export interface ResolvedBox {
  rackLetter: string;
  sectionCode: string;
  boxNumber: number;
  /** `null` si en ese lugar todavía no hay caja registrada (se crea al guardar). */
  occupancy: BoxOccupancy | null;
}

export interface LocationSelectProps {
  idPrefix: string;
  mode: LocationMode;
  value: LocationValue;
  onChange: (value: LocationValue, box: ResolvedBox | null) => void;
  /** Caja que no se ofrece (p. ej. la misma que se está moviendo). */
  excludeBoxId?: number;
  /** Cambia para volver a pedir los datos (después de guardar). */
  reloadToken?: number;
  disabled?: boolean;
}

interface Option {
  number: number;
  label: string;
  occupancy: BoxOccupancy | null;
}

/**
 * Sección → Rack → Caja como listas, con solo los lugares que sirven para la tarea: nadie
 * tiene que acordarse ni escribir "F12". Las secciones y racks se deducen de lo que hay.
 */
export function LocationSelect({
  idPrefix,
  mode,
  value,
  onChange,
  excludeBoxId,
  reloadToken,
  disabled,
}: LocationSelectProps) {
  const [sections, setSections] = useState<SectionRead[]>([]);
  const [racks, setRacks] = useState<RackRead[]>([]);
  const [boxes, setBoxes] = useState<BoxOccupancy[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.listSections(), api.listRacks(), api.listBoxOccupancy()])
      .then(([loadedSections, loadedRacks, loadedBoxes]) => {
        if (cancelled) return;
        setSections(loadedSections);
        setRacks(loadedRacks);
        setBoxes(loadedBoxes);
      })
      .catch(() => {
        if (!cancelled) setBoxes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const sectionCodeById = useMemo(() => new Map(sections.map((section) => [section.id, section.code])), [sections]);

  /** Opciones de caja por rack, ya filtradas según el modo. */
  const optionsByRack = useMemo(() => {
    const map = new Map<string, Option[]>();
    for (const rack of racks) {
      const registered = (boxes ?? []).filter((box) => box.rack_id === rack.id && box.box_id !== excludeBoxId);
      const byNumber = new Map(registered.map((box) => [box.number, box]));
      const options: Option[] = [];
      for (let number = 1; number <= rack.capacity; number += 1) {
        const box = byNumber.get(number) ?? null;
        const code = `${rack.letter}${number}`;
        if (mode === "with-samples") {
          if (box && box.active > 0) options.push({ number, label: `${code} · ${box.active} de ${box.capacity} ocupadas`, occupancy: box });
        } else if (mode === "with-space") {
          if (!box) options.push({ number, label: `${code} · caja nueva`, occupancy: null });
          else if (box.active < box.capacity)
            options.push({ number, label: `${code} · ${box.capacity - box.active} libres de ${box.capacity}`, occupancy: box });
        } else if (!box || box.active === 0) {
          options.push({ number, label: `${code} · ${box ? "caja vacía" : "lugar libre"}`, occupancy: box });
        }
      }
      if (options.length > 0) map.set(rack.letter, options);
    }
    return map;
  }, [racks, boxes, mode, excludeBoxId]);

  const racksBySection = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const rack of racks) {
      const code = sectionCodeById.get(rack.section_id);
      if (!code || !optionsByRack.has(rack.letter)) continue;
      map.set(code, [...(map.get(code) ?? []), rack.letter].sort());
    }
    return map;
  }, [racks, sectionCodeById, optionsByRack]);

  const sectionOptions = ["I", "II", "III", "IV"].filter((code) => racksBySection.has(code));
  const rackOptions = racksBySection.get(value.sectionCode) ?? [];
  const boxOptions = optionsByRack.get(value.rackLetter) ?? [];

  function emit(next: LocationValue) {
    const option = (optionsByRack.get(next.rackLetter) ?? []).find((entry) => entry.number === next.boxNumber);
    onChange(
      next,
      option
        ? { rackLetter: next.rackLetter, sectionCode: next.sectionCode, boxNumber: option.number, occupancy: option.occupancy }
        : null,
    );
  }

  // Cuando llegan los datos, informar la caja de un valor que vino prellenado.
  useEffect(() => {
    if (boxes !== null && value.boxNumber !== null) emit(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxes, optionsByRack]);

  const loading = boxes === null;

  return (
    <>
      <div className="field">
        <label htmlFor={`${idPrefix}-section`}>Sección</label>
        <select
          id={`${idPrefix}-section`}
          value={value.sectionCode}
          disabled={disabled}
          onChange={(event) => emit({ sectionCode: event.target.value, rackLetter: "", boxNumber: null })}
        >
          <option value="">{loading ? "Cargando…" : "Selecciona…"}</option>
          {sectionOptions.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-rack`}>Rack</label>
        <select
          id={`${idPrefix}-rack`}
          value={value.rackLetter}
          disabled={disabled || !value.sectionCode}
          onChange={(event) => emit({ ...value, rackLetter: event.target.value, boxNumber: null })}
        >
          <option value="">Selecciona…</option>
          {rackOptions.map((letter) => (
            <option key={letter} value={letter}>
              {letter}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-box`}>Caja</label>
        <select
          id={`${idPrefix}-box`}
          value={value.boxNumber ?? ""}
          disabled={disabled || !value.rackLetter}
          onChange={(event) =>
            emit({ ...value, boxNumber: event.target.value === "" ? null : Number(event.target.value) })
          }
        >
          <option value="">Selecciona…</option>
          {boxOptions.map((option) => (
            <option key={option.number} value={option.number}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
