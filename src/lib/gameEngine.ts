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
  PRAT_CAPTURE_CLIENT_SERVER_MAX_OFFSET,
  PRAT_CAPTURE_RADIUS,
  PRAT_SPAWN_INTERVAL_MS,
  PRAT_SPAWN_RADIUS,
  XP_PER_OCTOPUS_OR_STINGRAY,
  XP_PER_PLAYER_LEVEL,
  XP_PER_PRAT,
} from "@/lib/gameBalance";
import {
  LETTER_DAMAGE_SIMULATION_UNITS,
  PLAYER_LETTER_SPEED_SIMULATION_UNITS_PER_SECOND,
  PLAYER_PROJECTILE_MAX_TRAVEL_SIMULATION_UNITS,
  PROJECTILE_HIT_RADIUS_SIMULATION_UNITS,
  STINGRAY_AMPLITUDE_SIMULATION_UNITS,
  STINGRAY_SPEED_SIMULATION_UNITS_PER_SECOND,
  WORLD_HALF_EXTENT_SIMULATION_UNITS,
  WORLD_MARGIN_SIMULATION_UNITS,
} from "@/lib/simulationSpace";
import { playerIdToColor } from "@/lib/playerColor";
import {
  getOctopusesSpawnOnServer,
  getStingraysSpawnOnServer,
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
} from "@/lib/gameTypes";

/** Server tick rate: 20 FPS (must match SSE stream interval so getState runs one tick before draining events) */
export const GAME_LOOP_INTERVAL_MS = 50;

const WORLD_SIZE = WORLD_HALF_EXTENT_SIMULATION_UNITS;
const WORLD_MARGIN = WORLD_MARGIN_SIMULATION_UNITS;
const OCTOPUS_LIFE = 80;
const OCTOPUS_LIFETIME_MS = 20_000;
const OCTOPUS_SHOOT_DELAY_MS = 5000;
const OCTOPUS_SHOOT_INTERVAL_MS = 3000;
const OCTOPUS_SPAWN_CHECK_INTERVAL_MS = 3000;
const OCTOPUS_SPAWN_PROBABILITY = 1 / 3;
const MAX_OCTOPUSES_IN_WORLD = 8;
const ROOM_EMPTY_CLEANUP_MS = 120_000;
const STINGRAY_LIFE = 60;
const STINGRAY_WAVE_FREQUENCY = 0.5;
const STINGRAY_SPAWN_INTERVAL_MS = 4000;

const LETTER_SPEED_SIMULATION_UNITS_PER_SECOND = PLAYER_LETTER_SPEED_SIMULATION_UNITS_PER_SECOND;
const LETTER_DAMAGE = LETTER_DAMAGE_SIMULATION_UNITS;
const PROJECTILE_HIT_RADIUS = PROJECTILE_HIT_RADIUS_SIMULATION_UNITS;
const PROJECTILE_MAX_RANGE = PLAYER_PROJECTILE_MAX_TRAVEL_SIMULATION_UNITS;
const PRAT_LETTERS = ["P", "R", "A", "T"];
const PRAT_WORDS = ["prat", "PRAT", "prat", "PrAt", "prat"];
const PRAT_STYLE_ROLLS: { fontStyle: string; power: number }[] = [
  { fontStyle: "normal", power: 1 },
  { fontStyle: "bold", power: 2 },
  { fontStyle: "italic", power: 2 },
  { fontStyle: "bold italic", power: 3 },
];
const SALVO_LETTER_DELAY_MS = 80;
const SHOOT_START_TOLERANCE = 120;
const SHOOT_TIMESTAMP_SLACK_MS = 15_000;

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

/** Respawn near a random map corner, ~50 simulation units from each edge at that corner. */
function randomCornerSpawn(): { x: number; y: number } {
  const min = -WORLD_SIZE + WORLD_MARGIN;
  const max = WORLD_SIZE - WORLD_MARGIN;
  const inset = 50;
  const corners = [
    { x: min + inset, y: min + inset },
    { x: max - inset, y: min + inset },
    { x: min + inset, y: max - inset },
    { x: max - inset, y: max - inset },
  ];
  const corner = corners[Math.floor(Math.random() * 4)]!;
  const jitter = () => (Math.random() - 0.5) * 80;
  return {
    x: clampWorld(corner.x + jitter()),
    y: clampWorld(corner.y + jitter()),
  };
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
  maxRange: number;
}

function octopusProjectileShooterId(octopusEnemyId: string): string {
  return `octopus:${octopusEnemyId}`;
}

function projectileIsFromOctopus(projectile: ServerProjectile): boolean {
  return projectile.shooterId.startsWith("octopus:");
}

export class GameRoom {
  readonly roomId: string;
  private players = new Map<string, PlayerState>();
  private playerPresence = new Map<string, number>();
  private enemies = new Map<string, EnemyState>();
  private stingrays = new Map<string, StingrayState>();
  private prats = new Map<string, PratState>();
  private projectiles = new Map<string, ServerProjectile>();
  private nextEnemyId = 0;
  private nextStingrayId = 0;
  private nextProjectileId = 0;
  private nextPratId = 0;
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

  constructor(roomId: string) {
    this.roomId = roomId;
    const now = Date.now();
    this.lastOctopusSpawnCheckTime = now;
    this.lastStingraySpawnTime = now;
    this.lastPratSpawnTime = now;
    this.spawnInitialPrats();
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
    return {
      x: 0,
      y: 0,
      rotation: 0,
      score: 0,
      life: MAX_LIFE,
      level: 1,
      experience: 0,
      killsOctopus: 0,
      killsStingray: 0,
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
        healAmount: Math.floor(MAX_LIFE * HEAL_PERCENT_OF_MAX),
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
      this.players.set(playerId, {
        ...previous,
        experience,
        level: getLevelFromExperience(experience),
        killsOctopus: input.killsOctopus ?? previous.killsOctopus ?? 0,
        killsStingray: input.killsStingray ?? previous.killsStingray ?? 0,
        isGhost: previous.isGhost,
        ghostPratsCaptured: previous.ghostPratsCaptured,
      });
      return {};
    }
    if (input.type === "PRAT_CAPTURE") {
      this.tryPratCapture(playerId, input);
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

    if (prat.isHeal) {
      const heal = prat.healAmount ?? 0;
      playerState.life = Math.min(MAX_LIFE, (playerState.life ?? MAX_LIFE) + heal);
      this.pendingProjectileHitReceived.push({
        id: `hit-rcv-${randomEventSuffix()}`,
        targetPlayerId: playerId,
        attackerId: "prat",
        damage: -heal,
        x: captureX,
        y: captureY,
      });
    } else if (playerState.isGhost) {
      const next = (playerState.ghostPratsCaptured ?? 0) + 1;
      if (next >= GHOST_PRATS_TO_LEAVE) {
        playerState.isGhost = false;
        playerState.ghostPratsCaptured = 0;
      } else {
        playerState.ghostPratsCaptured = next;
      }
    } else {
      playerState.score = (playerState.score ?? 0) + prat.power;
      playerState.experience = (playerState.experience ?? 0) + XP_PER_PRAT;
      playerState.level = getLevelFromExperience(playerState.experience);
    }
    playerState.x = captureX;
    playerState.y = captureY;
    this.prats.delete(pratId);
    this.players.set(playerId, playerState);
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
        maxRange: OCTOPUS_PROJECTILE_MAX_RANGE,
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
        maxRange: PROJECTILE_MAX_RANGE,
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
    this.spawnPratsNearPlayers(now);
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

  private updateEnemiesAndSpawns(now: number): void {
    const toRemoveEnemy: string[] = [];
    for (const enemy of this.enemies.values()) {
      if (now - enemy.spawnTime >= OCTOPUS_LIFETIME_MS) {
        toRemoveEnemy.push(enemy.id);
        continue;
      }
      enemy.x += enemy.velocityX * (GAME_LOOP_INTERVAL_MS / 1000);
      enemy.y += enemy.velocityY * (GAME_LOOP_INTERVAL_MS / 1000);

      const playerTarget = nearestPlayer(enemy.x, enemy.y, this.players);
      if (
        playerTarget &&
        now - enemy.spawnTime >= OCTOPUS_SHOOT_DELAY_MS &&
        now - enemy.lastShotTime >= OCTOPUS_SHOOT_INTERVAL_MS
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
  }

  private updateStingrays(now: number): void {
    const deltaSeconds = GAME_LOOP_INTERVAL_MS / 1000;
    const toRemove: string[] = [];

    if (
      getStingraysSpawnOnServer() &&
      now - this.lastStingraySpawnTime >= STINGRAY_SPAWN_INTERVAL_MS
    ) {
      this.lastStingraySpawnTime = now;
      this.spawnStingray(now);
    }

    for (const stingray of this.stingrays.values()) {
      stingray.x += STINGRAY_SPEED_SIMULATION_UNITS_PER_SECOND * deltaSeconds;
      const elapsedSeconds = (now - stingray.spawnTime) / 1000;
      stingray.y =
        stingray.baseY +
        STINGRAY_AMPLITUDE_SIMULATION_UNITS * Math.sin(2 * Math.PI * STINGRAY_WAVE_FREQUENCY * elapsedSeconds);
      if (stingray.x > WORLD_SIZE + 50 || stingray.life <= 0) {
        toRemove.push(stingray.id);
      }
    }

    for (const stingrayId of toRemove) {
      this.stingrays.delete(stingrayId);
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

  private updateProjectiles(now: number): void {
    const deltaSeconds = GAME_LOOP_INTERVAL_MS / 1000;
    const toRemove: string[] = [];

    for (const [projectileId, projectile] of this.projectiles) {
      if (now < projectile.salvoReleaseTime) continue;

      projectile.x += projectile.directionX * projectile.speed * deltaSeconds;
      projectile.y += projectile.directionY * projectile.speed * deltaSeconds;

      const traveled = distance(projectile.originX, projectile.originY, projectile.x, projectile.y);
      if (traveled > projectile.maxRange) {
        toRemove.push(projectileId);
        continue;
      }

      if (this.tryProjectileHitEnemy(projectileId, projectile)) continue;
      if (this.tryProjectileHitStingray(projectileId, projectile)) continue;
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
          const shooter = this.players.get(projectile.shooterId);
          if (shooter && !shooter.isGhost) {
            shooter.experience = (shooter.experience ?? 0) + XP_PER_OCTOPUS_OR_STINGRAY;
            shooter.killsOctopus = (shooter.killsOctopus ?? 0) + 1;
            shooter.level = getLevelFromExperience(shooter.experience);
            this.players.set(projectile.shooterId, shooter);
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
        if (stingray.life <= 0) {
          this.stingrays.delete(stingrayId);
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
              attacker.experience = (attacker.experience ?? 0) + victimLevel * XP_PER_PLAYER_LEVEL;
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
          const spawn = randomCornerSpawn();
          playerState.life = MAX_LIFE;
          playerState.x = spawn.x;
          playerState.y = spawn.y;
          playerState.isGhost = true;
          playerState.ghostPratsCaptured = 0;
        }
        this.players.set(playerId, playerState);
        return true;
      }
    }
    return false;
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
      };
    }
    const pratsRecord: Record<string, PratState> = {};
    for (const [id, prat] of this.prats) {
      pratsRecord[id] = { ...prat };
    }

    return {
      timestamp: Date.now(),
      room: this.roomId,
      players: playersRecord,
      enemies: enemiesRecord,
      stingrays: stingraysRecord,
      prats: pratsRecord,
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

export function getGameEngine(): GameEngine {
  if (!globalThis.__pratGameEngine) {
    startServerFeatureFlagsRefreshLoop();
    globalThis.__pratGameEngine = new GameEngine();
  }
  return globalThis.__pratGameEngine;
}
