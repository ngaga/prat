import {
  getLevelFromExperience,
  HEAL_LETTER_PROBABILITY,
  HEAL_PERCENT_OF_MAX,
  MAX_LIFE,
  GHOST_PRATS_TO_LEAVE,
  MAX_PRATS,
  OCTOPUS_PROJECTILE_DAMAGE,
  OCTOPUS_PROJECTILE_MAX_RANGE,
  OCTOPUS_PROJECTILE_SPEED_FACTOR,
  PLAYER_PROJECTILE_SHORT_RANGE,
  PRAT_CAPTURE_CLIENT_SERVER_MAX_OFFSET,
  PRAT_CAPTURE_RADIUS,
  PRAT_SPAWN_INTERVAL_MS,
  PRAT_SPAWN_RADIUS,
  STINGRAY_ESCAPE_SALVO_COUNT,
  STINGRAY_PASSENGER_LIFE_PER_SECOND,
  STINGRAY_REATTACH_COOLDOWN_MS,
  TOWN_CAPTURE_INTERCEPT_RADIUS,
  TOWN_CAPTURE_SALVOS_REQUIRED,
  TOWN_COUNT,
  XP_PER_OCTOPUS_OR_STINGRAY,
  XP_PER_PLAYER_KILL_PER_VICTIM_LEVEL,
  XP_PER_PRAT,
} from "@/lib/gameBalance";
import {
  LETTER_DAMAGE_SIMULATION_UNITS,
  PLAYER_BOAT_DIAMETER_SIMULATION_UNITS,
  PLAYER_LETTER_SPEED_SIMULATION_UNITS_PER_SECOND,
  PLAYER_PROJECTILE_MAX_TRAVEL_SIMULATION_UNITS,
  PROJECTILE_HIT_RADIUS_SIMULATION_UNITS,
  STINGRAY_AMPLITUDE_SIMULATION_UNITS,
  STINGRAY_PLAYER_CAPTURE_RADIUS_SIMULATION_UNITS,
  STINGRAY_SPEED_SIMULATION_UNITS_PER_SECOND,
  WORLD_HALF_EXTENT_SIMULATION_UNITS,
  WORLD_MARGIN_SIMULATION_UNITS,
} from "@/lib/simulationSpace";
import { playerIdToColor } from "@/lib/playerColor";
import {
  getOctopusesSpawnOnServer,
  getStingraysSpawnOnServer,
  refreshServerGameFeatureFlagsFromDatabase,
  startServerFeatureFlagsRefreshLoop,
} from "@/lib/serverGameFeatureFlags";
import type {
  EliminationEvent,
  EnemyState,
  ProjectileHitDealtEvent,
  PlayerInput,
  PlayerState,
  ProjectileHitReceivedEvent,
  PratState,
  ProjectileState,
  SerializableGameState,
  StingrayState,
  TownState,
} from "@/lib/gameTypes";

/** Server tick rate: 20 FPS (must match SSE stream interval so getState runs one tick before draining events) */
export const GAME_LOOP_INTERVAL_MS = 50;

const WORLD_SIZE = WORLD_HALF_EXTENT_SIMULATION_UNITS;
const WORLD_MARGIN = WORLD_MARGIN_SIMULATION_UNITS;
const WORLD_X_MIN = -WORLD_SIZE + WORLD_MARGIN;
const WORLD_X_MAX = WORLD_SIZE - WORLD_MARGIN;
const PLAYABLE_WIDTH_X = WORLD_X_MAX - WORLD_X_MIN;
const STINGRAY_CAPTURE_RADIUS = STINGRAY_PLAYER_CAPTURE_RADIUS_SIMULATION_UNITS;
const OCTOPUS_LIFE = 80;
const OCTOPUS_LIFETIME_MS = 20_000;
const OCTOPUS_SHOOT_DELAY_MS = 5000;
const OCTOPUS_SHOOT_INTERVAL_MS = 3000;
const OCTOPUS_SPAWN_CHECK_INTERVAL_MS = 3000;
const OCTOPUS_SPAWN_PROBABILITY = 1 / 3;
const MAX_OCTOPUSES_IN_WORLD = 8;
const BOSS_IDENTIFIER_PREFIX = "boss-";
const BOSS_MAX_LIFE = 1500;
const LEVEL_SUM_PER_BOSS_SPAWN = 10;
const BOSS_EXPERIENCE_POOL = 1200;
const BOSS_PROJECTILE_DAMAGE = 20;
const BOSS_SHOOT_INTERVAL_MS = Math.max(1, Math.floor(OCTOPUS_SHOOT_INTERVAL_MS / 3));
const ROOM_EMPTY_CLEANUP_MS = 120_000;
/** High enough that escape-by-salvos completes before typical death (5 salvos x 4 letters x damage). */
const STINGRAY_LIFE = 600;
const STINGRAY_WAVE_FREQUENCY = 0.5;
const STINGRAY_SPAWN_INTERVAL_MS = 4000;
/** Wrapped rays no longer despawn at the east edge, so cap count or spawns would grow without limit. */
const MAX_STINGRAYS_IN_WORLD = 6;
const STINGRAY_VENGEANCE_HERD_SIZE = 16;
const STINGRAY_VENGEANCE_DURATION_MS = 10_000;
const STINGRAY_VENGEANCE_SPEED_MULTIPLIER = 2.2;
const STINGRAY_VENGEANCE_TRIGGER_COOLDOWN_MS = 4_000;
const STINGRAY_VENGEANCE_SPAWN_OFFSET_FROM_KILLER_X = 550;

const LETTER_SPEED_SIMULATION_UNITS_PER_SECOND = PLAYER_LETTER_SPEED_SIMULATION_UNITS_PER_SECOND;
const LETTER_DAMAGE = LETTER_DAMAGE_SIMULATION_UNITS;
const PROJECTILE_HIT_RADIUS = PROJECTILE_HIT_RADIUS_SIMULATION_UNITS;
const PROJECTILE_MAX_RANGE = PLAYER_PROJECTILE_MAX_TRAVEL_SIMULATION_UNITS;
const PRAT_LETTERS = ["P", "R", "A", "T"];
const PRAT_WORDS = ["prat", "PRAT", "prat", "PrAt", "prat"];
const PRAT_STYLE_ROLLS: { fontStyle: string; power: number }[] = [
  { fontStyle: "bold", power: 2 },
  { fontStyle: "bold", power: 3 },
];
const SALVO_LETTER_DELAY_MS = 80;
const SHOOT_START_TOLERANCE = 120;
const SHOOT_TIMESTAMP_SLACK_MS = 15_000;
const TOWN_SHOOT_INTERVAL_MS = Math.floor(OCTOPUS_SHOOT_INTERVAL_MS / 2);
const WILD_TOWN_SHOOT_INTERVAL_MS = Math.max(1, Math.floor(OCTOPUS_SHOOT_INTERVAL_MS / 10));
const WILD_TOWN_SHOOT_RANGE_SIMULATION_UNITS = 300;
const SHORT_RANGE_OSCILLATION_AMPLITUDE = 18;
const SHORT_RANGE_OSCILLATION_FREQUENCY = 10;

function distance(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

function randomInWorld(): { x: number; y: number } {
  const min = -WORLD_SIZE + WORLD_MARGIN;
  const max = WORLD_SIZE - WORLD_MARGIN;
  return {
    x: min + Math.random() * (max - min),
    y: min + Math.random() * (max - min),
  };
}

function clampWorld(value: number): number {
  const min = -WORLD_SIZE + WORLD_MARGIN;
  const max = WORLD_SIZE - WORLD_MARGIN;
  return Math.min(max, Math.max(min, value));
}

function wrapPlayableX(x: number): number {
  let next = x;
  while (next > WORLD_X_MAX) {
    next -= PLAYABLE_WIDTH_X;
  }
  while (next < WORLD_X_MIN) {
    next += PLAYABLE_WIDTH_X;
  }
  return next;
}

function nearestPlayer(enemyX: number, enemyY: number, players: Map<string, PlayerState>): PlayerState | null {
  let best: PlayerState | null = null;
  let bestDist = Infinity;
  for (const state of players.values()) {
    const d = distance(enemyX, enemyY, state.x, state.y);
    if (d < bestDist) {
      bestDist = d;
      best = state;
    }
  }
  return best;
}

function randomEventSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

interface ServerProjectile {
  id: string;
  shooterId: string;
  originX: number;
  originY: number;
  x: number;
  y: number;
  directionX: number;
  directionY: number;
  speed: number;
  damage: number;
  letter: string;
  salvoReleaseTime: number;
  salvoId: string;
  maxRange: number;
  isShortRange: boolean;
  oscillationAmplitude: number;
  oscillationFrequency: number;
  oscillationPhase: number;
}

interface ServerTown {
  id: string;
  x: number;
  y: number;
  ownerId: string | null;
  contenderId: string | null;
  contenderSalvos: number;
  lastShotTime: number;
}

function octopusProjectileShooterId(octopusEnemyId: string): string {
  return `octopus:${octopusEnemyId}`;
}

function projectileIsFromOctopus(projectile: ServerProjectile): boolean {
  return projectile.shooterId.startsWith("octopus:");
}

function enemyIsBoss(enemyId: string): boolean {
  return enemyId.startsWith(BOSS_IDENTIFIER_PREFIX);
}

export class GameRoom {
  readonly roomId: string;
  private players = new Map<string, PlayerState>();
  private playerPresence = new Map<string, number>();
  private enemies = new Map<string, EnemyState>();
  private stingrays = new Map<string, StingrayState>();
  private prats = new Map<string, PratState>();
  private towns = new Map<string, ServerTown>();
  private projectiles = new Map<string, ServerProjectile>();
  private nextEnemyId = 0;
  private nextStingrayId = 0;
  private nextProjectileId = 0;
  private nextPratId = 0;
  private nextTownId = 0;
  private lastOctopusSpawnCheckTime = 0;
  private lastStingraySpawnTime = 0;
  private lastPratSpawnTime = 0;
  private emptySince: number | null = null;
  /** Simulation is advanced here and in runSimulationTickIfDue, not on a separate timer (avoids racing getState). */
  private lastSimulationTime = 0;
  /** Filled during update() and tryPratCapture; flushed at end of update() into broadcast buffers. */
  private pendingProjectileHitReceived: ProjectileHitReceivedEvent[] = [];
  private pendingEliminations: EliminationEvent[] = [];
  /**
   * One batch per simulation tick, not drained per getState(), so multiple SSE clients see the same events.
   * Cleared at the start of each update(); prat heal queued in pending is merged at end of update().
   */
  private projectileHitReceivedEventsForBroadcast: ProjectileHitReceivedEvent[] = [];
  private pendingProjectileHitDealt: ProjectileHitDealtEvent[] = [];
  private projectileHitDealtEventsForBroadcast: ProjectileHitDealtEvent[] = [];
  private eliminationEventsForBroadcast: EliminationEvent[] = [];
  /** Ignore MOVE inputs older than the last applied one (out-of-order HTTP responses). */
  private lastAcceptedMoveClientWallTimestamp = new Map<string, number>();
  private nextBossSpawnAtLevelSum = LEVEL_SUM_PER_BOSS_SPAWN;
  private bossDamageByPlayerId = new Map<string, number>();
  private lastVengeanceHerdSpawnAtByKillerId = new Map<string, number>();

  constructor(roomId: string) {
    this.roomId = roomId;
    const now = Date.now();
    this.lastOctopusSpawnCheckTime = now;
    this.lastStingraySpawnTime = now;
    this.lastPratSpawnTime = now;
    this.spawnInitialPrats();
    this.spawnInitialTowns();
    this.lastSimulationTime = Date.now() - GAME_LOOP_INTERVAL_MS;
  }

  /**
   * Runs at most one simulation step per GAME_LOOP_INTERVAL_MS so multiple SSE clients do not double the tick rate.
   * getState() reads broadcast buffers (filled at end of update) so all stream connections get the same events.
   */
  runSimulationTickIfDue(now: number): void {
    if (now - this.lastSimulationTime < GAME_LOOP_INTERVAL_MS) return;
    this.update();
    this.lastSimulationTime = now;
  }

  private defaultPlayer(playerId: string): PlayerState {
    const { x, y } = randomInWorld();
    return {
      x,
      y,
      rotation: 0,
      score: 0,
      life: MAX_LIFE,
      level: 1,
      experience: 0,
      killsOctopus: 0,
      killsStingray: 0,
      pratsCaptured: 0,
      prats: 0,
      color: playerIdToColor(playerId),
      isGhost: false,
      ghostPratsCaptured: 0,
    };
  }

  private spawnInitialPrats(): void {
    for (let index = 0; index < 40; index++) {
      const { x, y } = randomInWorld();
      this.spawnPratAt(x, y);
    }
  }

  private spawnInitialTowns(): void {
    const now = Date.now();
    for (let index = 0; index < TOWN_COUNT; index++) {
      const { x, y } = randomInWorld();
      const id = `town-${this.nextTownId++}`;
      this.towns.set(id, {
        id,
        x: clampWorld(x),
        y: clampWorld(y),
        ownerId: null,
        contenderId: null,
        contenderSalvos: 0,
        lastShotTime: now,
      });
    }
  }

  private spawnPratAt(x: number, y: number): void {
    const id = `prat-${this.nextPratId++}`;
    const isHealLetter = Math.random() < HEAL_LETTER_PROBABILITY;
    if (isHealLetter) {
      const fontSize = 28;
      this.prats.set(id, {
        id,
        x: clampWorld(x),
        y: clampWorld(y),
        power: 0,
        word: "A",
        fontStyle: "bold",
        fontSize,
        color: "#00aa00",
        isHeal: true,
        healAmount: MAX_LIFE,
      });
      return;
    }
    const styleRoll = PRAT_STYLE_ROLLS[Math.floor(Math.random() * PRAT_STYLE_ROLLS.length)]!;
    const word = PRAT_WORDS[Math.floor(Math.random() * PRAT_WORDS.length)]!;
    const fontSize = 20 + Math.floor(Math.random() * 24);
    this.prats.set(id, {
      id,
      x: clampWorld(x),
      y: clampWorld(y),
      power: styleRoll.power,
      word,
      fontStyle: styleRoll.fontStyle,
      fontSize,
      color: "#000000",
      isHeal: false,
    });
  }

  private spawnPratsNearPlayers(now: number): void {
    if (this.prats.size >= MAX_PRATS) return;
    if (now - this.lastPratSpawnTime < PRAT_SPAWN_INTERVAL_MS) return;
    this.lastPratSpawnTime = now;
    const playerList = [...this.players.values()];
    for (let count = 0; count < 3; count++) {
      if (this.prats.size >= MAX_PRATS) break;
      if (playerList.length === 0) {
        const { x, y } = randomInWorld();
        this.spawnPratAt(x, y);
        continue;
      }
      const player = playerList[Math.floor(Math.random() * playerList.length)]!;
      const angle = Math.random() * Math.PI * 2;
      const dist = PRAT_SPAWN_RADIUS + Math.random() * 400;
      const x = clampWorld(player.x + Math.cos(angle) * dist);
      const y = clampWorld(player.y + Math.sin(angle) * dist);
      this.spawnPratAt(x, y);
    }
  }

  startLoop(): void {
    // Simulation is driven by getState (SSE) and runSimulationTickIfDue (after input).
  }

  stopLoop(): void {
    // No background interval; kept for GameEngine maintenance API.
  }

  touchPlayer(playerId: string): void {
    this.playerPresence.set(playerId, Date.now());
    if (!this.players.has(playerId)) {
      this.players.set(playerId, this.defaultPlayer(playerId));
    }
    this.emptySince = null;
  }

  removePlayer(playerId: string): void {
    this.playerPresence.delete(playerId);
    this.lastAcceptedMoveClientWallTimestamp.delete(playerId);
    this.players.delete(playerId);
    if (this.players.size === 0 && this.emptySince === null) {
      this.emptySince = Date.now();
    }
  }

  shouldCleanup(now: number): boolean {
    if (this.players.size > 0) return false;
    if (this.emptySince === null) return false;
    return now - this.emptySince >= ROOM_EMPTY_CLEANUP_MS;
  }

  handlePlayerInput(playerId: string, input: PlayerInput): Record<string, never> {
    this.touchPlayer(playerId);
    if (input.type === "MOVE" && input.x !== undefined && input.y !== undefined) {
      const previous = this.players.get(playerId) ?? this.defaultPlayer(playerId);
      const lastAcceptedClientWallTimestamp =
        this.lastAcceptedMoveClientWallTimestamp.get(playerId) ?? 0;
      if (input.timestamp < lastAcceptedClientWallTimestamp) {
        return {};
      }
      this.lastAcceptedMoveClientWallTimestamp.set(playerId, input.timestamp);
      const carriedByStingray =
        previous.attachedStingrayId !== undefined &&
        this.stingrays.has(previous.attachedStingrayId);
      if (carriedByStingray) {
        this.players.set(playerId, {
          ...previous,
          rotation: input.rotation ?? previous.rotation,
          name: input.name ?? previous.name,
          isGhost: previous.isGhost,
          ghostPratsCaptured: previous.ghostPratsCaptured,
        });
        return {};
      }
      this.players.set(playerId, {
        ...previous,
        x: input.x,
        y: input.y,
        rotation: input.rotation ?? previous.rotation,
        name: input.name ?? previous.name,
        isGhost: previous.isGhost,
        ghostPratsCaptured: previous.ghostPratsCaptured,
      });
      return {};
    }
    if (input.type === "ROTATE" && input.rotation !== undefined) {
      const previous = this.players.get(playerId) ?? this.defaultPlayer(playerId);
      this.players.set(playerId, {
        ...previous,
        rotation: input.rotation,
        isGhost: previous.isGhost,
        ghostPratsCaptured: previous.ghostPratsCaptured,
      });
      return {};
    }
    if (input.type === "SYNC_PROFILE") {
      const previous = this.players.get(playerId) ?? this.defaultPlayer(playerId);
      let experience = previous.experience ?? 0;
      if (input.experience !== undefined) experience = input.experience;
      const level = getLevelFromExperience(experience);

      let nextIsGhost = previous.isGhost ?? false;
      let nextGhostPrats = previous.ghostPratsCaptured ?? 0;
      const nextX = previous.x;
      const nextY = previous.y;
      let nextLife = previous.life ?? MAX_LIFE;

      if (input.isGhost === true) {
        const raw = Math.max(0, input.ghostPratsCaptured ?? 0);
        if (raw >= GHOST_PRATS_TO_LEAVE) {
          nextIsGhost = false;
          nextGhostPrats = 0;
          nextLife = MAX_LIFE;
        } else {
          nextIsGhost = true;
          nextGhostPrats = raw;
          nextLife = MAX_LIFE;
        }
      }

      this.players.set(playerId, {
        ...previous,
        x: nextX,
        y: nextY,
        life: nextIsGhost ? MAX_LIFE : nextLife,
        experience,
        level,
        killsOctopus: input.killsOctopus ?? previous.killsOctopus ?? 0,
        killsStingray: input.killsStingray ?? previous.killsStingray ?? 0,
        pratsCaptured: input.pratsCaptured ?? previous.pratsCaptured ?? 0,
        prats: input.prats ?? previous.prats ?? 0,
        isGhost: nextIsGhost,
        ghostPratsCaptured: nextGhostPrats,
      });
      return {};
    }
    if (input.type === "PRAT_CAPTURE") {
      this.tryPratCapture(playerId, input);
      return {};
    }
    if (input.type === "TOWN_SEND_SALVO") {
      this.tryTownSendSalvo(playerId, input);
      return {};
    }
    if (input.type === "SHOOT") {
      const shooter = this.players.get(playerId);
      if (!shooter?.isGhost) {
        this.spawnPlayerSalvo(playerId, input);
      }
    }
    return {};
  }

  private tryPratCapture(playerId: string, input: PlayerInput): void {
    const pratId = typeof input.pratId === "string" ? input.pratId : "";
    if (!pratId) return;
    const playerState = this.players.get(playerId);
    const prat = this.prats.get(pratId);
    if (!playerState || !prat) return;

    const reportedX = input.x;
    const reportedY = input.y;
    let captureX = playerState.x;
    let captureY = playerState.y;

    if (reportedX !== undefined && reportedY !== undefined) {
      if (distance(reportedX, reportedY, playerState.x, playerState.y) > PRAT_CAPTURE_CLIENT_SERVER_MAX_OFFSET) {
        return;
      }
      if (distance(reportedX, reportedY, prat.x, prat.y) > PRAT_CAPTURE_RADIUS) {
        return;
      }
      captureX = reportedX;
      captureY = reportedY;
    } else {
      if (distance(playerState.x, playerState.y, prat.x, prat.y) > PRAT_CAPTURE_RADIUS) {
        return;
      }
    }
    // TODO: remove isHeal logic from this function.
    if (prat.isHeal) {
      const previousLife = playerState.life ?? MAX_LIFE;
      playerState.life = MAX_LIFE;
      const restored = MAX_LIFE - previousLife;
      if (restored > 0) {
        this.pendingProjectileHitReceived.push({
          id: `hit-rcv-${randomEventSuffix()}`,
          targetPlayerId: playerId,
          attackerId: "prat",
          damage: -restored,
          x: captureX,
          y: captureY,
        });
      }
    } else if (playerState.isGhost) {
      const next = (playerState.ghostPratsCaptured ?? 0) + 1;
      if (next >= GHOST_PRATS_TO_LEAVE) {
        playerState.isGhost = false;
        playerState.ghostPratsCaptured = 0;
        playerState.life = MAX_LIFE;
      } else {
        playerState.ghostPratsCaptured = next;
      }
    } else {
      const lifeRestore = Math.floor(MAX_LIFE * HEAL_PERCENT_OF_MAX);
      const previousLife = playerState.life ?? MAX_LIFE;
      playerState.life = Math.min(MAX_LIFE, previousLife + lifeRestore);
      if (lifeRestore > 0) {
        this.pendingProjectileHitReceived.push({
          id: `hit-rcv-${randomEventSuffix()}`,
          targetPlayerId: playerId,
          attackerId: "prat",
          damage: -lifeRestore,
          x: captureX,
          y: captureY,
        });
      }
      playerState.score = (playerState.score ?? 0) + prat.power;
      playerState.experience = (playerState.experience ?? 0) + XP_PER_PRAT;
      playerState.level = getLevelFromExperience(playerState.experience);
    }
    if (!prat.isHeal) {
      playerState.pratsCaptured = (playerState.pratsCaptured ?? 0) + 1;
      playerState.prats = (playerState.prats ?? 0) + 1;
    }
    playerState.x = captureX;
    playerState.y = captureY;
    this.prats.delete(pratId);
    this.players.set(playerId, playerState);
  }

  private tryTownSendSalvo(playerId: string, input: PlayerInput): void {
    const townId = typeof input.townId === "string" ? input.townId : "";
    if (!townId) return;
    const playerState = this.players.get(playerId);
    if (!playerState || !this.towns.has(townId)) return;
    if (playerState.isGhost) return;

    const available = playerState.prats ?? 0;
    if (available <= 0) return;

    playerState.prats = available - 1;
    this.players.set(playerId, playerState);
    this.applyTownCaptureProgress(playerId, townId);
  }

  private spawnTownShotAtPlayer(town: ServerTown, targetPlayer: PlayerState, now: number): void {
    const startX = town.x;
    const startY = town.y;
    let directionX = targetPlayer.x - startX;
    let directionY = targetPlayer.y - startY;
    const length = Math.sqrt(directionX * directionX + directionY * directionY);
    if (length < 1) return;
    directionX /= length;
    directionY /= length;

    const shooterId = `town:${town.id}`;
    const speed = LETTER_SPEED_SIMULATION_UNITS_PER_SECOND * OCTOPUS_PROJECTILE_SPEED_FACTOR;
    const salvoId = `salvo-${this.nextProjectileId}`;

    for (let letterIndex = 0; letterIndex < PRAT_LETTERS.length; letterIndex++) {
      const id = `proj-${this.nextProjectileId++}`;
      this.projectiles.set(id, {
        id,
        shooterId,
        originX: startX,
        originY: startY,
        x: startX,
        y: startY,
        directionX,
        directionY,
        speed,
        damage: OCTOPUS_PROJECTILE_DAMAGE,
        letter: PRAT_LETTERS[letterIndex],
        salvoReleaseTime: now + letterIndex * SALVO_LETTER_DELAY_MS,
        salvoId,
        maxRange: OCTOPUS_PROJECTILE_MAX_RANGE,
        isShortRange: false,
        oscillationAmplitude: 0,
        oscillationFrequency: 0,
        oscillationPhase: 0,
      });
    }
  }

  private spawnOctopusSalvo(enemy: EnemyState, target: PlayerState, now: number): void {
    const startX = enemy.x;
    const startY = enemy.y;
    let directionX = target.x - startX;
    let directionY = target.y - startY;
    const length = Math.sqrt(directionX * directionX + directionY * directionY);
    if (length < 1) return;
    directionX /= length;
    directionY /= length;

    const shooterId = octopusProjectileShooterId(enemy.id);
    const speed = LETTER_SPEED_SIMULATION_UNITS_PER_SECOND * OCTOPUS_PROJECTILE_SPEED_FACTOR;
    const salvoId = `salvo-${this.nextProjectileId}`;
    const enemyProjectileDamage = enemyIsBoss(enemy.id) ? BOSS_PROJECTILE_DAMAGE : OCTOPUS_PROJECTILE_DAMAGE;

    for (let letterIndex = 0; letterIndex < PRAT_LETTERS.length; letterIndex++) {
      const id = `proj-${this.nextProjectileId++}`;
      this.projectiles.set(id, {
        id,
        shooterId,
        originX: startX,
        originY: startY,
        x: startX,
        y: startY,
        directionX,
        directionY,
        speed,
        damage: enemyProjectileDamage,
        letter: PRAT_LETTERS[letterIndex],
        salvoReleaseTime: now + letterIndex * SALVO_LETTER_DELAY_MS,
        salvoId,
        maxRange: OCTOPUS_PROJECTILE_MAX_RANGE,
        isShortRange: false,
        oscillationAmplitude: 0,
        oscillationFrequency: 0,
        oscillationPhase: 0,
      });
    }
  }

  private spawnPlayerSalvo(playerId: string, input: PlayerInput): void {
    const shooter = this.players.get(playerId);
    if (!shooter || shooter.isGhost) return;
    if (
      input.startX === undefined ||
      input.startY === undefined ||
      input.targetX === undefined ||
      input.targetY === undefined
    ) {
      return;
    }

    const now = Date.now();
    if (Math.abs(input.timestamp - now) > SHOOT_TIMESTAMP_SLACK_MS) return;
    if (distance(shooter.x, shooter.y, input.startX, input.startY) > SHOOT_START_TOLERANCE) return;

    let directionX = input.targetX - input.startX;
    let directionY = input.targetY - input.startY;
    const length = Math.sqrt(directionX * directionX + directionY * directionY);
    if (length < 1) return;
    directionX /= length;
    directionY /= length;

    const hasPrats = (shooter.prats ?? 0) > 0;
    const targetDistance = distance(input.startX, input.startY, input.targetX, input.targetY);
    const useShortRange = !hasPrats || targetDistance < PLAYER_BOAT_DIAMETER_SIMULATION_UNITS;
    const projectileMaxRange = useShortRange ? PLAYER_PROJECTILE_SHORT_RANGE : PROJECTILE_MAX_RANGE;
    if (!useShortRange) {
      shooter.prats = (shooter.prats ?? 0) - 1;
      this.players.set(playerId, shooter);
    }
    const salvoId = `salvo-${this.nextProjectileId}`;

    for (let letterIndex = 0; letterIndex < PRAT_LETTERS.length; letterIndex++) {
      const id = `proj-${this.nextProjectileId++}`;
      this.projectiles.set(id, {
        id,
        shooterId: playerId,
        originX: input.startX,
        originY: input.startY,
        x: input.startX,
        y: input.startY,
        directionX,
        directionY,
        speed: LETTER_SPEED_SIMULATION_UNITS_PER_SECOND,
        damage: LETTER_DAMAGE,
        letter: PRAT_LETTERS[letterIndex],
        salvoReleaseTime: now + letterIndex * SALVO_LETTER_DELAY_MS,
        salvoId,
        maxRange: projectileMaxRange,
        isShortRange: useShortRange,
        oscillationAmplitude: useShortRange ? SHORT_RANGE_OSCILLATION_AMPLITUDE : 0,
        oscillationFrequency: useShortRange ? SHORT_RANGE_OSCILLATION_FREQUENCY : 0,
        oscillationPhase: useShortRange ? Math.random() * Math.PI * 2 : 0,
      });
    }
  }

  private update(): void {
    const now = Date.now();
    this.projectileHitReceivedEventsForBroadcast = [];
    this.projectileHitDealtEventsForBroadcast = [];
    this.eliminationEventsForBroadcast = [];
    this.updateEnemiesAndSpawns(now);
    this.updateStingrays(now);
    this.applyStingrayPlayerAttachment(now);
    this.spawnPratsNearPlayers(now);
    this.updateTowns(now);
    this.updateProjectiles(now);
    if (this.players.size === 0 && this.emptySince === null) {
      this.emptySince = now;
    }
    this.projectileHitReceivedEventsForBroadcast.push(...this.pendingProjectileHitReceived);
    this.pendingProjectileHitReceived.length = 0;
    this.projectileHitDealtEventsForBroadcast.push(...this.pendingProjectileHitDealt);
    this.pendingProjectileHitDealt.length = 0;
    this.eliminationEventsForBroadcast.push(...this.pendingEliminations);
    this.pendingEliminations.length = 0;
  }

  private sumOfAllPlayerLevels(): number {
    let sum = 0;
    for (const player of this.players.values()) {
      sum += Math.max(1, Math.floor(player.level ?? 1));
    }
    return sum;
  }

  private getActiveBossEnemyId(): string | null {
    for (const [enemyId] of this.enemies) {
      if (enemyIsBoss(enemyId)) return enemyId;
    }
    return null;
  }

  private maybeSpawnBoss(now: number): void {
    const existingBossId = this.getActiveBossEnemyId();
    if (existingBossId) return;
    const levelSum = this.sumOfAllPlayerLevels();
    if (levelSum < this.nextBossSpawnAtLevelSum) return;
    const spawnPoint = randomInWorld();
    const bossId = `${BOSS_IDENTIFIER_PREFIX}${this.nextEnemyId++}`;
    this.enemies.set(bossId, {
      id: bossId,
      x: spawnPoint.x,
      y: spawnPoint.y,
      life: BOSS_MAX_LIFE,
      maxLife: BOSS_MAX_LIFE,
      velocityX: 0,
      velocityY: 0,
      lastShotTime: 0,
      spawnTime: now,
    });
    this.bossDamageByPlayerId.clear();
    while (levelSum >= this.nextBossSpawnAtLevelSum) {
      this.nextBossSpawnAtLevelSum += LEVEL_SUM_PER_BOSS_SPAWN;
    }
  }

  private recordBossDamage(playerId: string, damage: number): void {
    if (damage <= 0) return;
    const previous = this.bossDamageByPlayerId.get(playerId) ?? 0;
    this.bossDamageByPlayerId.set(playerId, previous + damage);
  }

  private grantBossExperienceByDamageShare(lastAttackerId: string): void {
    const damageEntries = [...this.bossDamageByPlayerId.entries()].filter((entry) => entry[1] > 0);
    const totalDamage = damageEntries.reduce((sum, [, damage]) => sum + damage, 0);
    if (totalDamage <= 0) {
      const fallbackAttacker = this.players.get(lastAttackerId);
      if (fallbackAttacker && !fallbackAttacker.isGhost) {
        fallbackAttacker.experience = (fallbackAttacker.experience ?? 0) + BOSS_EXPERIENCE_POOL;
        fallbackAttacker.level = getLevelFromExperience(fallbackAttacker.experience);
        this.players.set(lastAttackerId, fallbackAttacker);
      }
      this.bossDamageByPlayerId.clear();
      return;
    }
    for (const [playerId, playerDamage] of damageEntries) {
      const player = this.players.get(playerId);
      if (!player || player.isGhost) continue;
      const proportionalExperience = Math.max(
        1,
        Math.round((BOSS_EXPERIENCE_POOL * playerDamage) / totalDamage)
      );
      player.experience = (player.experience ?? 0) + proportionalExperience;
      player.level = getLevelFromExperience(player.experience);
      this.players.set(playerId, player);
    }
    this.bossDamageByPlayerId.clear();
  }

  private updateTowns(now: number): void {
    for (const town of this.towns.values()) {
      const isWildTown = !town.ownerId;
      const townShootInterval = isWildTown ? WILD_TOWN_SHOOT_INTERVAL_MS : TOWN_SHOOT_INTERVAL_MS;
      const townShootRange = isWildTown ? WILD_TOWN_SHOOT_RANGE_SIMULATION_UNITS : OCTOPUS_PROJECTILE_MAX_RANGE;
      if (now - town.lastShotTime < townShootInterval) continue;

      let bestTarget: PlayerState | null = null;
      let bestDist = Infinity;
      for (const [playerId, player] of this.players) {
        if (!isWildTown && playerId === town.ownerId) continue;
        if (player.isGhost) continue;
        const d = distance(town.x, town.y, player.x, player.y);
        if (d < bestDist) {
          bestDist = d;
          bestTarget = player;
        }
      }
      if (!bestTarget) continue;
      if (bestDist > townShootRange) continue;
      town.lastShotTime = now;
      this.spawnTownShotAtPlayer(town, bestTarget, now);
    }
  }

  private updateEnemiesAndSpawns(now: number): void {
    if (!getOctopusesSpawnOnServer()) {
      this.enemies.clear();
      for (const projectileId of [...this.projectiles.keys()]) {
        const projectile = this.projectiles.get(projectileId);
        if (projectile && projectileIsFromOctopus(projectile)) {
          this.projectiles.delete(projectileId);
        }
      }
      return;
    }

    const toRemoveEnemy: string[] = [];
    for (const enemy of this.enemies.values()) {
      if (!enemyIsBoss(enemy.id) && now - enemy.spawnTime >= OCTOPUS_LIFETIME_MS) {
        toRemoveEnemy.push(enemy.id);
        continue;
      }
      enemy.x += enemy.velocityX * (GAME_LOOP_INTERVAL_MS / 1000);
      enemy.y += enemy.velocityY * (GAME_LOOP_INTERVAL_MS / 1000);

      const enemyShootInterval = enemyIsBoss(enemy.id) ? BOSS_SHOOT_INTERVAL_MS : OCTOPUS_SHOOT_INTERVAL_MS;
      const playerTarget = nearestPlayer(enemy.x, enemy.y, this.players);
      if (
        playerTarget &&
        now - enemy.spawnTime >= OCTOPUS_SHOOT_DELAY_MS &&
        now - enemy.lastShotTime >= enemyShootInterval
      ) {
        enemy.lastShotTime = now;
        this.spawnOctopusSalvo(enemy, playerTarget, now);
      }
    }
    for (const id of toRemoveEnemy) {
      this.enemies.delete(id);
    }

    if (
      getOctopusesSpawnOnServer() &&
      this.enemies.size < MAX_OCTOPUSES_IN_WORLD &&
      now - this.lastOctopusSpawnCheckTime >= OCTOPUS_SPAWN_CHECK_INTERVAL_MS &&
      Math.random() < OCTOPUS_SPAWN_PROBABILITY
    ) {
      this.lastOctopusSpawnCheckTime = now;
      this.spawnEnemy(now);
    }
    this.maybeSpawnBoss(now);
  }

  private updateStingrays(now: number): void {
    if (!getStingraysSpawnOnServer()) {
      this.detachAllPlayersFromStingrays();
      this.stingrays.clear();
      return;
    }

    const deltaSeconds = GAME_LOOP_INTERVAL_MS / 1000;
    const toRemove: string[] = [];

    if (
      this.stingrays.size < MAX_STINGRAYS_IN_WORLD &&
      now - this.lastStingraySpawnTime >= STINGRAY_SPAWN_INTERVAL_MS
    ) {
      this.lastStingraySpawnTime = now;
      this.spawnStingray(now);
    }

    for (const stingray of this.stingrays.values()) {
      const targetPlayerId = stingray.vengeanceTargetPlayerId;
      const vengeanceEndsAtTimestamp = stingray.vengeanceEndsAtTimestamp ?? 0;
      const inVengeanceMode = targetPlayerId !== undefined && now <= vengeanceEndsAtTimestamp;
      if (inVengeanceMode) {
        const targetPlayer = this.players.get(targetPlayerId);
        if (targetPlayer && !targetPlayer.isGhost) {
          const directionX = Math.sign(targetPlayer.x - stingray.x);
          if (directionX !== 0) {
            const stepDistance =
              STINGRAY_SPEED_SIMULATION_UNITS_PER_SECOND *
              STINGRAY_VENGEANCE_SPEED_MULTIPLIER *
              deltaSeconds;
            stingray.x = clampWorld(stingray.x + directionX * stepDistance);
          }
          // Keep fixed lane height during vengeance charge.
          stingray.y = stingray.baseY;
        } else {
          stingray.vengeanceTargetPlayerId = undefined;
          stingray.vengeanceEndsAtTimestamp = undefined;
          stingray.baseY = stingray.y;
          stingray.spawnTime = now;
        }
      } else {
        if (targetPlayerId !== undefined) {
          stingray.vengeanceTargetPlayerId = undefined;
          stingray.vengeanceEndsAtTimestamp = undefined;
          stingray.baseY = stingray.y;
          stingray.spawnTime = now;
        }
        stingray.x += STINGRAY_SPEED_SIMULATION_UNITS_PER_SECOND * deltaSeconds;
        stingray.x = wrapPlayableX(stingray.x);
        const elapsedSeconds = (now - stingray.spawnTime) / 1000;
        stingray.y =
          stingray.baseY +
          STINGRAY_AMPLITUDE_SIMULATION_UNITS * Math.sin(2 * Math.PI * STINGRAY_WAVE_FREQUENCY * elapsedSeconds);
      }
      if (stingray.life <= 0) {
        if (this.stingrayHasPassenger(stingray.id)) {
          stingray.life = 1;
        } else {
          toRemove.push(stingray.id);
        }
      }
    }

    for (const stingrayId of toRemove) {
      this.detachPlayersFromStingray(stingrayId);
      this.stingrays.delete(stingrayId);
    }
  }

  /** True if a non-ghost player is locked to this stingray (wrap ride must not delete the ray). */
  private stingrayHasPassenger(stingrayId: string): boolean {
    for (const p of this.players.values()) {
      if (p.isGhost) continue;
      if (p.attachedStingrayId === stingrayId) return true;
    }
    return false;
  }

  private detachPlayersFromStingray(stingrayId: string): void {
    for (const [playerId, player] of this.players) {
      if (player.attachedStingrayId !== stingrayId) continue;
      this.players.set(playerId, {
        ...player,
        attachedStingrayId: undefined,
        stingrayEscapeSalvoHits: 0,
        stingrayEscapeLastCountedSalvoId: undefined,
      });
    }
  }

  private detachAllPlayersFromStingrays(): void {
    for (const [playerId, player] of this.players) {
      if (player.attachedStingrayId === undefined) continue;
      this.players.set(playerId, {
        ...player,
        attachedStingrayId: undefined,
        stingrayEscapeSalvoHits: 0,
        stingrayEscapeLastCountedSalvoId: undefined,
      });
    }
  }

  /**
   * While attached, snap to the carrying stingray every tick without a distance check so map wrap
   * does not drop the player (toroidal gap would exceed STINGRAY_CAPTURE_RADIUS).
   */
  private applyStingrayPlayerAttachment(now: number): void {
    const stingrayIds = new Set(this.stingrays.keys());

    for (const playerId of [...this.players.keys()]) {
      const player = this.players.get(playerId);
      if (!player || !player.isGhost) continue;
      if (player.attachedStingrayId === undefined) continue;
      this.players.set(playerId, {
        ...player,
        attachedStingrayId: undefined,
        stingrayEscapeSalvoHits: 0,
        stingrayEscapeLastCountedSalvoId: undefined,
      });
    }

    for (const playerId of [...this.players.keys()]) {
      const player = this.players.get(playerId);
      if (!player || player.isGhost) continue;
      const attachedId = player.attachedStingrayId;
      if (attachedId !== undefined && !stingrayIds.has(attachedId)) {
        this.players.set(playerId, {
          ...player,
          attachedStingrayId: undefined,
          stingrayEscapeSalvoHits: 0,
          stingrayEscapeLastCountedSalvoId: undefined,
        });
      }
    }

    for (const playerId of [...this.players.keys()]) {
      const player = this.players.get(playerId);
      if (!player || player.isGhost) continue;
      const current = this.players.get(playerId)!;

      const carryingId = current.attachedStingrayId;
      if (carryingId !== undefined && stingrayIds.has(carryingId)) {
        const stingray = this.stingrays.get(carryingId)!;
        this.players.set(playerId, {
          ...current,
          x: stingray.x,
          y: clampWorld(stingray.y),
          attachedStingrayId: carryingId,
        });
        continue;
      }

      if (now < (current.stingrayReattachBlockedUntilTimestamp ?? 0)) {
        continue;
      }

      let closestId: string | null = null;
      let closestDist = Infinity;
      for (const [stingrayId, stingray] of this.stingrays) {
        const dist = distance(current.x, current.y, stingray.x, stingray.y);
        if (dist < STINGRAY_CAPTURE_RADIUS && dist < closestDist) {
          closestDist = dist;
          closestId = stingrayId;
        }
      }

      if (closestId !== null) {
        const stingray = this.stingrays.get(closestId)!;
        const switchedRay =
          current.attachedStingrayId !== undefined && current.attachedStingrayId !== closestId;
        const newGrab = current.attachedStingrayId === undefined;
        const resetEscape = switchedRay || newGrab;
        this.players.set(playerId, {
          ...current,
          x: stingray.x,
          y: clampWorld(stingray.y),
          attachedStingrayId: closestId,
          stingrayEscapeSalvoHits: resetEscape ? 0 : (current.stingrayEscapeSalvoHits ?? 0),
          stingrayEscapeLastCountedSalvoId: resetEscape ? undefined : current.stingrayEscapeLastCountedSalvoId,
        });
      }
    }

    const deltaSeconds = GAME_LOOP_INTERVAL_MS / 1000;
    const healThisTick = STINGRAY_PASSENGER_LIFE_PER_SECOND * deltaSeconds;
    for (const [playerId, passenger] of this.players) {
      if (passenger.isGhost) continue;
      const carryingStingrayId = passenger.attachedStingrayId;
      if (carryingStingrayId === undefined || !stingrayIds.has(carryingStingrayId)) continue;
      const currentLife = passenger.life ?? MAX_LIFE;
      if (currentLife >= MAX_LIFE) continue;
      this.players.set(playerId, {
        ...passenger,
        life: Math.min(MAX_LIFE, currentLife + healThisTick),
      });
    }
  }

  private spawnStingray(now: number): void {
    const minY = -WORLD_SIZE + WORLD_MARGIN;
    const maxY = WORLD_SIZE - WORLD_MARGIN;
    const baseY = minY + Math.random() * (maxY - minY);
    const spawnX = -WORLD_SIZE + WORLD_MARGIN;
    const id = `stingray-${this.nextStingrayId++}`;
    this.stingrays.set(id, {
      id,
      x: spawnX,
      y: baseY,
      life: STINGRAY_LIFE,
      maxLife: STINGRAY_LIFE,
      baseY,
      spawnTime: now,
    });
  }

  private spawnVengeanceStingrayHerdAtKiller(killerId: string, now: number): void {
    const killer = this.players.get(killerId);
    if (!killer || killer.isGhost) return;
    const lastSpawnAt = this.lastVengeanceHerdSpawnAtByKillerId.get(killerId) ?? 0;
    if (now - lastSpawnAt < STINGRAY_VENGEANCE_TRIGGER_COOLDOWN_MS) return;
    this.lastVengeanceHerdSpawnAtByKillerId.set(killerId, now);
    const spawnX = clampWorld(killer.x - STINGRAY_VENGEANCE_SPAWN_OFFSET_FROM_KILLER_X);
    const minY = -WORLD_SIZE + WORLD_MARGIN;
    const maxY = WORLD_SIZE - WORLD_MARGIN;
    const verticalSpan = 1000;
    const startY = killer.y - verticalSpan / 2;
    const stepY = STINGRAY_VENGEANCE_HERD_SIZE > 1 ? verticalSpan / (STINGRAY_VENGEANCE_HERD_SIZE - 1) : 0;
    for (let index = 0; index < STINGRAY_VENGEANCE_HERD_SIZE; index++) {
      const id = `stingray-${this.nextStingrayId++}`;
      const spawnY = clampWorld(
        Math.min(maxY, Math.max(minY, startY + stepY * index + (Math.random() * 36 - 18)))
      );
      this.stingrays.set(id, {
        id,
        x: spawnX,
        y: spawnY,
        life: STINGRAY_LIFE,
        maxLife: STINGRAY_LIFE,
        baseY: spawnY,
        spawnTime: now,
        vengeanceTargetPlayerId: killerId,
        vengeanceEndsAtTimestamp: now + STINGRAY_VENGEANCE_DURATION_MS,
      });
    }
  }

  private updateProjectiles(now: number): void {
    const deltaSeconds = GAME_LOOP_INTERVAL_MS / 1000;
    const toRemove: string[] = [];

    for (const [projectileId, projectile] of this.projectiles) {
      if (now < projectile.salvoReleaseTime) continue;

      const forwardStep = projectile.speed * deltaSeconds;
      projectile.x += projectile.directionX * forwardStep;
      projectile.y += projectile.directionY * forwardStep;
      if (projectile.oscillationAmplitude > 0 && projectile.oscillationFrequency > 0) {
        const elapsedSeconds = Math.max(0, (now - projectile.salvoReleaseTime) / 1000);
        const wave =
          Math.sin(elapsedSeconds * projectile.oscillationFrequency + projectile.oscillationPhase) *
          projectile.oscillationAmplitude *
          deltaSeconds;
        const perpendicularX = -projectile.directionY;
        const perpendicularY = projectile.directionX;
        projectile.x += perpendicularX * wave;
        projectile.y += perpendicularY * wave;
      }

      const traveled = distance(projectile.originX, projectile.originY, projectile.x, projectile.y);
      if (traveled > projectile.maxRange) {
        toRemove.push(projectileId);
        continue;
      }

      if (this.tryProjectileHitEnemy(projectileId, projectile)) continue;
      if (this.tryProjectileHitStingray(projectileId, projectile)) continue;
      if (this.tryProjectileHitTown(projectile)) continue;
      if (this.tryProjectileHitPlayer(projectileId, projectile)) continue;
    }

    for (const id of toRemove) {
      this.projectiles.delete(id);
    }
  }

  private tryProjectileHitEnemy(projectileId: string, projectile: ServerProjectile): boolean {
    if (projectileIsFromOctopus(projectile)) {
      return false;
    }
    for (const [enemyId, enemy] of this.enemies) {
      if (distance(projectile.x, projectile.y, enemy.x, enemy.y) < PROJECTILE_HIT_RADIUS) {
        const damageDealt = projectile.damage;
        enemy.life -= damageDealt;
        if (enemyIsBoss(enemyId)) {
          this.recordBossDamage(projectile.shooterId, damageDealt);
        }
        this.pendingProjectileHitDealt.push({
          id: `hit-dealt-${randomEventSuffix()}`,
          targetKind: "octopus",
          targetId: enemyId,
          attackerId: projectile.shooterId,
          damage: damageDealt,
          x: enemy.x,
          y: enemy.y,
        });
        this.projectiles.delete(projectileId);
        if (enemy.life <= 0) {
          this.enemies.delete(enemyId);
          if (enemyIsBoss(enemyId)) {
            this.grantBossExperienceByDamageShare(projectile.shooterId);
          } else {
            const shooter = this.players.get(projectile.shooterId);
            if (shooter && !shooter.isGhost) {
              shooter.experience = (shooter.experience ?? 0) + XP_PER_OCTOPUS_OR_STINGRAY;
              shooter.killsOctopus = (shooter.killsOctopus ?? 0) + 1;
              shooter.level = getLevelFromExperience(shooter.experience);
              this.players.set(projectile.shooterId, shooter);
            }
          }
        }
        return true;
      }
    }
    return false;
  }

  private tryProjectileHitStingray(projectileId: string, projectile: ServerProjectile): boolean {
    if (projectileIsFromOctopus(projectile)) {
      return false;
    }
    for (const [stingrayId, stingray] of this.stingrays) {
      if (distance(projectile.x, projectile.y, stingray.x, stingray.y) < PROJECTILE_HIT_RADIUS) {
        const damageDealt = projectile.damage;
        stingray.life -= damageDealt;
        if (stingray.life <= 0 && this.stingrayHasPassenger(stingrayId)) {
          stingray.life = 1;
        }
        this.pendingProjectileHitDealt.push({
          id: `hit-dealt-${randomEventSuffix()}`,
          targetKind: "stingray",
          targetId: stingrayId,
          attackerId: projectile.shooterId,
          damage: damageDealt,
          x: stingray.x,
          y: stingray.y,
        });
        this.projectiles.delete(projectileId);

        const hitTime = Date.now();
        const shooterBeforeEscape = this.players.get(projectile.shooterId);
        if (shooterBeforeEscape && shooterBeforeEscape.attachedStingrayId === stingrayId) {
          const salvoId = projectile.salvoId;
          let salvoHits = shooterBeforeEscape.stingrayEscapeSalvoHits ?? 0;
          let lastCountedSalvo = shooterBeforeEscape.stingrayEscapeLastCountedSalvoId;
          if (salvoId !== lastCountedSalvo) {
            salvoHits += 1;
            lastCountedSalvo = salvoId;
          }
          if (salvoHits >= STINGRAY_ESCAPE_SALVO_COUNT) {
            this.players.set(projectile.shooterId, {
              ...shooterBeforeEscape,
              attachedStingrayId: undefined,
              stingrayEscapeSalvoHits: 0,
              stingrayEscapeLastCountedSalvoId: undefined,
              stingrayReattachBlockedUntilTimestamp: hitTime + STINGRAY_REATTACH_COOLDOWN_MS,
            });
          } else {
            this.players.set(projectile.shooterId, {
              ...shooterBeforeEscape,
              stingrayEscapeSalvoHits: salvoHits,
              stingrayEscapeLastCountedSalvoId: lastCountedSalvo,
            });
          }
        }

        if (stingray.life <= 0) {
          const shouldSpawnVengeanceHerd = stingray.vengeanceTargetPlayerId === undefined;
          this.detachPlayersFromStingray(stingrayId);
          this.stingrays.delete(stingrayId);
          if (shouldSpawnVengeanceHerd) {
            this.spawnVengeanceStingrayHerdAtKiller(projectile.shooterId, hitTime);
          }
          const shooter = this.players.get(projectile.shooterId);
          if (shooter && !shooter.isGhost) {
            shooter.experience = (shooter.experience ?? 0) + XP_PER_OCTOPUS_OR_STINGRAY;
            shooter.killsStingray = (shooter.killsStingray ?? 0) + 1;
            shooter.level = getLevelFromExperience(shooter.experience);
            this.players.set(projectile.shooterId, shooter);
          }
        }
        return true;
      }
    }
    return false;
  }

  private tryProjectileHitPlayer(projectileId: string, projectile: ServerProjectile): boolean {
    for (const [playerId, playerState] of this.players) {
      if (playerId === projectile.shooterId) continue;
      if (playerState.isGhost) continue;
      if (distance(projectile.x, projectile.y, playerState.x, playerState.y) < PROJECTILE_HIT_RADIUS) {
        const previousLife = playerState.life ?? MAX_LIFE;
        const hitX = playerState.x;
        const hitY = playerState.y;
        this.pendingProjectileHitReceived.push({
          id: `hit-rcv-${randomEventSuffix()}`,
          targetPlayerId: playerId,
          attackerId: projectile.shooterId,
          damage: projectile.damage,
          x: hitX,
          y: hitY,
        });
        this.pendingProjectileHitDealt.push({
          id: `hit-dealt-${randomEventSuffix()}`,
          targetKind: "player",
          targetId: playerId,
          attackerId: projectile.shooterId,
          damage: projectile.damage,
          x: hitX,
          y: hitY,
        });
        playerState.life = Math.max(0, previousLife - projectile.damage);
        this.projectiles.delete(projectileId);

        if (previousLife > 0 && playerState.life <= 0) {
          const victimLevel = playerState.level ?? 1;
          const attacker = this.players.get(projectile.shooterId);
          if (attacker) {
            if (!attacker.isGhost) {
              attacker.experience =
                (attacker.experience ?? 0) + victimLevel * XP_PER_PLAYER_KILL_PER_VICTIM_LEVEL;
              attacker.level = getLevelFromExperience(attacker.experience);
              this.players.set(projectile.shooterId, attacker);
            }
            this.pendingEliminations.push({
              id: `elim-${randomEventSuffix()}`,
              victimId: playerId,
              attackerId: projectile.shooterId,
              victimLevel,
            });
          }
          playerState.life = MAX_LIFE;
          playerState.isGhost = true;
          playerState.ghostPratsCaptured = 0;
          playerState.attachedStingrayId = undefined;
          playerState.stingrayEscapeSalvoHits = 0;
          playerState.stingrayEscapeLastCountedSalvoId = undefined;
        }
        this.players.set(playerId, playerState);
        return true;
      }
    }
    return false;
  }

  private tryProjectileHitTown(projectile: ServerProjectile): boolean {
    if (projectileIsFromOctopus(projectile) || projectile.shooterId.startsWith("town:")) {
      return false;
    }
    const shooter = this.players.get(projectile.shooterId);
    if (!shooter || shooter.isGhost) return false;
    for (const town of this.towns.values()) {
      if (distance(projectile.x, projectile.y, town.x, town.y) >= TOWN_CAPTURE_INTERCEPT_RADIUS) continue;
      const didProgressCapture = this.applyTownCaptureProgress(projectile.shooterId, town.id);
      if (!didProgressCapture) {
        continue;
      }
      this.removeProjectilesFromSalvo(projectile.shooterId, projectile.salvoId);
      return true;
    }
    return false;
  }

  private applyTownCaptureProgress(playerId: string, townId: string): boolean {
    const town = this.towns.get(townId);
    if (!town) return false;
    if (town.ownerId === playerId) return false;
    if (town.contenderId !== playerId) {
      town.contenderId = playerId;
      town.contenderSalvos = 0;
    }
    town.contenderSalvos += 1;
    if (town.contenderSalvos >= TOWN_CAPTURE_SALVOS_REQUIRED) {
      town.ownerId = playerId;
      town.contenderId = null;
      town.contenderSalvos = 0;
    }
    this.towns.set(townId, town);
    return true;
  }

  private removeProjectilesFromSalvo(shooterId: string, salvoId: string): void {
    for (const [existingId, existingProjectile] of this.projectiles) {
      if (existingProjectile.shooterId === shooterId && existingProjectile.salvoId === salvoId) {
        this.projectiles.delete(existingId);
      }
    }
  }

  private spawnEnemy(now: number): void {
    const id = `octopus-${this.nextEnemyId++}`;
    const { x, y } = randomInWorld();
    this.enemies.set(id, {
      id,
      x,
      y,
      life: OCTOPUS_LIFE,
      maxLife: OCTOPUS_LIFE,
      velocityX: 0,
      velocityY: 0,
      lastShotTime: 0,
      spawnTime: now,
    });
  }

  getState(): SerializableGameState {
    this.runSimulationTickIfDue(Date.now());
    // Merge input-only events (e.g. prat heal) not yet flushed by update(), without draining per caller.
    const projectileHitReceivedEvents = [
      ...this.projectileHitReceivedEventsForBroadcast,
      ...this.pendingProjectileHitReceived,
    ];
    const projectileHitDealtEvents = [
      ...this.projectileHitDealtEventsForBroadcast,
      ...this.pendingProjectileHitDealt,
    ];
    const eliminationEvents = [...this.eliminationEventsForBroadcast, ...this.pendingEliminations];

    const playersRecord: Record<string, PlayerState> = {};
    for (const [id, state] of this.players) {
      playersRecord[id] = { ...state };
    }
    const enemiesRecord: Record<string, EnemyState> = {};
    for (const [id, state] of this.enemies) {
      enemiesRecord[id] = { ...state };
    }
    const stingraysRecord: Record<string, StingrayState> = {};
    for (const [id, state] of this.stingrays) {
      stingraysRecord[id] = { ...state };
    }
    const projectilesRecord: Record<string, ProjectileState> = {};
    for (const [id, projectile] of this.projectiles) {
      projectilesRecord[id] = {
        id: projectile.id,
        shooterId: projectile.shooterId,
        letter: projectile.letter,
        x: projectile.x,
        y: projectile.y,
        directionX: projectile.directionX,
        directionY: projectile.directionY,
        isShortRange: projectile.isShortRange,
      };
    }
    const pratsRecord: Record<string, PratState> = {};
    for (const [id, prat] of this.prats) {
      pratsRecord[id] = { ...prat };
    }
    const townsRecord: Record<string, TownState> = {};
    for (const [id, town] of this.towns) {
      let ownerName: string | undefined;
      if (town.ownerId != null) {
        const ownerState = this.players.get(town.ownerId);
        const trimmed = ownerState?.name?.trim();
        ownerName = trimmed && trimmed.length > 0 ? trimmed : town.ownerId.slice(0, 8);
      }
      townsRecord[id] = {
        id: town.id,
        x: town.x,
        y: town.y,
        ownerId: town.ownerId,
        ownerName,
        contenderId: town.contenderId,
        contenderSalvos: town.contenderSalvos,
      };
    }

    return {
      timestamp: Date.now(),
      room: this.roomId,
      players: playersRecord,
      enemies: enemiesRecord,
      stingrays: stingraysRecord,
      prats: pratsRecord,
      towns: townsRecord,
      projectiles: projectilesRecord,
      projectileHitReceivedEvents,
      projectileHitDealtEvents,
      eliminationEvents,
      rewardEvents: [],
    };
  }
}

export class GameEngine {
  private rooms = new Map<string, GameRoom>();
  private maintenanceHandle: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.maintenanceHandle = setInterval(() => this.runMaintenance(), 10_000);
  }

  private runMaintenance(): void {
    const now = Date.now();
    for (const [roomId, room] of this.rooms) {
      if (room.shouldCleanup(now)) {
        room.stopLoop();
        this.rooms.delete(roomId);
      }
    }
  }

  getRoom(roomId: string): GameRoom {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = new GameRoom(roomId);
      room.startLoop();
      this.rooms.set(roomId, room);
    }
    return room;
  }
}

declare global {
  var __pratGameEngine: GameEngine | undefined;
}

let serverFeatureFlagsBootstrapPromise: Promise<void> | null = null;

/**
 * Await before the first game room tick so octopus/stingray spawns respect Supabase flags immediately.
 * Safe to call from every API route; concurrent calls share one bootstrap.
 */
export async function ensureServerGameFeatureFlagsLoaded(): Promise<void> {
  if (!serverFeatureFlagsBootstrapPromise) {
    serverFeatureFlagsBootstrapPromise = (async () => {
      await refreshServerGameFeatureFlagsFromDatabase();
      startServerFeatureFlagsRefreshLoop();
    })();
  }
  await serverFeatureFlagsBootstrapPromise;
}

export function getGameEngine(): GameEngine {
  if (!globalThis.__pratGameEngine) {
    globalThis.__pratGameEngine = new GameEngine();
  }
  return globalThis.__pratGameEngine;
}
