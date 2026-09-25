import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  rackBoxSlots,
  rackPisos,
  type FreezerLayout,
  type LayoutRack,
  type LidGrid,
} from "./freezerLayout";

// Escena 3D portada de demo.html (Haier DW-86L388J) sin cambios de diseño: mismo
// gabinete, puertas, bandejas, racks, cajas, materiales, luces y cámara. Lo único que
// cambia son los datos: el refri real usa solo los racks del centro y de la derecha de
// cada estante (docs/DATOS.md "Modelo físico") y la tapa de la caja seleccionada
// muestra las luces de ocupación (roja = ocupada, verde = libre).

/* ---------- Configuración (mm), igual que demo.html ---------- */
const C = {
  ext: { w: 830, d: 980, h: 1980 },
  ch: { w: 465, d: 630, h: 1310, y0: 470 }, // cámara interior
  frontZ: 370, // plano frontal del gabinete
  shelfT: 12,
  shelfW: 451,
  shelfD: 597,
  estantes: 4,
  box: { w: 133, h: 52, d: 133 },
  rackW: 141,
  rackD: 542,
  pisoPitch: 56,
  rackPitchX: 146,
  rackFrontZ: 318,
  extractBy: 680, // el rack sale completo de la cámara
  boxSlide: 165, // la caja sale por el costado del rack
};
const SLOT_X = { center: 0, right: C.rackPitchX } as const; // la posición izquierda (−146) no existe
const compH = (C.ch.h - (C.estantes - 1) * C.shelfT) / C.estantes;
const HOME = {
  pos: new THREE.Vector3(1650, 1750, 3050),
  target: new THREE.Vector3(-80, 1040, 150),
};
const OUTER_OPEN = -1.92;
const INNER_OPEN = -1.72;
const SECTION_DESC: Record<string, string> = {
  I: "Arriba · puerta interior superior",
  II: "Puerta interior superior",
  III: "Puerta interior inferior",
  IV: "Abajo · puerta interior inferior",
};

export function sectionDescription(code: string): string {
  return SECTION_DESC[code] ?? "";
}

export type DoorState = 0 | 1 | 2; // cerrado · puerta abierta · todo abierto
export type LidState = "free" | "occupied" | "core";

export interface BoxRef {
  rack: string;
  number: number;
}

export interface LidView {
  grid: LidGrid;
  /** Estado de cada posición; `null` mientras se cargan (se dibuja como en el demo). */
  states: Map<string, LidState> | null;
  slot: string | null;
}

export interface SceneCallbacks {
  onPickBox(box: BoxRef): void;
  onPickRack(rackLetter: string): void;
  onDoorClick(kind: "outer" | "inner"): void;
  /** Texto del tooltip de una caja: código en negrita y detalle. */
  describeBox(box: BoxRef): { code: string; detail: string };
}

export interface FreezerScene {
  setDoor(value: DoorState): void;
  setXray(value: boolean): void;
  setExtract(value: boolean): void;
  setSelection(rack: string | null, box: BoxRef | null): void;
  setHoverBox(box: BoxRef | null): void;
  setLid(lid: LidView | null): void;
  setBoxViewOpen(open: boolean): void;
  focusSection(code: string): void;
  focusRack(rackLetter: string): void;
  focusBox(box: BoxRef): void;
  reset(): void;
  dispose(): void;
}

interface RackEntry {
  letter: string;
  sectionCode: string;
  group: THREE.Group;
  parts: THREE.Mesh[];
  y0: number;
  xc: number;
  z: number;
  rackH: number;
  holdOut: boolean;
}

interface BoxEntry {
  mesh: THREE.Mesh;
  ref: BoxRef;
  piso: number;
  fondo: number;
}

const boxKey = (rack: string, number: number) => `${rack}-${number}`;

function cssVar(name: string, fallback: string): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
    fallback
  );
}

export function createFreezerScene(
  host: HTMLElement,
  tip: HTMLElement,
  layout: FreezerLayout,
  callbacks: SceneCallbacks,
): FreezerScene {
  /* ---------- Escena ---------- */
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // El demo usa three r147: sin gestión de color y con luces "legacy". Para que se vea
  // igual en r169 se desactiva la gestión de color y las intensidades se multiplican por π
  // (lo que r147 hacía implícitamente en los shaders).
  THREE.ColorManagement.enabled = false;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 10, 40000);
  camera.position.copy(HOME.pos);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(HOME.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 300;
  controls.maxDistance = 8000;

  const PI = Math.PI;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a98a4, 0.72 * PI));
  const sun = new THREE.DirectionalLight(0xffffff, 0.62 * PI);
  sun.position.set(1600, 3200, 2400);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -1600,
    right: 1600,
    top: 1600,
    bottom: -1600,
    near: 100,
    far: 8000,
  });
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xdfe9ff, 0.28 * PI);
  fill.position.set(-2200, 1200, 1800);
  scene.add(fill);
  // r147 atenuaba linealmente hasta `distance`; decay 0 + la ventana de r169 se le parece.
  const lamp = new THREE.PointLight(0xf4fbff, 0.55 * PI, 2600, 0);
  lamp.position.set(0, 1700, 250);
  scene.add(lamp);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(12000, 12000),
    new THREE.ShadowMaterial({ opacity: 0.16 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  let grid: THREE.GridHelper | null = null;

  /* ---------- Materiales ---------- */
  const std = (
    color: number,
    opts: THREE.MeshStandardMaterialParameters = {},
  ) =>
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.6,
      metalness: 0.05,
      ...opts,
    });
  const mShell = std(0xeef1f3, { roughness: 0.5 });
  const mDoor = std(0xf1f3f5, { roughness: 0.45 });
  const mTrim = std(0x2c353c, { roughness: 0.7 });
  const mSlat = std(0x49545c, { roughness: 0.6 });
  const mGasket = std(0x3b454c, { roughness: 0.9 });
  const mLiner = std(0xc6d0d6, {
    roughness: 0.35,
    metalness: 0.25,
    side: THREE.BackSide,
  });
  const mPlug = std(0xd9e0e4, { roughness: 0.5 });
  const mInner = std(0xf5f7f8, { roughness: 0.85 });
  const mHandle = std(0xa9b3ba, { roughness: 0.3, metalness: 0.55 });
  const mShelf = std(0xb3bdc4, { roughness: 0.35, metalness: 0.45 });
  const mSteel = std(0xb9c2c8, { roughness: 0.38, metalness: 0.4 });
  const mSteelOn = std(0x7fc7d8, {
    roughness: 0.38,
    metalness: 0.3,
    emissive: 0x0b3e4a,
    emissiveIntensity: 0.35,
  });
  const mWheel = std(0x23292e, { roughness: 0.8 });
  const mBox = std(0xcdb690, { roughness: 0.85 });
  const mBoxHov = std(0xe3cfa6, {
    roughness: 0.8,
    emissive: 0x3a2a10,
    emissiveIntensity: 0.25,
  });
  const mBoxOn = std(0x14a3c2, {
    roughness: 0.5,
    emissive: 0x0d6b80,
    emissiveIntensity: 0.55,
  });
  const mEdge = new THREE.LineBasicMaterial({
    color: 0x7d6a4a,
    transparent: true,
    opacity: 0.55,
  });
  const xrayMats = [mShell, mDoor, mTrim, mSlat, mGasket, mPlug];

  const occluders: THREE.Mesh[] = [];
  const doorMeshes: THREE.Mesh[] = [];
  const rackParts: THREE.Mesh[] = [];
  function slab(
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    z0: number,
    z1: number,
    mat: THREE.Material,
    parent: THREE.Object3D = scene,
    opts: { cast?: boolean } = {},
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0),
      mat,
    );
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    if (opts.cast !== false) mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }

  /* ---------- Texturas de texto ---------- */
  interface Label {
    cv: HTMLCanvasElement;
    tex: THREE.CanvasTexture;
    draw: (g: CanvasRenderingContext2D, w: number, h: number) => void;
  }
  const labels: Label[] = [];
  function redraw(item: Label) {
    const g = item.cv.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, item.cv.width, item.cv.height);
    item.draw(g, item.cv.width, item.cv.height);
    item.tex.needsUpdate = true;
  }
  function textTexture(w: number, h: number, draw: Label["draw"]): Label {
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    const item = { cv, tex, draw };
    labels.push(item);
    redraw(item);
    return item;
  }

  /* Tapa de la caja seleccionada: grilla 9 × 9 o 10 × 10 con las luces de ocupación */
  let lid: LidView | null = null;
  const lidItem = textTexture(512, 512, (g, w, h) => {
    g.fillStyle = "#1B9BB8";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#12788F";
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(54, 0);
    g.lineTo(0, 54);
    g.closePath();
    g.fill();
    const cells =
      lid?.grid.cells ??
      Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => ""));
    const n = cells.length;
    const m = 34;
    const step = (w - 2 * m) / n;
    const r = step * 0.36;
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < cells[i].length; j += 1) {
        const id = cells[i][j];
        const x = m + step * (j + 0.5);
        const y = m + step * (i + 0.5);
        const selected = lid !== null && id === lid.slot;
        const state = lid?.states?.get(id);
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fillStyle = selected
          ? "#FFB347"
          : state === "free"
            ? "#2BB673"
            : state
              ? "#E5484D"
              : "#0C4F5E";
        g.fill();
        g.lineWidth = selected ? 5 : state === "core" ? 4 : 2;
        g.strokeStyle = selected
          ? "#FFFFFF"
          : state === "core"
            ? "#FFB347"
            : state === "free"
              ? "#B7F2CF"
              : state
                ? "#FFC2C4"
                : "#5CC6DD";
        g.stroke();
      }
    }
  });
  const mLid = new THREE.MeshStandardMaterial({
    map: lidItem.tex,
    roughness: 0.55,
    emissive: 0x0d6b80,
    emissiveIntensity: 0.25,
  });
  const mBoxOnArr = [mBoxOn, mBoxOn, mLid, mBoxOn, mBoxOn, mBoxOn];

  /* ---------- Gabinete ---------- */
  const X0 = -C.ext.w / 2;
  const X1 = C.ext.w / 2;
  const ZB = -490;
  const ZF = C.frontZ;
  const cx0 = -C.ch.w / 2;
  const cx1 = C.ch.w / 2;
  const cy0 = C.ch.y0;
  const cy1 = C.ch.y0 + C.ch.h;
  const cz1 = ZF;
  const cz0 = ZF - C.ch.d;
  (
    [
      [X0, cx0, 80, 1980, ZB, ZF], // pared izquierda
      [cx1, X1, 80, 1980, ZB, ZF], // pared derecha
      [cx0, cx1, cy1, 1980, ZB, ZF], // techo
      [cx0, cx1, 80, cy0, ZB, ZF], // base / compresor
      [cx0, cx1, cy0, cy1, ZB, cz0], // fondo
    ] as const
  ).forEach(([a, b, c, d, e, f]) =>
    occluders.push(slab(a, b, c, d, e, f, mShell)),
  );
  occluders.push(slab(X0 + 10, X1 - 10, 40, 80, ZB + 10, ZF - 10, mTrim));
  // rejilla de ventilación
  occluders.push(slab(-360, 360, 110, 400, ZF, ZF + 3, mTrim));
  for (let i = 0; i < 10; i += 1)
    slab(-348, 348, 122 + i * 27, 132 + i * 27, ZF + 3, ZF + 7, mSlat, scene, {
      cast: false,
    });
  // ruedas
  (
    [
      [-350, -420],
      [350, -420],
      [-350, 300],
      [350, 300],
    ] as const
  ).forEach(([x, z]) => {
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(24, 24, 20, 20),
      mWheel,
    );
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, 24, z);
    wheel.castShadow = true;
    scene.add(wheel);
    slab(x - 16, x + 16, 36, 44, z - 20, z + 20, mTrim);
  });
  // junta frontal alrededor de la abertura
  (
    [
      [cx0 - 18, cx1 + 18, cy1, cy1 + 17],
      [cx0 - 18, cx1 + 18, cy0 - 17, cy0],
      [cx0 - 18, cx0, cy0, cy1],
      [cx1, cx1 + 18, cy0, cy1],
    ] as const
  ).forEach(([a, b, c, d]) =>
    slab(a, b, c, d, ZF, ZF + 4, mGasket, scene, { cast: false }),
  );
  // revestimiento interior
  const liner = new THREE.Mesh(
    new THREE.BoxGeometry(C.ch.w - 2, C.ch.h - 2, C.ch.d - 2),
    mLiner,
  );
  liner.position.set(0, cy0 + C.ch.h / 2, (cz0 + cz1) / 2);
  liner.receiveShadow = true;
  scene.add(liner);

  /* ---------- Puerta exterior ---------- */
  const outer = new THREE.Group();
  outer.position.set(X0, 0, ZF + 4);
  scene.add(outer);
  const ox = (x: number) => x - X0; // x mundo → x local
  [
    slab(0, C.ext.w, 440, 1960, 0, 120, mDoor, outer),
    slab(ox(cx0) + 8, ox(cx1) - 8, cy0 + 8, cy1 - 8, -18, 0, mPlug, outer),
    slab(ox(cx0) - 20, ox(cx1) + 20, cy0 - 20, cy1 + 20, -2, 0, mGasket, outer),
    slab(776, 790, 1010, 1040, 120, 150, mHandle, outer),
    slab(776, 790, 1330, 1360, 120, 150, mHandle, outer),
    slab(768, 798, 990, 1380, 150, 172, mHandle, outer),
    slab(250, 580, 1812, 1918, 120, 123, mTrim, outer),
  ].forEach((mesh) => {
    mesh.userData.door = "outer";
    doorMeshes.push(mesh);
  });
  const dispItem = textTexture(512, 160, (g, w, h) => {
    g.fillStyle = "#0B1216";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#76E0F4";
    g.font = '600 78px "IBM Plex Mono", monospace';
    g.textBaseline = "middle";
    g.fillText("−80°C", 26, h / 2 + 4);
    g.fillStyle = "#5E7580";
    g.font = '500 22px "IBM Plex Mono", monospace';
    g.fillText("SET −80", 360, 52);
    g.fillText("ALARM OK", 360, 112);
  });
  const disp = new THREE.Mesh(
    new THREE.PlaneGeometry(310, 94),
    new THREE.MeshBasicMaterial({ map: dispItem.tex }),
  );
  disp.position.set(415, 1865, 123.6);
  disp.userData.door = "outer";
  doorMeshes.push(disp);
  outer.add(disp);

  /* ---------- Puertas interiores (2) ---------- */
  const mid = cy0 + C.ch.h / 2;
  const inner = (
    [
      [mid, cy1],
      [cy0, mid],
    ] as const
  ).map(([y0, y1]) => {
    const g = new THREE.Group();
    g.position.set(cx0, 0, 352);
    scene.add(g);
    const a = slab(2, C.ch.w - 2, y0 + 3, y1 - 3, -16, 0, mInner, g);
    const k = slab(
      C.ch.w - 44,
      C.ch.w - 22,
      (y0 + y1) / 2 - 45,
      (y0 + y1) / 2 + 45,
      0,
      22,
      mHandle,
      g,
    );
    [a, k].forEach((mesh) => {
      mesh.userData.door = "inner";
      doorMeshes.push(mesh);
    });
    return g;
  });

  /* ---------- Bandejas, racks y cajas (todas precargadas) ---------- */
  const racks = new Map<string, RackEntry>();
  const boxes = new Map<string, BoxEntry>();
  const boxMeshes: THREE.Mesh[] = [];
  const estY0 = new Map<string, number>();
  const geoCache = new Map<
    number,
    { box: THREE.BoxGeometry; edge: THREE.EdgesGeometry }
  >();
  function boxGeometries(boxH: number) {
    let cached = geoCache.get(boxH);
    if (!cached) {
      const box = new THREE.BoxGeometry(C.box.w - 2, boxH - 2, C.box.d - 2);
      cached = { box, edge: new THREE.EdgesGeometry(box) };
      geoCache.set(boxH, cached);
    }
    return cached;
  }

  function buildRack(
    rack: LayoutRack,
    sectionCode: string,
    y0: number,
    xc: number,
  ) {
    const pisos = rackPisos(rack);
    // 5 pisos de 56 mm como el demo; si hubiera más cajas, los pisos se comprimen para caber.
    const pitch = Math.min(C.pisoPitch, (compH - 8) / pisos);
    const boxH = Math.min(C.box.h, pitch - 4);
    const rackH = 3 + pisos * pitch + 1;
    const g = new THREE.Group();
    g.position.set(xc, y0, C.rackFrontZ);
    scene.add(g);
    const hw = C.rackW / 2;
    const D = C.rackD;
    const parts: THREE.Mesh[] = [];
    const add = (mesh: THREE.Mesh) => {
      mesh.userData.rack = rack.letter;
      parts.push(mesh);
      rackParts.push(mesh);
    };
    add(slab(-hw, hw, 0, 3, -D, 0, mSteel, g));
    for (let l = 1; l < pisos; l += 1) {
      const yb = 3 + l * pitch;
      add(slab(-hw, hw, yb - 2, yb, -D + 3, -3, mSteel, g));
    }
    add(slab(-hw, hw, rackH - 3, rackH, -D, 0, mSteel, g));
    add(slab(-hw, hw, 0, rackH, -3, 0, mSteel, g));
    add(slab(-hw, hw, 0, rackH, -D, -D + 3, mSteel, g));
    for (let l = 0; l <= pisos; l += 1) {
      // pestañas laterales
      const yb = Math.min(3 + l * pitch, rackH - 3);
      add(
        slab(-hw, -hw + 2, yb - 1, yb + 8, -D + 3, -3, mSteel, g, {
          cast: false,
        }),
      );
      add(
        slab(hw - 2, hw, yb - 1, yb + 8, -D + 3, -3, mSteel, g, {
          cast: false,
        }),
      );
    }
    add(slab(-38, -30, rackH - 42, rackH - 28, 0, 22, mHandle, g));
    add(slab(30, 38, rackH - 42, rackH - 28, 0, 22, mHandle, g));
    add(slab(-38, 38, rackH - 42, rackH - 28, 22, 30, mHandle, g));
    const lblItem = textTexture(256, 96, (c, w, h) => {
      c.fillStyle = "#E8EDF0";
      c.fillRect(0, 0, w, h);
      c.strokeStyle = "#9AA6AE";
      c.lineWidth = 4;
      c.strokeRect(2, 2, w - 4, h - 4);
      c.fillStyle = "#17232C";
      c.font = '600 50px "IBM Plex Mono", monospace';
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(`${sectionCode}·${rack.letter}`, w / 2, h / 2 + 3);
    });
    const lbl = new THREE.Mesh(
      new THREE.PlaneGeometry(104, 39),
      new THREE.MeshBasicMaterial({ map: lblItem.tex }),
    );
    lbl.position.set(0, rackH * 0.52, 0.8);
    add(lbl);
    g.add(lbl);

    const { box: boxGeo, edge: edgeGeo } = boxGeometries(boxH);
    for (const slot of rackBoxSlots(rack)) {
      const l = pisos - slot.piso; // piso 1 = arriba
      const p = slot.fondo - 1; // fondo 1 = frente
      const mesh = new THREE.Mesh(boxGeo, mBox);
      mesh.position.set(
        0,
        3 + l * pitch + boxH / 2,
        -3 - 1 - p * (C.box.d + 1) - C.box.d / 2,
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.add(new THREE.LineSegments(edgeGeo, mEdge));
      const ref = { rack: rack.letter, number: slot.number };
      mesh.userData.box = ref;
      g.add(mesh);
      boxMeshes.push(mesh);
      boxes.set(boxKey(rack.letter, slot.number), {
        mesh,
        ref,
        piso: slot.piso,
        fondo: slot.fondo,
      });
    }
    racks.set(rack.letter, {
      letter: rack.letter,
      sectionCode,
      group: g,
      parts,
      y0,
      xc,
      z: C.rackFrontZ,
      rackH,
      holdOut: false,
    });
  }

  layout.forEach((section, index) => {
    const k = C.estantes - 1 - Math.min(index, C.estantes - 1); // sección I = arriba (E1 del demo)
    const y0 = cy0 + k * (compH + C.shelfT);
    estY0.set(section.code, y0);
    if (k > 0) {
      const ys = y0 - C.shelfT;
      const shelf = slab(
        -C.shelfW / 2,
        C.shelfW / 2,
        ys,
        y0,
        cz1 - 24,
        cz1 - 24 - C.shelfD,
        mShelf,
      );
      shelf.receiveShadow = true;
      occluders.push(shelf);
      slab(cx0, cx0 + 7, ys - 10, ys, cz0 + 8, cz1 - 30, mShelf, scene, {
        cast: false,
      });
      slab(cx1 - 7, cx1, ys - 10, ys, cz0 + 8, cz1 - 30, mShelf, scene, {
        cast: false,
      });
    }
    if (section.center)
      buildRack(section.center, section.code, y0, SLOT_X.center);
    if (section.right) buildRack(section.right, section.code, y0, SLOT_X.right);
  });

  /* ---------- Estado ---------- */
  const S = {
    door: 2 as DoorState,
    xray: false,
    extract: true,
    rack: null as string | null,
    box: null as string | null,
    hover: null as string | null,
    boxView: false,
  };
  const ang = { outer: 0, inner: 0 };

  function applyMaterials() {
    for (const [key, entry] of boxes) {
      entry.mesh.material =
        key === S.box ? mBoxOnArr : key === S.hover ? mBoxHov : mBox;
    }
    for (const [letter, entry] of racks) {
      const on = letter === S.rack;
      entry.parts.forEach((part) => {
        if (part.material === mSteel || part.material === mSteelOn)
          part.material = on ? mSteelOn : mSteel;
      });
    }
  }

  /* ---------- Cámara ---------- */
  let fly: {
    t0: number;
    dur: number;
    fT: THREE.Vector3;
    tT: THREE.Vector3;
    fP: THREE.Vector3;
    tP: THREE.Vector3;
  } | null = null;
  function flyTo(target: THREE.Vector3, pos: THREE.Vector3, dur = 750) {
    fly = {
      t0: performance.now(),
      dur,
      fT: controls.target.clone(),
      tT: target.clone(),
      fP: camera.position.clone(),
      tP: pos.clone(),
    };
  }
  controls.addEventListener("start", () => {
    fly = null;
  });
  const extActive = () => S.extract && S.door === 2;
  function rackCenter(entry: RackEntry): THREE.Vector3 {
    const ext = extActive() ? C.extractBy : 0;
    return new THREE.Vector3(
      entry.xc,
      entry.y0 + entry.rackH / 2,
      entry.z + ext - C.rackD / 2,
    );
  }
  function boxWorld(entry: BoxEntry): THREE.Vector3 {
    const rack = racks.get(entry.ref.rack)!;
    const ext = extActive() ? C.extractBy : 0;
    const slide = extActive() ? C.boxSlide : 0;
    return new THREE.Vector3(
      rack.xc + slide,
      rack.y0 + entry.mesh.position.y,
      rack.z + ext + entry.mesh.position.z,
    );
  }

  /* ---------- Picking ---------- */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pickables: THREE.Object3D[] = [
    ...boxMeshes,
    ...rackParts,
    ...doorMeshes,
    ...occluders,
  ];
  function pick(cx: number, cy: number): THREE.Object3D | null {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(
      ((cx - rect.left) / rect.width) * 2 - 1,
      -((cy - rect.top) / rect.height) * 2 + 1,
    );
    ray.setFromCamera(ndc, camera);
    for (const hit of ray.intersectObjects(pickables, false)) {
      const u = hit.object.userData;
      if (S.xray && (u.door || occluders.includes(hit.object as THREE.Mesh)))
        continue;
      return hit.object;
    }
    return null;
  }

  function setTip(code: string | null, detail: string) {
    tip.replaceChildren();
    if (code) {
      const b = document.createElement("b");
      b.textContent = code;
      tip.append(b, " ");
    }
    const span = document.createElement("span");
    span.textContent = detail;
    tip.append(span);
  }

  let down: { x: number; y: number } | null = null;
  let moveQueued: { x: number; y: number } | null = null;
  const onPointerDown = (e: PointerEvent) => {
    down = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 5 || e.button !== 0) return;
    const obj = pick(e.clientX, e.clientY);
    if (!obj) return;
    const u = obj.userData;
    if (u.box) callbacks.onPickBox(u.box as BoxRef);
    else if (u.rack) callbacks.onPickRack(u.rack as string);
    else if (u.door === "outer" || u.door === "inner")
      callbacks.onDoorClick(u.door);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    moveQueued = { x: e.clientX, y: e.clientY };
  };
  const onPointerLeave = () => {
    moveQueued = null;
    tip.hidden = true;
    if (S.hover) {
      S.hover = null;
      applyMaterials();
    }
  };
  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerleave", onPointerLeave);

  function handleHover() {
    if (!moveQueued) return;
    const { x, y } = moveQueued;
    moveQueued = null;
    const obj = pick(x, y);
    const u = obj ? obj.userData : {};
    const rect = host.getBoundingClientRect();
    let hov: string | null = null;
    if (u.box) {
      const ref = u.box as BoxRef;
      hov = boxKey(ref.rack, ref.number);
      const text = callbacks.describeBox(ref);
      setTip(text.code, text.detail);
    } else if (u.rack) {
      const rack = racks.get(u.rack as string);
      setTip(
        `Rack ${u.rack}`,
        rack ? `· Sección ${rack.sectionCode}` : "· rack",
      );
    } else if (u.door) {
      setTip(
        null,
        u.door === "outer"
          ? S.door === 0
            ? "Abrir puerta"
            : "Cerrar puerta"
          : "Abrir puertas interiores",
      );
    }
    const show = Boolean(u.box || u.rack || u.door);
    tip.hidden = !show;
    if (show) {
      tip.style.left = `${x - rect.left}px`;
      tip.style.top = `${y - rect.top}px`;
    }
    renderer.domElement.style.cursor = show ? "pointer" : "grab";
    if (hov !== S.hover) {
      S.hover = hov;
      applyMaterials();
    }
  }

  /* ---------- Tema ---------- */
  function applyTheme() {
    scene.background = new THREE.Color(cssVar("--scene", "#DBE2E7"));
    const gc = cssVar("--grid", "#C3CED5");
    if (grid) {
      scene.remove(grid);
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
    }
    grid = new THREE.GridHelper(8000, 40, gc, gc);
    grid.position.y = 0.5;
    scene.add(grid);
  }
  applyTheme();
  const darkQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
  darkQuery?.addEventListener?.("change", applyTheme);
  const themeObserver = new MutationObserver(applyTheme);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  let disposed = false;
  document.fonts?.ready.then(() => {
    if (!disposed) labels.forEach(redraw);
  });

  /* ---------- Tamaño y bucle ---------- */
  function resize() {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  resize();
  const narrow = window.matchMedia?.("(max-width:820px)");
  const reduce =
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  let viewOff = 0;
  let last = performance.now();
  let frameId = 0;

  function tick(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const k = reduce ? 1 : 1 - Math.exp(-dt * 7);
    const tOuter = S.door >= 1 ? OUTER_OPEN : 0;
    const tInner = S.door >= 2 ? INNER_OPEN : 0;
    // la puerta interior cierra antes; la exterior espera a que cierre
    ang.inner += (tInner - ang.inner) * k;
    const innerClosed = Math.abs(ang.inner) < 0.15;
    const outerGoal = tOuter === 0 && !innerClosed ? ang.outer : tOuter;
    ang.outer += (outerGoal - ang.outer) * k;
    outer.rotation.y = ang.outer;
    inner.forEach((g) => {
      g.rotation.y = ang.inner;
    });

    // 1) la caja seleccionada sale por el costado cuando el rack ya está afuera;
    //    un rack no vuelve a entrar mientras tenga una caja afuera
    for (const rack of racks.values()) rack.holdOut = false;
    for (const [key, entry] of boxes) {
      const rack = racks.get(entry.ref.rack)!;
      const rackOut = rack.group.position.z > rack.z + C.extractBy * 0.92;
      const wantX = key === S.box && extActive() && rackOut ? C.boxSlide : 0;
      const m = entry.mesh;
      if (wantX || m.position.x !== 0) {
        m.position.x += (wantX - m.position.x) * k;
        if (!wantX && Math.abs(m.position.x) < 0.5) m.position.x = 0;
      }
      if (Math.abs(m.position.x) > 4) rack.holdOut = true;
    }
    // 2) el rack seleccionado sale completo de la cámara
    const doorsOpen = ang.inner < INNER_OPEN * 0.7;
    for (const [letter, rack] of racks) {
      const out =
        (extActive() && doorsOpen && letter === S.rack) || rack.holdOut;
      const want = rack.z + (out ? C.extractBy : 0);
      rack.group.position.z += (want - rack.group.position.z) * k;
    }
    // 3) con la vista de caja abierta, el modelo se corre a la izquierda para no quedar tapado
    const wantOff = S.boxView && !narrow?.matches ? 190 : 0;
    viewOff += (wantOff - viewOff) * k;
    if (viewOff > 0.5) {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      camera.setViewOffset(w, h, viewOff, 0, w, h);
    } else if (camera.view && camera.view.enabled) {
      camera.clearViewOffset();
    }

    if (fly) {
      const t = Math.min(1, (now - fly.t0) / fly.dur);
      const e = reduce ? 1 : 1 - Math.pow(1 - t, 3);
      controls.target.lerpVectors(fly.fT, fly.tT, e);
      camera.position.lerpVectors(fly.fP, fly.tP, e);
      if (t >= 1) fly = null;
    }
    handleHover();
    controls.update();
    renderer.render(scene, camera);
    frameId = requestAnimationFrame(tick);
  }
  frameId = requestAnimationFrame(tick);

  function setXray(value: boolean) {
    S.xray = value;
    xrayMats.forEach((mat) => {
      mat.transparent = value;
      mat.opacity = value ? 0.12 : 1;
      mat.depthWrite = !value;
      mat.needsUpdate = true;
    });
    disp.visible = !value;
  }

  return {
    setDoor(value) {
      S.door = value;
    },
    setXray,
    setExtract(value) {
      S.extract = value;
    },
    setSelection(rack, box) {
      S.rack = rack;
      S.box = box ? boxKey(box.rack, box.number) : null;
      applyMaterials();
    },
    setHoverBox(box) {
      S.hover = box ? boxKey(box.rack, box.number) : null;
      applyMaterials();
    },
    setLid(next) {
      lid = next;
      redraw(lidItem);
    },
    setBoxViewOpen(open) {
      S.boxView = open;
    },
    focusSection(code) {
      const y0 = estY0.get(code);
      if (y0 === undefined) return;
      const c = new THREE.Vector3(0, y0 + compH / 2, 80);
      flyTo(c, c.clone().add(new THREE.Vector3(950, 520, 1550)));
    },
    focusRack(letter) {
      const rack = racks.get(letter);
      if (!rack) return;
      const c = rackCenter(rack);
      flyTo(c, c.clone().add(new THREE.Vector3(720, 430, 1050)));
    },
    focusBox(box) {
      const entry = boxes.get(boxKey(box.rack, box.number));
      if (!entry) return;
      const c = boxWorld(entry);
      flyTo(c, c.clone().add(new THREE.Vector3(680, 700, 1000)));
    },
    reset() {
      flyTo(HOME.target, HOME.pos, 900);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      darkQuery?.removeEventListener?.("change", applyTheme);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      controls.dispose();
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as
          THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      });
      labels.forEach((item) => item.tex.dispose());
      renderer.dispose();
      if (renderer.domElement.parentElement === host)
        host.removeChild(renderer.domElement);
    },
  };
}
