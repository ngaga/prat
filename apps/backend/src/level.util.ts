/** Mirrors apps/frontend/src/lib/gameBalance.ts progression formula (keep in sync). */
const EXPERIENCE_PER_LEVEL = 200;

export function getLevelFromExperience(totalExperience: number): number {
  const safe = Math.max(0, Math.floor(Number(totalExperience) || 0));
  return Math.floor(safe / EXPERIENCE_PER_LEVEL) + 1;
}
