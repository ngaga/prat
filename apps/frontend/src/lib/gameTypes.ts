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
  /** Optional; authoritative level comes from total experience on the server. */
  level?: number;
  experience?: number;
  killsOctopus?: number;
  killsStingray?: number;
  /** With SYNC_PROFILE: lifetime prat captures from Supabase (server increments each normal capture). */
  pratsCaptured?: number;
  /** With SYNC_PROFILE: restore ghost after reconnect (persisted in Supabase like exp). */
  isGhost?: boolean;
  ghostPratsCaptured?: number;
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
  /** Lifetime normal-mode prat captures (persisted via client upsert like kills). */
  pratsCaptured?: number;
  color?: number;
  /** Dead players respawn as ghosts until they capture enough word prats. */
  isGhost?: boolean;
  /** Progress toward leaving ghost mode (0 .. GHOST_PRATS_TO_LEAVE). */
  ghostPratsCaptured?: number;
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
 * Local player was hit or healed (projectile, octopus shot, prat heal, etc.).
 * Positive `damage` = hurt; negative = heal. Life stays authoritative in `players`.
 */
export interface ProjectileHitReceivedEvent {
  id: string;
  targetPlayerId: string;
  /** Who or what applied it: player id, `octopus:...`, or `prat` for heal letter. */
  attackerId: string;
  damage: number;
  x: number;
  y: number;
}

/**
 * A player projectile dealt damage (any valid target). Authoritative life stays in
 * `players` / `enemies` / `stingrays`; this drives attacker-side hit feedback (VFX).
 */
export interface ProjectileHitDealtEvent {
  id: string;
  targetKind: "player" | "octopus" | "stingray";
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
  /** You were damaged or healed; same broadcast rules as projectileHitDealtEvents. */
  projectileHitReceivedEvents: ProjectileHitReceivedEvent[];
  /** Your projectiles hit something; same broadcast rules as projectileHitReceivedEvents. */
  projectileHitDealtEvents: ProjectileHitDealtEvent[];
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
