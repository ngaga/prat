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

export interface SerializableGameState {
  timestamp: number;
  room: string;
  players: Record<string, PlayerState>;
  enemies: Record<string, EnemyState>;
  stingrays: Record<string, StingrayState>;
  prats: Record<string, PratState>;
  projectiles: Record<string, ProjectileState>;
  /** One-shot events per SSE tick: apply XP for attacker client-side if needed; state.players already updated on server. */
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
