import { describe, expect, it } from "vitest";
import type { BoxPositionStatus } from "../../api/types";
import { mapPositionsToLights, tooltipFor } from "../boxPositionLights";

const positions: BoxPositionStatus[] = [
  { position: "1A", occupied: false, sample_id: null, environ_id: null, is_core: null, owners: [] },
  { position: "1B", occupied: true, sample_id: 5, environ_id: "BP1234", is_core: false, owners: ["Ana Soto", "MN"] },
  { position: "1C", occupied: true, sample_id: 6, environ_id: "BP5678", is_core: true, owners: ["GC"] },
  { position: "1D", occupied: true, sample_id: 7, environ_id: null, is_core: null, owners: [] },
];

describe("mapPositionsToLights", () => {
  it("pinta verde las posiciones libres y roja las ocupadas", () => {
    const lights = mapPositionsToLights(positions);
    expect(lights.find((light) => light.position === "1A")?.color).toBe("green");
    expect(lights.find((light) => light.position === "1B")?.color).toBe("red");
  });

  it("solo marca el warning de núcleo cuando la muestra activa es_core=true", () => {
    const lights = mapPositionsToLights(positions);
    expect(lights.find((light) => light.position === "1A")?.isCore).toBe(false);
    expect(lights.find((light) => light.position === "1B")?.isCore).toBe(false);
    expect(lights.find((light) => light.position === "1C")?.isCore).toBe(true);
    // is_core desconocido (null) no debe mostrarse como advertencia positiva.
    expect(lights.find((light) => light.position === "1D")?.isCore).toBe(false);
  });

  it("conserva el sample_id y el environ_id de cada posición", () => {
    const lights = mapPositionsToLights(positions);
    const occupied = lights.find((light) => light.position === "1C");
    expect(occupied).toMatchObject({ sampleId: 6, environId: "BP5678" });
  });
});

describe("tooltipFor", () => {
  it("describe una posición libre", () => {
    const [free] = mapPositionsToLights(positions);
    expect(tooltipFor(free)).toBe("1A · libre");
  });

  it("describe una posición ocupada con su ID Environ y sus encargados", () => {
    const occupied = mapPositionsToLights(positions)[1];
    expect(tooltipFor(occupied)).toBe("1B · BP1234 · Ana Soto, MN");
  });

  it("agrega la marca de núcleo después del encargado, sin reemplazarlo", () => {
    const core = mapPositionsToLights(positions)[2];
    expect(tooltipFor(core)).toBe("1C · BP5678 · GC · ⚠ Núcleo");
  });

  it("usa un texto genérico cuando la muestra activa no tiene ID Environ", () => {
    const noId = mapPositionsToLights(positions)[3];
    expect(tooltipFor(noId)).toBe("1D · muestra sin ID Environ");
  });
});
