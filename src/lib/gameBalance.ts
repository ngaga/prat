/** Shared combat / progression constants (no Phaser). Distances use simulation units (see simulationSpace). */

export const MAX_LIFE = 100;
export const XP_PER_PRAT = 1;
export const XP_PER_OCTOPUS_OR_STINGRAY = 100;
export const XP_BASE_FOR_LEVEL_2 = 1000;
export const XP_MULTIPLIER_PER_LEVEL = 2;
export const XP_PER_PLAYER_LEVEL = 50;
export const PRAT_CAPTURE_RADIUS = 80;
/** Max distance between client-reported capture position and server player position (MOVE latency). Simulation units. */
export const PRAT_CAPTURE_CLIENT_SERVER_MAX_OFFSET = 240;
export const PRAT_SPAWN_INTERVAL_MS = 800;
export const PRAT_SPAWN_RADIUS = 600;
export const MAX_PRATS = 80;
export const HEAL_LETTER_PROBABILITY = 0.1;
export const HEAL_PERCENT_OF_MAX = 0.1;

/** Damage per letter from octopus salvos (authoritative server). */
export const OCTOPUS_PROJECTILE_DAMAGE = 4;
/** Octopus letter speed as a fraction of player letter speed. */
export const OCTOPUS_PROJECTILE_SPEED_FACTOR = 0.8;
/** Max travel distance for octopus letters. Simulation units. */
export const OCTOPUS_PROJECTILE_MAX_RANGE = 240;

/** Word prats captured while ghost to leave ghost mode and return to normal play. */
export const GHOST_PRATS_TO_LEAVE = 10;

export function getLevelFromExperience(totalExperience: number): number {
  if (totalExperience < XP_BASE_FOR_LEVEL_2) return 1;
  return Math.floor(Math.log2(totalExperience / XP_BASE_FOR_LEVEL_2 + 1)) + 1;
}
