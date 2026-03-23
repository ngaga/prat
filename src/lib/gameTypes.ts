/**
 * Shared types for authoritative game sync (SSE + HTTP POST).
 * GameState uses plain objects for JSON serialization.
 */

export type PlayerInputType = "MOVE" | "SHOOT" | "ROTATE" | "PRAT_CAPTURE" | "SYNC_PROFILE";

export interface PlayerInput {
  type: PlayerInputType;
  timestamp: number;
  x?: number;
  y?: number;
  name?: string;
  /** Ignored on MOVE: server keeps authoritative progression. */
  score?: number;
  life?: number;
  level?: number;
  experience?: number;
  killsOctopus?: number;
  killsStingray?: number;
  startX?: number;
  startY?: number;
  targetX?: number;
  targetY?: number;
  targetEnemyId?: string;
  rotation?: number;
  pratId?: string;
}

export interface PlayerState {
  x: number;
  y: number;
  rotation: number;
  name?: string;
  score?: number;
  life?: number;
  level?: number;
  experience?: number;
  killsOctopus?: number;
  killsStingray?: number;
  color?: number;
}

export interface EnemyState {
  id: string;
  x: number;
  y: number;
  life: number;
  maxLife: number;
  velocityX: number;
  velocityY: number;
  lastShotTime: number;
  spawnTime: number;
}

export interface PratState {
  id: string;
  x: number;
  y: number;
  power: number;
  word: string;
  fontStyle: string;
  fontSize: number;
  color: string;
  isHeal: boolean;
  healAmount?: number;
}

export interface ProjectileState {
  id: string;
  shooterId: string;
  letter: string;
  x: number;
  y: number;
  directionX: number;
  directionY: number;
}

export interface EliminationEvent {
  id: string;
  victimId: string;
  attackerId: string;
  victimLevel: number;
}

/**
 * One-shot per tick. Positive `damage` = projectile hit; negative = heal (e.g. prat heal letter).
 * Life is still authoritative in `players`; this drives VFX only.
 */
export interface PlayerDamageEvent {
  id: string;
  targetPlayerId: string;
  attackerId: string;
  damage: number;
}

/**
 * Projectile hit on an octopus or stingray. Authoritative life stays in `enemies` / `stingrays`;
 * this is for VFX and attribution (e.g. attackerId for local burst).
 */
export interface EnemyDamageEvent {
  id: string;
  targetKind: "octopus" | "stingray";
  targetId: string;
  attackerId: string;
  damage: number;
  x: number;
  y: number;
}

export interface SerializableGameState {
  timestamp: number;
  room: string;
  players: Record<string, PlayerState>;
  enemies: Record<string, EnemyState>;
  stingrays: Record<string, StingrayState>;
  prats: Record<string, PratState>;
  projectiles: Record<string, ProjectileState>;
  /** Projectile hits this tick; use `damage` for feedback, not life deltas. */
  damageEvents: PlayerDamageEvent[];
  /** Player projectiles hit octopus or stingray; same broadcast rules as player damageEvents. */
  enemyDamageEvents: EnemyDamageEvent[];
  /** One-shot notifications (e.g. attacker feedback); life and XP for players are already in `players`. */
  eliminationEvents: EliminationEvent[];
  rewardEvents: RewardEvent[];
}

export interface RewardEvent {
  id: string;
  playerId: string;
  kind: "octopus_kill" | "stingray_kill";
}

export interface StingrayState {
  id: string;
  x: number;
  y: number;
  life: number;
  maxLife: number;
  baseY: number;
  spawnTime: number;
}
