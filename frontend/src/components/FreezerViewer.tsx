import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { api, ApiError } from "../api/client";
import type { BoxRead, BoxType, RackRead, SectionRead } from "../api/types";
import { mapPositionsToLights, tooltipFor, type PositionLight } from "../three/boxPositionLights";
import { boxGridPosition, buildFreezerLayout, rackGridRows, type FreezerLayout, type LayoutBox, type LayoutRack } from "../three/freezerLayout";

export interface FreePositionSelection {
  sectionCode: string;
  rackLetter: string;
  boxId: number;
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
  position: string;
  /** Se cambia en cada click para poder re-enfocar la misma caja/posición. */
  token: number;
}

export interface FreezerViewerProps {
  focusTarget?: FreezerFocusTarget | null;
  onSelectFreePosition: (selection: FreePositionSelection) => void;
  onSelectOccupiedPosition: (selection: OccupiedPositionSelection) => void;
}

// Dimensiones (mm) portadas de demo.html, ajustadas a 2 racks por estante
// (centro y derecha) en vez de 3: docs/DATOS.md "Modelo físico".
const CABINET = {
  ext: { w: 830, d: 980, h: 1980 },
  chamber: { w: 465, d: 630, h: 1310, y0: 470 },
  frontZ: 370,
  shelfT: 12,
  shelfW: 451,
  shelfD: 597,
  sections: 4,
  rackW: 141,
  rackD: 542,
  rackFrontZ: 318,
  rackOffsetX: 100,
  box: { w: 133, h: 52, d: 133 },
  fondo: 4,
  extractBy: 680,
  boxSlide: 165,
};

const HOME_POSITION = new THREE.Vector3(1650, 1750, 3050);
const HOME_TARGET = new THREE.Vector3(-80, 1040, 150);

interface BoxMeshData {
  kind: "box";
  sectionCode: string;
  rack: LayoutRack;
  box: LayoutBox;
}

interface RackMeshData {
  kind: "rack";
  sectionCode: string;
  rack: LayoutRack;
}

type PickableData = BoxMeshData | RackMeshData;

interface RackEntry {
  key: string;
  group: THREE.Group;
  sectionCode: string;
  rack: LayoutRack;
  baseZ: number;
  boxMeshes: Map<number, THREE.Mesh>;
}

function rackKey(sectionCode: string, letter: string): string {
  return `${sectionCode}-${letter}`;
}

export function FreezerViewer({ focusTarget, onSelectFreePosition, onSelectOccupiedPosition }: FreezerViewerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);
  const [xray, setXray] = useState(false);
  const [extract, setExtract] = useState(true);
  const [boxView, setBoxView] = useState<{
    sectionCode: string;
    rack: LayoutRack;
    box: LayoutBox;
    lights: PositionLight[];
    highlight: string | null;
  } | null>(null);
  const [boxViewLoading, setBoxViewLoading] = useState(false);

  const apiRef = useRef<{
    setXray: (value: boolean) => void;
    setExtract: (value: boolean) => void;
    reset: () => void;
    focusOnBox: (boxId: number, position: string) => void;
    dispose: () => void;
  } | null>(null);
  const focusTargetRef = useRef<FreezerFocusTarget | null | undefined>(focusTarget);
  const openBoxView = useRef<(sectionCode: string, rack: LayoutRack, box: LayoutBox, highlight: string | null) => void>(
    () => undefined,
  );
  const boxViewRequestRef = useRef(0);

  // Vista de caja: pide las posiciones y arma las luces roja/verde (docs/DATOS.md).
  // Se descarta la respuesta si ya se disparó otra petición más nueva (clics rápidos entre cajas).
  function loadBoxPositions(sectionCode: string, rack: LayoutRack, box: LayoutBox, highlight: string | null) {
    const requestId = ++boxViewRequestRef.current;
    setBoxViewLoading(true);
    api
      .getBoxPositions(box.id)
      .then((positions) => {
        if (boxViewRequestRef.current !== requestId) return;
        setBoxView({ sectionCode, rack, box, lights: mapPositionsToLights(positions), highlight });
      })
      .catch(() => {
        if (boxViewRequestRef.current !== requestId) return;
        setBoxView({ sectionCode, rack, box, lights: [], highlight });
      })
      .finally(() => {
        if (boxViewRequestRef.current !== requestId) return;
        setBoxViewLoading(false);
      });
  }
  openBoxView.current = loadBoxPositions;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let renderer: THREE.WebGLRenderer;
    let frameId = 0;

    const init = async () => {
      let sections: SectionRead[];
      let racks: RackRead[];
      let boxes: BoxRead[];
      try {
        [sections, racks, boxes] = await Promise.all([api.listSections(), api.listRacks(), api.listBoxes()]);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof ApiError ? err.message : "No se pudo cargar el freezer");
        return;
      }
      if (cancelled) return;

      const layout: FreezerLayout = buildFreezerLayout(sections, racks, boxes);

      try {
        renderer = new THREE.WebGLRenderer({ antialias: true });
      } catch {
        setWebglError("Tu navegador no soporta WebGL, así que no se puede mostrar el visor 3D. Usa la vista tabla/lista.");
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.shadowMap.enabled = true;
      host.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xdbe2e7);
      const camera = new THREE.PerspectiveCamera(34, 1, 10, 40000);
      camera.position.copy(HOME_POSITION);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.copy(HOME_TARGET);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.maxPolarAngle = Math.PI * 0.495;
      controls.minDistance = 300;
      controls.maxDistance = 8000;

      scene.add(new THREE.HemisphereLight(0xffffff, 0x8a98a4, 0.8));
      const sun = new THREE.DirectionalLight(0xffffff, 0.65);
      sun.position.set(1600, 3200, 2400);
      scene.add(sun);
      const fill = new THREE.DirectionalLight(0xdfe9ff, 0.3);
      fill.position.set(-2200, 1200, 1800);
      scene.add(fill);

      const std = (color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
        new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, ...opts });
      const mShell = std(0xeef1f3, { roughness: 0.5 });
      const mLiner = std(0xc6d0d6, { roughness: 0.35, metalness: 0.25, side: THREE.BackSide });
      const mShelf = std(0xb3bdc4, { roughness: 0.35, metalness: 0.45 });
      const mSteel = std(0xb9c2c8, { roughness: 0.38, metalness: 0.4 });
      const mSteelOn = std(0x7fc7d8, { roughness: 0.38, metalness: 0.3, emissive: 0x0b3e4a, emissiveIntensity: 0.35 });
      const mBox = std(0xcdb690, { roughness: 0.85 });
      const mBoxHov = std(0xe3cfa6, { roughness: 0.8, emissive: 0x3a2a10, emissiveIntensity: 0.25 });
      const mBoxOn = std(0x14a3c2, { roughness: 0.5, emissive: 0x0d6b80, emissiveIntensity: 0.55 });
      const mEdge = new THREE.LineBasicMaterial({ color: 0x7d6a4a, transparent: true, opacity: 0.55 });
      const xrayMats = [mShell];

      function slab(
        x0: number,
        x1: number,
        y0: number,
        y1: number,
        z0: number,
        z1: number,
        mat: THREE.Material,
        parent: THREE.Object3D = scene,
      ): THREE.Mesh {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);
        mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
        mesh.castShadow = true;
        parent.add(mesh);
        return mesh;
      }

      // ---------- Gabinete (paredes, techo, base, revestimiento) ----------
      const { ext, chamber, frontZ, shelfT, shelfW, shelfD } = CABINET;
      const X0 = -ext.w / 2;
      const X1 = ext.w / 2;
      const ZB = -490;
      const ZF = frontZ;
      const cx0 = -chamber.w / 2;
      const cx1 = chamber.w / 2;
      const cy0 = chamber.y0;
      const cy1 = chamber.y0 + chamber.h;
      const cz1 = ZF;
      const cz0 = ZF - chamber.d;
      [
        [X0, cx0, 80, 1980, ZB, ZF],
        [cx1, X1, 80, 1980, ZB, ZF],
        [cx0, cx1, cy1, 1980, ZB, ZF],
        [cx0, cx1, 80, cy0, ZB, ZF],
        [cx0, cx1, cy0, cy1, ZB, cz0],
      ].forEach(([x0, x1, y0, y1, z0, z1]) => slab(x0, x1, y0, y1, z0, z1, mShell));
      const liner = new THREE.Mesh(
        new THREE.BoxGeometry(chamber.w - 2, chamber.h - 2, chamber.d - 2),
        mLiner,
      );
      liner.position.set(0, cy0 + chamber.h / 2, (cz0 + cz1) / 2);
      scene.add(liner);
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), new THREE.ShadowMaterial({ opacity: 0.16 }));
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      scene.add(floor);
      const grid = new THREE.GridHelper(8000, 40, 0xc3ced5, 0xc3ced5);
      grid.position.y = 0.5;
      scene.add(grid);

      // ---------- Estantes, racks y cajas ----------
      const compH = (chamber.h - (CABINET.sections - 1) * shelfT) / CABINET.sections;
      const racksData: RackEntry[] = [];
      const boxLookup = new Map<number, { rack: RackEntry; boxId: number }>();
      const boxMeshList: THREE.Mesh[] = [];
      const rackParts: THREE.Object3D[] = [];

      layout.forEach((section, index) => {
        const level = index; // 0 = sección I
        const k = CABINET.sections - 1 - level; // I arriba, IV abajo (igual que demo.html)
        const y0 = cy0 + k * (compH + shelfT);
        if (k > 0) {
          const ys = y0 - shelfT;
          slab(-shelfW / 2, shelfW / 2, ys, y0, cz1 - 24, cz1 - 24 - shelfD, mShelf);
        }

        const slots: { rack: LayoutRack | null; xc: number }[] = [
          { rack: section.center, xc: -CABINET.rackOffsetX },
          { rack: section.right, xc: CABINET.rackOffsetX },
        ];

        for (const { rack, xc } of slots) {
          if (!rack) continue;
          const rows = Math.max(rackGridRows(rack.boxes.length), 1);
          const rackH = compH;
          const pitch = (rackH - 4) / rows;
          const boxH = Math.min(CABINET.box.h, Math.max(pitch - 3, 8));
          const boxGeo = new THREE.BoxGeometry(CABINET.box.w - 2, boxH - 2, CABINET.box.d - 2);
          const edgeGeo = new THREE.EdgesGeometry(boxGeo);

          const group = new THREE.Group();
          group.position.set(xc, y0, CABINET.rackFrontZ);
          scene.add(group);
          const hw = CABINET.rackW / 2;
          const D = CABINET.rackD;
          const add = (mesh: THREE.Mesh) => {
            mesh.userData.pickable = { kind: "rack", sectionCode: section.code, rack } satisfies RackMeshData;
            group.add(mesh);
            rackParts.push(mesh);
          };
          add(slab(-hw, hw, 0, 3, -D, 0, mSteel));
          add(slab(-hw, hw, rackH - 3, rackH, -D, 0, mSteel));
          add(slab(-hw, hw, 0, rackH, -3, 0, mSteel));
          add(slab(-hw, hw, 0, rackH, -D, -D + 3, mSteel));
          for (let l = 1; l < rows; l += 1) {
            const yb = 3 + l * pitch;
            add(slab(-hw, hw, yb - 2, yb, -D + 3, -3, mSteel));
          }

          const entry: RackEntry = {
            key: rackKey(section.code, rack.letter),
            group,
            sectionCode: section.code,
            rack,
            baseZ: CABINET.rackFrontZ,
            boxMeshes: new Map(),
          };

          rack.boxes.forEach((box, boxIndex) => {
            const { row, column } = boxGridPosition(boxIndex);
            const mesh = new THREE.Mesh(boxGeo, mBox);
            mesh.position.set(
              0,
              3 + row * pitch + boxH / 2,
              -3 - 1 - column * (CABINET.box.d + 1) - CABINET.box.d / 2,
            );
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.add(new THREE.LineSegments(edgeGeo, mEdge));
            mesh.userData.pickable = { kind: "box", sectionCode: section.code, rack, box } satisfies BoxMeshData;
            group.add(mesh);
            boxMeshList.push(mesh);
            entry.boxMeshes.set(box.id, mesh);
            boxLookup.set(box.id, { rack: entry, boxId: box.id });
          });

          racksData.push(entry);
        }
      });

      // ---------- Estado de selección/hover ----------
      let extractState = true;
      let selectedRackKey: string | null = null;
      let selectedBoxId: number | null = null;
      let hoverMesh: THREE.Mesh | null = null;

      function applyMaterials() {
        for (const mesh of boxMeshList) {
          const data = mesh.userData.pickable as BoxMeshData;
          mesh.material = data.box.id === selectedBoxId ? mBoxOn : mesh === hoverMesh ? mBoxHov : mBox;
        }
        for (const entry of racksData) {
          const on = entry.key === selectedRackKey;
          entry.group.traverse((child) => {
            if (child instanceof THREE.Mesh && (child.material === mSteel || child.material === mSteelOn)) {
              child.material = on ? mSteelOn : mSteel;
            }
          });
        }
      }

      // ---------- Cámara ----------
      let fly: { t0: number; dur: number; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; fromPos: THREE.Vector3; toPos: THREE.Vector3 } | null = null;
      function flyTo(target: THREE.Vector3, pos: THREE.Vector3, dur = 750) {
        fly = { t0: performance.now(), dur, fromTarget: controls.target.clone(), toTarget: target.clone(), fromPos: camera.position.clone(), toPos: pos.clone() };
      }
      controls.addEventListener("start", () => {
        fly = null;
      });

      function rackCenter(entry: RackEntry): THREE.Vector3 {
        const outZ = extractState ? entry.group.position.z - CABINET.rackD / 2 + CABINET.extractBy : entry.group.position.z - CABINET.rackD / 2;
        return new THREE.Vector3(entry.group.position.x, entry.group.position.y + compH / 2, outZ);
      }
      function focusRack(entry: RackEntry) {
        const c = rackCenter(entry);
        flyTo(c, c.clone().add(new THREE.Vector3(650, 420, 950)));
      }
      function boxWorldPosition(entry: RackEntry, mesh: THREE.Mesh): THREE.Vector3 {
        const outward = extractState ? CABINET.extractBy : 0;
        const slide = extractState ? CABINET.boxSlide : 0;
        return new THREE.Vector3(
          entry.group.position.x + slide,
          entry.group.position.y + mesh.position.y,
          entry.group.position.z + outward + mesh.position.z,
        );
      }
      function focusBox(entry: RackEntry, mesh: THREE.Mesh) {
        const c = boxWorldPosition(entry, mesh);
        flyTo(c, c.clone().add(new THREE.Vector3(620, 640, 920)));
      }

      function selectRack(entry: RackEntry, fly_ = true) {
        selectedRackKey = entry.key;
        if (selectedBoxId !== null && !entry.boxMeshes.has(selectedBoxId)) selectedBoxId = null;
        applyMaterials();
        if (fly_) focusRack(entry);
      }
      function selectBox(entry: RackEntry, box: LayoutBox, fly_ = true, highlight: string | null = null) {
        const mesh = entry.boxMeshes.get(box.id);
        if (!mesh) return;
        selectedRackKey = entry.key;
        selectedBoxId = box.id;
        applyMaterials();
        if (fly_) focusBox(entry, mesh);
        openBoxView.current(entry.sectionCode, entry.rack, box, highlight);
      }

      // ---------- Selección/hover al pasar el mouse o hacer clic ----------
      const ray = new THREE.Raycaster();
      const ndc = new THREE.Vector2();
      const pickables = [...boxMeshList, ...rackParts];
      function pick(clientX: number, clientY: number): THREE.Object3D | null {
        const rect = renderer.domElement.getBoundingClientRect();
        ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
        ray.setFromCamera(ndc, camera);
        const hits = ray.intersectObjects(pickables, false);
        return hits.length > 0 ? hits[0].object : null;
      }

      let down: { x: number; y: number } | null = null;
      function handlePointerDown(event: PointerEvent) {
        down = { x: event.clientX, y: event.clientY };
      }
      function handlePointerUp(event: PointerEvent) {
        if (!down) return;
        const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
        down = null;
        if (moved > 5 || event.button !== 0) return;
        const obj = pick(event.clientX, event.clientY);
        if (!obj) return;
        const data = obj.userData.pickable as PickableData | undefined;
        if (!data) return;
        const entry = racksData.find((r) => r.key === rackKey(data.sectionCode, data.rack.letter));
        if (!entry) return;
        if (data.kind === "box") selectBox(entry, data.box);
        else selectRack(entry);
      }
      let moveQueued: { x: number; y: number } | null = null;
      function handlePointerMove(event: PointerEvent) {
        if (event.pointerType === "touch") return;
        moveQueued = { x: event.clientX, y: event.clientY };
      }
      function handlePointerLeave() {
        moveQueued = null;
        if (tooltipRef.current) tooltipRef.current.hidden = true;
        if (hoverMesh) {
          hoverMesh = null;
          applyMaterials();
        }
      }
      const handleHover = () => {
        if (!moveQueued) return;
        const { x, y } = moveQueued;
        moveQueued = null;
        const obj = pick(x, y);
        const data = obj?.userData.pickable as PickableData | undefined;
        const rect = host.getBoundingClientRect();
        const tip = tooltipRef.current;
        let hov: THREE.Mesh | null = null;
        if (data && tip) {
          if (data.kind === "box") {
            hov = (obj as THREE.Mesh) ?? null;
            tip.textContent = `Sección ${data.sectionCode} · Rack ${data.rack.letter} · Caja ${data.box.number}`;
          } else {
            tip.textContent = `Sección ${data.sectionCode} · Rack ${data.rack.letter}`;
          }
          tip.hidden = false;
          tip.style.left = `${x - rect.left + 12}px`;
          tip.style.top = `${y - rect.top + 12}px`;
        } else if (tip) {
          tip.hidden = true;
        }
        renderer.domElement.style.cursor = data ? "pointer" : "grab";
        if (hov !== hoverMesh) {
          hoverMesh = hov;
          applyMaterials();
        }
      };

      renderer.domElement.addEventListener("pointerdown", handlePointerDown);
      renderer.domElement.addEventListener("pointerup", handlePointerUp);
      renderer.domElement.addEventListener("pointermove", handlePointerMove);
      renderer.domElement.addEventListener("pointerleave", handlePointerLeave);

      // ---------- Tamaño y animación ----------
      const resize = () => {
        const w = host.clientWidth || 1;
        const h = host.clientHeight || 1;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(host);
      resize();

      let last = performance.now();
      function tick(now: number) {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const k = 1 - Math.exp(-dt * 7);

        for (const entry of racksData) {
          const isSelected = entry.key === selectedRackKey;
          const wantZ = entry.baseZ + (extractState && isSelected ? CABINET.extractBy : 0);
          entry.group.position.z += (wantZ - entry.group.position.z) * k;
        }
        for (const mesh of boxMeshList) {
          const data = mesh.userData.pickable as BoxMeshData;
          const entry = racksData.find((r) => r.boxMeshes.get(data.box.id) === mesh);
          const rackOut = entry ? entry.group.position.z > entry.baseZ + CABINET.extractBy * 0.92 : false;
          const wantX = data.box.id === selectedBoxId && extractState && rackOut ? CABINET.boxSlide : 0;
          mesh.position.x += (wantX - mesh.position.x) * k;
        }

        if (fly) {
          const t = Math.min(1, (now - fly.t0) / fly.dur);
          const eased = 1 - (1 - t) ** 3;
          controls.target.lerpVectors(fly.fromTarget, fly.toTarget, eased);
          camera.position.lerpVectors(fly.fromPos, fly.toPos, eased);
          if (t >= 1) fly = null;
        }
        handleHover();
        controls.update();
        renderer.render(scene, camera);
        frameId = requestAnimationFrame(tick);
      }
      frameId = requestAnimationFrame(tick);

      const viewerApi = {
        setXray(value: boolean) {
          xrayMats.forEach((mat) => {
            mat.transparent = value;
            mat.opacity = value ? 0.12 : 1;
            mat.depthWrite = !value;
            mat.needsUpdate = true;
          });
        },
        setExtract(value: boolean) {
          extractState = value;
        },
        reset() {
          flyTo(HOME_TARGET, HOME_POSITION, 900);
        },
        focusOnBox(boxId: number, position: string) {
          const found = boxLookup.get(boxId);
          if (!found) return;
          const box = found.rack.rack.boxes.find((b) => b.id === boxId);
          if (!box) return;
          selectBox(found.rack, box, true, position);
        },
        dispose() {
          cancelAnimationFrame(frameId);
          resizeObserver.disconnect();
          renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
          renderer.domElement.removeEventListener("pointerup", handlePointerUp);
          renderer.domElement.removeEventListener("pointermove", handlePointerMove);
          renderer.domElement.removeEventListener("pointerleave", handlePointerLeave);
          controls.dispose();
          renderer.dispose();
          if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement);
        },
      };
      apiRef.current = viewerApi;
      if (focusTargetRef.current) {
        viewerApi.focusOnBox(focusTargetRef.current.boxId, focusTargetRef.current.position);
      }
    };

    void init();

    return () => {
      cancelled = true;
      apiRef.current?.dispose();
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    focusTargetRef.current = focusTarget;
    if (focusTarget) apiRef.current?.focusOnBox(focusTarget.boxId, focusTarget.position);
  }, [focusTarget]);

  function handleXrayChange(checked: boolean) {
    setXray(checked);
    apiRef.current?.setXray(checked);
  }
  function handleExtractChange(checked: boolean) {
    setExtract(checked);
    apiRef.current?.setExtract(checked);
  }

  const boxHasCoreSample = boxView?.lights.some((light) => light.isCore) ?? false;

  return (
    <div className="freezer-viewer">
      <div className="freezer-stage" aria-label="Vista 3D del freezer">
        <div ref={hostRef} className="freezer-canvas" />
        <div className="freezer-hud">
          <label className="tog">
            <input type="checkbox" checked={xray} onChange={(event) => handleXrayChange(event.target.checked)} />
            Gabinete transparente
          </label>
          <label className="tog">
            <input type="checkbox" checked={extract} onChange={(event) => handleExtractChange(event.target.checked)} />
            Sacar rack y caja
          </label>
          <button type="button" className="btn-ghost" onClick={() => apiRef.current?.reset()}>
            Reiniciar vista
          </button>
        </div>
        <p className="freezer-hint">Arrastra para girar · rueda para acercar · clic en un rack o una caja</p>
        <div ref={tooltipRef} className="freezer-tooltip" hidden />
        {loadError && <div className="empty-state" role="alert">{loadError}</div>}
        {webglError && <div className="empty-state" role="alert">{webglError}</div>}

        {boxView && (
          <div className="freezer-boxview" role="dialog" aria-label={`Caja ${boxView.box.number}`}>
            <div className="bv-head">
              <div>
                <p className="eyebrow">
                  Sección {boxView.sectionCode} · Rack {boxView.rack.letter} ·{" "}
                  {boxView.box.boxType === "carton_81" ? "9 × 9" : "10 × 10"}
                </p>
                <h3 className="bv-code">Caja {boxView.box.number}</h3>
                {boxHasCoreSample && (
                  <span className="badge badge-warn" role="status">
                    ⚠ Contiene muestras de Núcleo
                  </span>
                )}
              </div>
              <button className="bv-close" type="button" aria-label="Cerrar vista de caja" onClick={() => setBoxView(null)}>
                ✕
              </button>
            </div>
            {boxViewLoading && <p>Cargando posiciones…</p>}
            {!boxViewLoading && (
              <div
                className={`position-grid ${boxView.box.boxType === "carton_81" ? "position-grid--carton" : "position-grid--plastic"}`}
                role="group"
                aria-label="Posiciones de la caja"
              >
                {boxView.lights.map((light) => (
                  <button
                    key={light.position}
                    type="button"
                    className={`position-cell position-cell--${light.color === "red" ? "occupied" : "free"}${
                      boxView.highlight === light.position ? " position-cell--selected" : ""
                    }`}
                    title={tooltipFor(light)}
                    aria-label={tooltipFor(light)}
                    onClick={() => {
                      if (light.occupied) {
                        if (light.sampleId === null) return;
                        onSelectOccupiedPosition({
                          sampleId: light.sampleId,
                          sectionCode: boxView.sectionCode,
                          rackLetter: boxView.rack.letter,
                          boxId: boxView.box.id,
                          boxNumber: boxView.box.number,
                          boxType: boxView.box.boxType,
                          position: light.position,
                        });
                      } else {
                        onSelectFreePosition({
                          sectionCode: boxView.sectionCode,
                          rackLetter: boxView.rack.letter,
                          boxId: boxView.box.id,
                          boxNumber: boxView.box.number,
                          boxType: boxView.box.boxType,
                          position: light.position,
                        });
                      }
                    }}
                  >
                    {light.position}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
