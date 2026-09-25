import type { BoxPositionStatus } from "../api/types";

// Luces del visor 3D (docs/BUCLE.md issue #6): roja = posición ocupada, verde =
// posición libre. `isCore` dispara el warning de Núcleo en el tooltip.
export type LightColor = "red" | "green";

export interface PositionLight {
  position: string;
  color: LightColor;
  occupied: boolean;
  sampleId: number | null;
  environId: string | null;
  isCore: boolean;
}

export function mapPositionsToLights(positions: BoxPositionStatus[]): PositionLight[] {
  return positions.map((entry) => ({
    position: entry.position,
    color: entry.occupied ? "red" : "green",
    occupied: entry.occupied,
    sampleId: entry.sample_id,
    environId: entry.environ_id,
    isCore: entry.occupied && entry.is_core === true,
  }));
}

export function tooltipFor(light: PositionLight): string {
  if (!light.occupied) return `${light.position} · libre`;
  const label = light.environId ?? "muestra sin ID Environ";
  return light.isCore ? `${light.position} · ${label} · ⚠ Núcleo Environ` : `${light.position} · ${label}`;
}
