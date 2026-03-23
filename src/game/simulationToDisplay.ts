/**
 * Single place to convert simulation-space values to Phaser world / canvas pixels.
 * Simulation uses abstract units (see simulationSpace.ts); display uses this ratio per player viewport.
 */

/** 1:1 keeps legacy behaviour; change to rescale all rendering without touching the server. */
export const SIMULATION_UNITS_TO_PHASER_PIXELS = 1;

export function simulationToPhaserPixels(value: number): number {
  return value * SIMULATION_UNITS_TO_PHASER_PIXELS;
}

export function phaserPixelsToSimulation(value: number): number {
  return value / SIMULATION_UNITS_TO_PHASER_PIXELS;
}
