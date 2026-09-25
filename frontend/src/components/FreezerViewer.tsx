import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import type { BoxOccupancy, BoxType, RackOccupancy } from "../api/types";
import {
  mapPositionsToLights,
  type PositionLight,
} from "../three/boxPositionLights";
import {
  boxCode,
  buildFreezerLayout,
  lidGrid,
  parseViewerQuery,
  rackBoxSlots,
  rackPisos,
  RACK_GRID_COLUMNS,
  type FreezerLayout,
  type LayoutRack,
  type RackBoxSlot,
} from "../three/freezerLayout";
import {
  createFreezerScene,
  sectionDescription,
  type BoxRef,
  type DoorState,
  type FreezerScene,
  type LidState,
} from "../three/freezerScene";
import { positionOrder } from "../utils/positions";
import { FreezerUsagePanel } from "./FreezerUsagePanel";

export interface FreePositionSelection {
  sectionCode: string;
  rackLetter: string;
  /** null si la subcaja todavía no está registrada: se crea con el primer congelamiento. */
  boxId: number | null;
  boxNumber: number;
  boxType: BoxType;
  position: string;
}

export interface OccupiedPositionSelection {
  sampleId: number;
  sectionCode: string;
  rackLetter: string;
  boxId: number;
  boxNumber: number;
  boxType: BoxType;
  position: string;
}

export interface FreezerFocusTarget {
  boxId: number;
  /** Posición a resaltar; null para solo enfocar la subcaja (p. ej. desde la vista de % de uso). */
  position: string | null;
  /** Se cambia en cada click para poder re-enfocar la misma caja/posición. */
  token: number;
}

export interface BoxMoveRequest {
  boxId: number;
  /** Lugar actual legible, p. ej. `I · A3`. */
  label: string;
  active: number;
}

export interface FreezerViewerProps {
  focusTarget?: FreezerFocusTarget | null;
  onSelectFreePosition: (selection: FreePositionSelection) => void;
  onSelectOccupiedPosition: (selection: OccupiedPositionSelection) => void;
  /** "Mover caja": traslada la subcaja seleccionada con todas sus muestras. */
  onMoveBox?: (request: BoxMoveRequest) => void;
  /** Cambia después de cada movimiento. El visor vuelve a pedir ocupación y luces sin
   * desmontarse: remontarlo reconstruía la escena three.js y devolvía la cámara al inicio
   * en cada guardado (con una tanda de congelamiento, en cada muestra). */
  reloadToken?: number;
  /** Ubicación pedida desde el buscador global (`A5`, `A5-3B`); `token` permite repetirla. */
  locationQuery?: { query: string; token: number } | null;
  /** Por qué no se pudo ir a esa ubicación ("No existe el rack Z"), o "" si se pudo. */
  onQueryMessage?: (message: string) => void;
}

interface RackInfo {
  sectionCode: string;
  rack: LayoutRack;
  slots: RackBoxSlot[];
  pisos: number;
}

interface Selection {
  section: string | null;
  rack: string | null;
  box: number | null;
}

const EMPTY_SELECTION: Selection = { section: null, rack: null, box: null };
const DOOR_LABELS = ["Cerrado", "Puerta abierta", "Todo abierto"] as const;
const pad2 = (n: number) => String(n).padStart(2, "0");
const formatLabel = (type: BoxType) =>
  type === "carton_81" ? "9 × 9" : "10 × 10";
const capacityOf = (type: BoxType) => (type === "carton_81" ? 81 : 100);

function lidStateOf(light: PositionLight): LidState {
  if (!light.occupied) return "free";
  return light.isCore ? "core" : "occupied";
}

// Visor 3D del freezer con el mismo diseño de demo.html (issue #6): escena, HUD, panel
// lateral y vista de caja. Todas las subcajas de cada rack vienen precargadas aunque aún no
// estén registradas en la base; las registradas muestran sus luces roja/verde.
export function FreezerViewer({
  focusTarget,
  onSelectFreePosition,
  onSelectOccupiedPosition,
  onMoveBox,
  reloadToken = 0,
  locationQuery,
  onQueryMessage,
}: FreezerViewerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<FreezerScene | null>(null);

  const [layout, setLayout] = useState<FreezerLayout | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);
  const [boxOccupancy, setBoxOccupancy] = useState<Map<number, BoxOccupancy>>(
    new Map(),
  );
  const [rackOccupancy, setRackOccupancy] = useState<RackOccupancy[]>([]);

  const [door, setDoor] = useState<DoorState>(2);
  const [xray, setXray] = useState(false);
  const [extract, setExtract] = useState(true);
  const [sel, setSel] = useState<Selection>(EMPTY_SELECTION);
  const [boxViewOpen, setBoxViewOpen] = useState(false);
  const [slot, setSlot] = useState<string | null>(null);
  const [lights, setLights] = useState<PositionLight[] | null>(null);

  // ---------- Datos ----------
  // La escena se reconstruye cada vez que cambia `layout`, así que en una recarga solo se
  // reemplaza si la estructura cambió de verdad (una caja nueva o una caja movida). La
  // ocupación y las luces sí se recargan siempre.
  const layoutSignature = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([api.listSections(), api.listRacks(), api.listBoxes()])
      .then(([sections, racks, boxes]) => {
        if (cancelled) return;
        const next = buildFreezerLayout(sections, racks, boxes);
        const signature = JSON.stringify(next);
        if (signature === layoutSignature.current) return;
        layoutSignature.current = signature;
        setLayout(next);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setLoadError(
            err instanceof ApiError
              ? err.message
              : "No se pudo cargar el freezer",
          );
      });
    api
      .listBoxOccupancy()
      .then((list) => {
        if (!cancelled)
          setBoxOccupancy(new Map(list.map((box) => [box.box_id, box])));
      })
      .catch(() => undefined);
    api
      .listRackOccupancy()
      .then((list) => {
        if (!cancelled) setRackOccupancy(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const racksByLetter = useMemo(() => {
    const map = new Map<string, RackInfo>();
    for (const section of layout ?? []) {
      for (const rack of [section.center, section.right]) {
        if (rack)
          map.set(rack.letter, {
            sectionCode: section.code,
            rack,
            slots: rackBoxSlots(rack),
            pisos: rackPisos(rack),
          });
      }
    }
    return map;
  }, [layout]);

  const boxIndex = useMemo(() => {
    const map = new Map<number, { letter: string; number: number }>();
    for (const info of racksByLetter.values()) {
      for (const box of info.rack.boxes)
        map.set(box.id, { letter: info.rack.letter, number: box.number });
    }
    return map;
  }, [racksByLetter]);

  const totalBoxes = useMemo(
    () =>
      [...racksByLetter.values()].reduce(
        (sum, info) => sum + info.slots.length,
        0,
      ),
    [racksByLetter],
  );

  const selRack = sel.rack ? (racksByLetter.get(sel.rack) ?? null) : null;
  const selSlot: RackBoxSlot | null =
    selRack && sel.box !== null
      ? (selRack.slots.find((s) => s.number === sel.box) ?? null)
      : null;
  const lightMap = useMemo(
    () => new Map((lights ?? []).map((light) => [light.position, light])),
    [lights],
  );

  // ---------- Selección (misma lógica que demo.html) ----------
  function ensureOpen() {
    setDoor((current) => (current < 2 ? 2 : current));
  }
  function selectSection(code: string, fly = true) {
    setSel({ section: code, rack: null, box: null });
    setSlot(null);
    setBoxViewOpen(false);
    ensureOpen();
    if (fly) sceneRef.current?.focusSection(code);
  }
  function selectRack(letter: string, fly = true) {
    const info = racksByLetter.get(letter);
    if (!info) return;
    setSel((current) => ({
      section: info.sectionCode,
      rack: letter,
      box: current.rack === letter ? current.box : null,
    }));
    if (sel.rack !== letter) {
      setSlot(null);
      setBoxViewOpen(false);
    }
    ensureOpen();
    if (fly) sceneRef.current?.focusRack(letter);
  }
  function selectBox(
    letter: string,
    number: number,
    fly = true,
    position: string | null = null,
  ) {
    const info = racksByLetter.get(letter);
    if (!info || !info.slots.some((s) => s.number === number)) return;
    const sameBox = sel.rack === letter && sel.box === number;
    setSel({ section: info.sectionCode, rack: letter, box: number });
    setSlot((current) => position ?? (sameBox ? current : null));
    setBoxViewOpen(true);
    ensureOpen();
    if (fly) sceneRef.current?.focusBox({ rack: letter, number });
  }
  function clearSelection() {
    setSel(EMPTY_SELECTION);
    setSlot(null);
    setBoxViewOpen(false);
  }

  const handlers = useRef({
    selectBox,
    selectRack,
    setDoor,
    describe: (_: BoxRef) => ({ code: "", detail: "" }),
  });
  handlers.current = {
    selectBox,
    selectRack,
    setDoor,
    describe: (ref: BoxRef) => {
      const info = racksByLetter.get(ref.rack);
      const s = info?.slots.find((item) => item.number === ref.number);
      const occ = s?.box ? boxOccupancy.get(s.box.id) : undefined;
      const usage = s?.box
        ? occ
          ? ` · ${occ.active}/${occ.capacity}`
          : ""
        : " · sin registrar";
      return {
        code: boxCode(ref.rack, ref.number),
        detail: `· Sección ${info?.sectionCode ?? "?"} · P${s?.piso ?? "?"} · F${s?.fondo ?? "?"}${usage}`,
      };
    },
  };

  // ---------- Escena ----------
  useEffect(() => {
    const host = hostRef.current;
    const tip = tipRef.current;
    if (!layout || !host || !tip) return;
    let scene: FreezerScene;
    try {
      scene = createFreezerScene(host, tip, layout, {
        onPickBox: (ref) => handlers.current.selectBox(ref.rack, ref.number),
        onPickRack: (letter) => handlers.current.selectRack(letter),
        onDoorClick: (kind) =>
          handlers.current.setDoor((current) =>
            kind === "inner" ? 2 : current === 0 ? 1 : 0,
          ),
        describeBox: (ref) => handlers.current.describe(ref),
      });
    } catch {
      setWebglError(
        "Tu navegador no soporta WebGL, así que no se puede mostrar el visor 3D. Usa la vista tabla/lista.",
      );
      return;
    }
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, [layout]);

  useEffect(() => sceneRef.current?.setDoor(door), [door, layout]);
  useEffect(() => sceneRef.current?.setXray(xray), [xray, layout]);
  useEffect(() => sceneRef.current?.setExtract(extract), [extract, layout]);
  useEffect(() => {
    sceneRef.current?.setSelection(
      sel.rack,
      sel.rack && sel.box !== null ? { rack: sel.rack, number: sel.box } : null,
    );
  }, [sel, layout]);
  useEffect(
    () => sceneRef.current?.setBoxViewOpen(boxViewOpen && sel.box !== null),
    [boxViewOpen, sel.box, layout],
  );

  // Luces de la subcaja seleccionada: de la API si está registrada; si no, todas libres.
  const selBoxId = selSlot?.box?.id ?? null;
  const selBoxType: BoxType = selSlot?.boxType ?? "carton_81";
  useEffect(() => {
    if (sel.box === null) {
      setLights(null);
      return;
    }
    if (selBoxId === null) {
      setLights(
        positionOrder(selBoxType).map((position) => ({
          position,
          color: "green",
          occupied: false,
          sampleId: null,
          environId: null,
          isCore: false,
          owners: [],
        })),
      );
      return;
    }
    let cancelled = false;
    setLights(null);
    api
      .getBoxPositions(selBoxId)
      .then((positions) => {
        if (!cancelled) setLights(mapPositionsToLights(positions));
      })
      .catch(() => {
        if (!cancelled) setLights([]);
      });
    return () => {
      cancelled = true;
    };
  }, [sel.rack, sel.box, selBoxId, selBoxType, reloadToken]);

  useEffect(() => {
    if (sel.box === null) {
      sceneRef.current?.setLid(null);
      return;
    }
    const states = lights
      ? new Map(lights.map((light) => [light.position, lidStateOf(light)]))
      : null;
    sceneRef.current?.setLid({ grid: lidGrid(selBoxType), states, slot });
  }, [lights, slot, sel.box, selBoxType, layout]);

  // "Ver en el refri" desde la tabla o la vista de % de uso.
  useEffect(() => {
    if (!focusTarget || !layout) return;
    const found = boxIndex.get(focusTarget.boxId);
    if (found)
      handlers.current.selectBox(
        found.letter,
        found.number,
        true,
        focusTarget.position,
      );
  }, [focusTarget, layout, boxIndex]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (boxViewOpen) setBoxViewOpen(false);
      else clearSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [boxViewOpen]);

  // ---------- Búsqueda ----------
  // La búsqueda vive en la barra superior (buscador global); acá solo se resuelve la
  // ubicación pedida contra la estructura del freezer, que es lo que el visor conoce.
  useEffect(() => {
    if (!locationQuery || !layout) return;
    goToLocation(locationQuery.query);
    // Solo cuando llega un pedido nuevo (token) o termina de cargar la estructura.
  }, [locationQuery, layout]);

  function goToLocation(query: string) {
    const setQueryMsg = (message: string) => onQueryMessage?.(message);
    const parsed = parseViewerQuery(query);
    if (!parsed.ok) {
      setQueryMsg(parsed.message);
      return;
    }
    const info = racksByLetter.get(parsed.rackLetter);
    if (!info) {
      setQueryMsg(
        `No existe el rack ${parsed.rackLetter}. Racks: ${[...racksByLetter.keys()].sort().join(", ")}.`,
      );
      return;
    }
    if (parsed.boxNumber === null) {
      setQueryMsg("");
      selectRack(parsed.rackLetter);
      return;
    }
    const target = info.slots.find((s) => s.number === parsed.boxNumber);
    if (!target) {
      setQueryMsg(
        `El rack ${parsed.rackLetter} tiene cajas 1–${info.slots.length}.`,
      );
      return;
    }
    if (
      parsed.position &&
      !positionOrder(target.boxType).includes(parsed.position)
    ) {
      setQueryMsg(
        target.boxType === "carton_81"
          ? "En una caja de cartón las posiciones van de 1A a 9I."
          : "En una caja plástica las posiciones van de 1 a 100.",
      );
      return;
    }
    setQueryMsg("");
    selectBox(parsed.rackLetter, parsed.boxNumber, true, parsed.position);
  }

  // ---------- Acciones sobre una posición ----------
  const selLight = slot ? (lightMap.get(slot) ?? null) : null;
  function registerHere() {
    if (!selRack || !selSlot || !slot) return;
    onSelectFreePosition({
      sectionCode: selRack.sectionCode,
      rackLetter: selRack.rack.letter,
      boxId: selSlot.box?.id ?? null,
      boxNumber: selSlot.number,
      boxType: selSlot.boxType,
      position: slot,
    });
  }
  function openSample() {
    if (!selRack || !selSlot?.box || !slot || !selLight?.sampleId) return;
    onSelectOccupiedPosition({
      sampleId: selLight.sampleId,
      sectionCode: selRack.sectionCode,
      rackLetter: selRack.rack.letter,
      boxId: selSlot.box.id,
      boxNumber: selSlot.number,
      boxType: selSlot.boxType,
      position: slot,
    });
  }

  const order = positionOrder(selBoxType);
  const occupiedCount = lights
    ? lights.filter((light) => light.occupied).length
    : 0;
  const hasCore = lights?.some((light) => light.isCore) ?? false;
  const selCode =
    selRack && selSlot ? boxCode(selRack.rack.letter, selSlot.number) : "";
  const grid = lidGrid(selBoxType);

  return (
    <div className="fv">
      <section className="fv-stage" aria-label="Vista 3D del congelador">
        <div ref={hostRef} className="fv-view" />
        <div className="fv-hud">
          <div
            className="fv-seg"
            role="group"
            aria-label="Estado de las puertas"
          >
            {DOOR_LABELS.map((label, index) => (
              <button
                key={label}
                type="button"
                className={door === index ? "on" : ""}
                aria-pressed={door === index}
                onClick={() => setDoor(index as DoorState)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="fv-tools">
            <label className="fv-tog">
              <input
                type="checkbox"
                checked={xray}
                onChange={(event) => setXray(event.target.checked)}
              />{" "}
              Gabinete transparente
            </label>
            <label className="fv-tog">
              <input
                type="checkbox"
                checked={extract}
                onChange={(event) => setExtract(event.target.checked)}
              />{" "}
              Sacar rack y caja
            </label>
            <button
              type="button"
              className="fv-ghost"
              onClick={() => sceneRef.current?.reset()}
            >
              Reiniciar vista
            </button>
          </div>
        </div>
        <p className="fv-hint">
          Arrastra para girar · rueda para acercar · clic derecho para desplazar
          · clic en una caja o puerta
        </p>
        <div ref={tipRef} className="fv-tip" hidden />
        {loadError && (
          <div className="fv-error" role="alert">
            {loadError}
          </div>
        )}
        {webglError && (
          <div className="fv-error" role="alert">
            {webglError}
          </div>
        )}

        {boxViewOpen && selRack && selSlot && (
          <div className="fv-boxview" role="dialog" aria-labelledby="fvBvTitle">
            <div className="bv-head">
              <div>
                <p className="eyebrow">
                  Caja {formatLabel(selSlot.boxType)} ·{" "}
                  {capacityOf(selSlot.boxType)} posiciones
                </p>
                <h3 className="bv-code" id="fvBvTitle">
                  {selCode}
                </h3>
                <p className="bv-sub">
                  Sección {selRack.sectionCode} · Rack {selRack.rack.letter} ·
                  Piso P{selSlot.piso} · Fondo F{selSlot.fondo}
                </p>
                {hasCore && (
                  <span className="badge badge-warn" role="status">
                    ⚠ Contiene muestras de Núcleo
                  </span>
                )}
              </div>
              <button
                className="bv-close"
                type="button"
                aria-label="Cerrar vista de caja"
                onClick={() => setBoxViewOpen(false)}
              >
                ✕
              </button>
            </div>
            <div>
              <div className="bv-box">
                <div
                  className={`bv-grid ${selSlot.boxType === "carton_81" ? "" : "bv-grid--10"}`}
                  role="group"
                  aria-label="Posiciones de la caja"
                >
                  <div className="bv-ax" />
                  {grid.columns.map((column) => (
                    <div key={`c${column}`} className="bv-ax">
                      {column}
                    </div>
                  ))}
                  {grid.rows.map((row, rowIndex) => [
                    <div key={`r${row}`} className="bv-ax">
                      {row}
                    </div>,
                    ...grid.cells[rowIndex].map((id) => {
                      const light = lightMap.get(id);
                      const state = light ? lidStateOf(light) : "free";
                      const label = light?.occupied
                        ? `${id} · ${light.environId ?? "muestra sin ID Environ"}${light.owners.length ? ` · ${light.owners.join(", ")}` : ""}${light.isCore ? " · Núcleo" : ""}`
                        : `${id} · libre`;
                      return (
                        <button
                          key={id}
                          type="button"
                          className={`bv-slot bv-slot--${state}${id === slot ? " on" : ""}`}
                          aria-label={`Posición ${label}`}
                          aria-pressed={id === slot}
                          title={label}
                          disabled={lights === null}
                          onClick={() =>
                            setSlot((current) => (current === id ? null : id))
                          }
                        >
                          {id}
                        </button>
                      );
                    }),
                  ])}
                </div>
              </div>
              <div className="bv-legend">
                <span>
                  <i className="bv-dot bv-dot--occupied" /> Ocupada{" "}
                  <i className="bv-dot bv-dot--free" /> Libre
                </span>
                <span>
                  {selSlot.boxType === "carton_81"
                    ? "Esquina biselada = 1A · vista superior"
                    : "Vista superior"}
                </span>
              </div>
            </div>
            <div className="bv-foot">
              {lights === null && <p className="later">Cargando posiciones…</p>}
              {lights !== null && !slot && (
                <p className="later">
                  {selSlot.box
                    ? `Toca una posición para ver su estado. Ocupación: ${occupiedCount} de ${order.length}.`
                    : "Caja aún sin registrar: se crea con el primer congelamiento. Toca una posición para registrar una muestra."}
                </p>
              )}
              {lights !== null && slot && (
                <>
                  <div>
                    <b>
                      {selCode}-{slot}
                    </b>{" "}
                    · posición {order.indexOf(slot) + 1} de {order.length}
                  </div>
                  {selLight?.occupied ? (
                    <>
                      <div>{selLight.environId ?? "Muestra sin ID Environ"}</div>
                      <div>
                        {selLight.owners.length > 1 ? "Encargados: " : "Encargado: "}
                        <b>{selLight.owners.length > 0 ? selLight.owners.join(", ") : "sin encargado"}</b>
                        {/* Núcleo es una marca adicional al encargado, no lo reemplaza. */}
                        {selLight.isCore && <span className="fv-warn"> · ⚠ Núcleo</span>}
                      </div>
                      <button
                        type="button"
                        className="fv-btn"
                        onClick={openSample}
                      >
                        Ver muestra / descongelar
                      </button>
                    </>
                  ) : (
                    <>
                      <div>Libre</div>
                      <button
                        type="button"
                        className="fv-btn"
                        onClick={registerHere}
                      >
                        Registrar congelamiento aquí
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </section>

      <aside className="fv-panel">
        <header>
          <p className="eyebrow">Congelador ULT vertical · −86 °C · 388 L</p>
          <h1 className="fv-title">Haier DW-86L388J</h1>
          <div className="fv-stats">
            <div>
              <b>{layout?.length ?? 4}</b>
              <span>estantes</span>
            </div>
            <div>
              <b>{racksByLetter.size}</b>
              <span>racks</span>
            </div>
            <div>
              <b>{totalBoxes}</b>
              <span>cajas de 2 in</span>
            </div>
          </div>
        </header>

        <section>
          <h2 className="fv-h2">
            Estructura <small>sección · rack</small>
          </h2>
          <div>
            {(layout ?? []).map((section) => (
              <div
                key={section.code}
                className={`fv-est${sel.section === section.code ? " on" : ""}`}
              >
                <button
                  type="button"
                  className="fv-est-name"
                  onClick={() => selectSection(section.code)}
                >
                  {section.code}
                </button>
                <span className="fv-est-sub">
                  {sectionDescription(section.code)}
                </span>
                <div className="fv-rk">
                  {[section.center, section.right].map((rack, index) =>
                    rack ? (
                      <button
                        key={rack.letter}
                        type="button"
                        className={sel.rack === rack.letter ? "on" : ""}
                        aria-label={`Sección ${section.code}, rack ${rack.letter} (${index === 0 ? "centro" : "derecha"})`}
                        onClick={() => selectRack(rack.letter)}
                      >
                        {rack.letter}
                      </button>
                    ) : (
                      <button
                        key={`empty-${index}`}
                        type="button"
                        disabled
                        title="Sin rack en esta posición"
                      >
                        —
                      </button>
                    ),
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {selRack && (
          <section>
            <h2 className="fv-h2">
              Rack{" "}
              <small>
                {selRack.rack.letter} · Sección {selRack.sectionCode}
              </small>
            </h2>
            <div className="fv-cells">
              {Array.from({ length: selRack.pisos }, (_, pisoIndex) => {
                const piso = pisoIndex + 1;
                return [
                  <div key={`p${piso}`} className="ax">
                    P{piso}
                  </div>,
                  ...Array.from({ length: RACK_GRID_COLUMNS }, (_, f) => {
                    const number = pisoIndex * RACK_GRID_COLUMNS + f + 1;
                    const s = selRack.slots.find(
                      (item) => item.number === number,
                    );
                    const occ = s?.box ? boxOccupancy.get(s.box.id) : undefined;
                    const full = Boolean(
                      occ && (occ.percent >= 100 || occ.is_full),
                    );
                    const used = Boolean(occ && occ.active > 0);
                    const code = boxCode(selRack.rack.letter, number);
                    const title = occ
                      ? `${code} · ${occ.active}/${occ.capacity}`
                      : `${code} · ${s?.box ? "vacía" : "sin registrar"}`;
                    return (
                      <button
                        key={number}
                        type="button"
                        className={`${sel.box === number ? "on" : ""}${full ? " full" : used ? " used" : ""}`}
                        title={title}
                        aria-label={`Caja ${title}`}
                        onClick={() => selectBox(selRack.rack.letter, number)}
                      >
                        {pad2(number)}
                      </button>
                    );
                  }),
                ];
              })}
            </div>
            <div className="fv-axis-note">
              <span>Frente</span>
              <span>Fondo →</span>
            </div>
          </section>
        )}

        <section>
          <h2 className="fv-h2">Caja seleccionada</h2>
          {!selRack || !selSlot ? (
            <p className="fv-empty">
              Haz clic en una caja del modelo o en la grilla del rack.
            </p>
          ) : (
            <>
              <p className="fv-code">{selCode}</p>
              <dl className="fv-dl">
                <dt>Sección</dt>
                <dd>
                  {selRack.sectionCode} de {layout?.length ?? 4} (desde arriba)
                  ·{" "}
                  {["I", "II"].includes(selRack.sectionCode)
                    ? "puerta interior superior"
                    : "puerta interior inferior"}
                </dd>
                <dt>Rack</dt>
                <dd>
                  {selRack.rack.letter} ·{" "}
                  {selRack.rack.slot === "center" ? "centro" : "derecha"} del
                  estante
                </dd>
                <dt>Piso</dt>
                <dd>
                  P{selSlot.piso} de {selRack.pisos} (desde arriba)
                </dd>
                <dt>Fondo</dt>
                <dd>
                  F{selSlot.fondo} de {RACK_GRID_COLUMNS} (desde el frente)
                </dd>
                <dt>Caja</dt>
                <dd>
                  N.º {pad2(selSlot.number)} de {selRack.slots.length} en el
                  rack
                </dd>
                <dt>Formato</dt>
                <dd>
                  2 in · 133 × 133 × 52 mm · {formatLabel(selSlot.boxType)}
                </dd>
                <dt>Estado</dt>
                <dd>
                  {selSlot.box
                    ? `Registrada · ${lights ? `${occupiedCount} de ${order.length} ocupadas` : "…"}`
                    : "Sin registrar"}
                </dd>
                {slot && (
                  <>
                    <dt>Posición</dt>
                    <dd>
                      {slot} ({order.indexOf(slot) + 1} de {order.length})
                    </dd>
                  </>
                )}
              </dl>
              {!boxViewOpen && (
                <button
                  type="button"
                  className="fv-btn"
                  onClick={() => setBoxViewOpen(true)}
                >
                  Abrir caja {formatLabel(selSlot.boxType)}
                </button>
              )}
              {onMoveBox && selSlot.box && occupiedCount > 0 && (
                <button
                  type="button"
                  className="fv-btn"
                  onClick={() =>
                    onMoveBox({
                      boxId: selSlot.box!.id,
                      label: `${selRack.sectionCode} · ${selRack.rack.letter}${selSlot.number}`,
                      active: occupiedCount,
                    })
                  }
                >
                  Mover caja
                </button>
              )}
            </>
          )}
        </section>

        {selRack && (
          <section>
            <h2 className="fv-h2">% de uso</h2>
            <FreezerUsagePanel
              rack={
                selRack
                  ? {
                      sectionCode: selRack.sectionCode,
                      letter: selRack.rack.letter,
                      occupancy:
                        rackOccupancy.find(
                          (rack) => rack.rack_id === selRack.rack.id,
                        ) ?? null,
                    }
                  : null
              }
              box={
                selSlot && lights
                  ? {
                      number: selSlot.number,
                      occupied: occupiedCount,
                      total: lights.length,
                    }
                  : null
              }
            />
          </section>
        )}
      </aside>
    </div>
  );
}
