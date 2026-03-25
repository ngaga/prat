/** Shared combat / progression constants (no Phaser). Distances use simulation units (see simulationSpace). */

export const MAX_LIFE = 100;
export const XP_PER_PRAT = 20;
export const XP_PER_OCTOPUS_OR_STINGRAY = 100;
export const XP_PER_PLAYER_LEVEL = 100;
/** Total experience needed per level step (constant for now). Level 1 at 0 XP, then +1 level every EXPERIENCE_PER_LEVEL points. */
export const EXPERIENCE_PER_LEVEL = 200;
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
export const OCTOPUS_PROJECTILE_MAX_RANGE = 500;

/** Word prats captured while ghost to leave ghost mode and return to normal play. */
export const GHOST_PRATS_TO_LEAVE = 10;

export function getLevelFromExperience(totalExperience: number): number {
  const safe = Math.max(0, Math.floor(Number(totalExperience) || 0));
  return Math.floor(safe / EXPERIENCE_PER_LEVEL) + 1;
}

/** Minimum total XP to reach a given level (tier start). Use in SQL for a target level: SET exp = (level - 1) * 200 or this helper. */
export function getMinimumExperienceForLevel(level: number): number {
  const safe = Math.max(1, Math.floor(Number(level) || 1));
  return (safe - 1) * EXPERIENCE_PER_LEVEL;
}

/** Progress within the current level toward the next one (next level after EXPERIENCE_PER_LEVEL more XP in this tier). */
export function getExperienceProgressTowardNextLevel(totalExperience: number): { current: number; needed: number } {
  const safe = Math.max(0, Math.floor(Number(totalExperience) || 0));
  return {
    current: safe % EXPERIENCE_PER_LEVEL,
    needed: EXPERIENCE_PER_LEVEL,
  };
}
