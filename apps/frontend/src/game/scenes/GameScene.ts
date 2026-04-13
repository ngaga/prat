import Phaser from "phaser";
import { EventBus } from "../EventBus";
import { MultiplayerManager, type RemotePlayer } from "../multiplayer/MultiplayerManager";
import type { PlayerState, PratState, SerializableGameState, TownState } from "@/lib/gameTypes";
import {
  getExperienceProgressTowardNextLevel,
  GHOST_PRATS_TO_LEAVE,
  MAX_LIFE,
  PRAT_CAPTURE_RADIUS,
  TOWN_CAPTURE_SALVOS_REQUIRED,
} from "@/lib/gameBalance";
import {
  CLICK_TARGET_RADIUS_SIMULATION_UNITS,
  PLAYER_BOAT_SPEED_SIMULATION_UNITS_PER_SECOND,
  PLAYER_MOVE_ARRIVAL_THRESHOLD_SIMULATION_UNITS,
  WORLD_HALF_EXTENT_SIMULATION_UNITS,
  WORLD_MARGIN_SIMULATION_UNITS,
} from "@/lib/simulationSpace";
import { playerIdToColor } from "@/lib/playerColor";
import { endGameSession, startGameSession } from "@/lib/gameSessions";
import { coerceClientFeatureFlag } from "@/lib/featureFlags";
import { getPlayerByName, upsertPlayer } from "@/lib/players";
import { MAX_PLAYER_NAME_LENGTH, VIEW_HEIGHT, VIEW_WIDTH } from "../config";
import { phaserPixelsToSimulation, simulationToPhaserPixels } from "../simulationToDisplay";
import { setBackgroundMusicForGhostMode, stopBackgroundMusic } from "../backgroundMusic";

interface PratEntity {
  id: string;
  text: Phaser.GameObjects.Text;
}

interface TownEntity {
  id: string;
  text: Phaser.GameObjects.Text;
  nameLabel: Phaser.GameObjects.Text;
  captureBar: Phaser.GameObjects.Graphics;
}

interface RemoteBoatData {
  sprite: Phaser.GameObjects.Image;
  nameLabel: Phaser.GameObjects.Text;
  lifeBar?: Phaser.GameObjects.Graphics;
  /** Server snapshot target; sprite is smoothed toward this each frame. */
  authoritativeWorldX: number;
  authoritativeWorldY: number;
  authoritativeRotation: number;
  lastRemotePlayerPayload: RemotePlayer;
}

interface OctopusEntity {
  id: string;
  sprite: Phaser.GameObjects.Image;
  lifeBar: Phaser.GameObjects.Graphics;
  life: number;
  lastShotTime: number;
  spawnTime: number;
}

interface StingrayEntity {
  id: string;
  sprite: Phaser.GameObjects.Image;
  lifeBar: Phaser.GameObjects.Graphics;
  life: number;
  baseY: number;
  spawnTime: number;
}

const WORLD_SIZE = simulationToPhaserPixels(WORLD_HALF_EXTENT_SIMULATION_UNITS);
const WORLD_MARGIN = simulationToPhaserPixels(WORLD_MARGIN_SIMULATION_UNITS);
const SEA_TILE_SIZE = WORLD_SIZE;
const CLICK_TARGET_RADIUS = simulationToPhaserPixels(CLICK_TARGET_RADIUS_SIMULATION_UNITS);
const PRAT_CAPTURE_RADIUS_PIXELS = simulationToPhaserPixels(PRAT_CAPTURE_RADIUS);
const OCTOPUS_LIFE = 80;
const STINGRAY_LIFE = 60;
const BAR_LABEL_WIDTH = 70;
const BAR_X = 20 + BAR_LABEL_WIDTH;
/** Max score delta treated as a single prat pickup (avoid full-screen burst on unrelated updates). */
const SCORE_DELTA_PRAT_PICKUP_MAX = 4;
/** Floating countdown text when capturing prats as ghost (Mario-style). */
const GHOST_PRAT_FLOAT_DURATION_MS = 1500;
const GHOST_PRAT_FLOAT_RISE_PIXELS = 60;
/** Full-screen PRAT transition overlay: scale-in then fade (hides invert when becoming ghost or day when reviving). */
const DEATH_PRAT_SCALE_IN_MS = 1000;
const DEATH_PRAT_FADE_OUT_MS = 3000;
const DEATH_PRAT_LABEL_TEXT = "PRAT...";
const REVIVE_PRAT_SCALE_IN_MS = DEATH_PRAT_SCALE_IN_MS;
const REVIVE_PRAT_FADE_OUT_MS = 500;
const REVIVE_PRAT_LABEL_TEXT = "PRAT!";
const DEATH_PRAT_OVERLAY_DEPTH = 100000;
/** Town letter blink: 0.5 Hz full cycle => 1000 ms per half (bright/dim). */
const TOWN_OWNED_BLINK_HALF_PERIOD_MS = 1000;
const TOWN_OWNER_NAME_OFFSET_ABOVE_LETTER_PX = 36;
/** Soft pink for local-owned town letter (avoids harsh blue at night). */
const TOWN_LETTER_COLOR_LOCAL = "#c989a8";
const TOWN_GLOW_COLOR_LOCAL = "#f5c6dc";
/** Muted plum / lavender for other players' towns. */
const TOWN_LETTER_COLOR_OTHER_OWNER = "#8b6b8f";
const TOWN_GLOW_COLOR_OTHER_OWNER = "#e0c4e8";

type PratTransitionOverlayOptions = {
  labelText: string;
  scaleInDurationMs: number;
  fadeOutDurationMs: number;
};

const DEFAULT_PRAT_TRANSITION_OVERLAY: PratTransitionOverlayOptions = {
  labelText: DEATH_PRAT_LABEL_TEXT,
  scaleInDurationMs: DEATH_PRAT_SCALE_IN_MS,
  fadeOutDurationMs: DEATH_PRAT_FADE_OUT_MS,
};
/** Black tint on white boat texture (normal appearance). */
const BOAT_SILHOUETTE_TINT = 0x000000;
/** Level 1 map scale (same as previous fixed 0.5). */
const BOAT_DISPLAY_SCALE_BASE = 0.5;
/** How much larger the boat gets per level (capped). */
const BOAT_DISPLAY_SCALE_PER_LEVEL = 0.1;
const BOAT_DISPLAY_SCALE_MAX = 10;
/** Name label offset above boat center at base scale (legacy layout). */
const NAME_LABEL_OFFSET_AT_BASE_SCALE = 50;
/** Remote life bar top Y is this many pixels above the name label center (smaller Y). */
const REMOTE_LIFE_BAR_OFFSET_ABOVE_NAME_CENTER = 15;

function boatDisplayScaleForLevel(level: number): number {
  const safeLevel = Math.max(1, Math.floor(Number(level) || 1));
  const scale = BOAT_DISPLAY_SCALE_BASE + BOAT_DISPLAY_SCALE_PER_LEVEL * (safeLevel - 1);
  return Phaser.Math.Clamp(scale, BOAT_DISPLAY_SCALE_BASE, BOAT_DISPLAY_SCALE_MAX);
}

function nameLabelOffsetAboveBoatForScale(scale: number): number {
  return (NAME_LABEL_OFFSET_AT_BASE_SCALE / BOAT_DISPLAY_SCALE_BASE) * scale;
}

const BOAT_NAME_FONT_SIZE_BASE_PX = 12;
const BOAT_NAME_FONT_SIZE_MAX_PX = 28;

function boatNameFontSizePxForScale(scale: number): number {
  const ratio = scale / BOAT_DISPLAY_SCALE_BASE;
  return Phaser.Math.Clamp(
    Math.round(BOAT_NAME_FONT_SIZE_BASE_PX * ratio),
    BOAT_NAME_FONT_SIZE_BASE_PX,
    BOAT_NAME_FONT_SIZE_MAX_PX
  );
}

const PLAYER_PROJECTILE_FONT_BASE_PX = 28;
const PLAYER_PROJECTILE_FONT_MAX_PX = 52;

function playerProjectileFontSizePxForScale(scale: number): number {
  const ratio = scale / BOAT_DISPLAY_SCALE_BASE;
  return Phaser.Math.Clamp(
    Math.round(PLAYER_PROJECTILE_FONT_BASE_PX * ratio),
    PLAYER_PROJECTILE_FONT_BASE_PX,
    PLAYER_PROJECTILE_FONT_MAX_PX
  );
}

function shortId(uuid: string): string {
  return uuid.slice(0, 8);
}

function formatPratsHudLabel(pratsCaptured: number, prats: number): string {
  return `Captured: ${pratsCaptured}  Prats: ${prats}`;
}

function normalizeDirection(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
): { x: number; y: number } {
  const deltaX = toX - fromX;
  const deltaY = toY - fromY;
  const length = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  if (length === 0) return { x: 0, y: 0 };
  return { x: deltaX / length, y: deltaY / length };
}

export class GameScene extends Phaser.Scene {
  private boat!: Phaser.Physics.Arcade.Sprite;
  private boatNameLabel!: Phaser.GameObjects.Text;
  private moveTargetX: number | null = null;
  private moveTargetY: number | null = null;
  private readonly moveArrivalThreshold = simulationToPhaserPixels(PLAYER_MOVE_ARRIVAL_THRESHOLD_SIMULATION_UNITS);
  private pratEntities = new Map<string, PratEntity>();
  private pratCaptureRequestSent = new Set<string>();
  private townEntities = new Map<string, TownEntity>();
  /** Tracks town ownership across SSE frames so we can toast on local capture. */
  private townPreviousOwnerById = new Map<string, string | null>();
  /** Tracks capture progress across snapshots to trigger interception pulse VFX. */
  private townPreviousContenderSalvosById = new Map<string, number>();
  private score: number = 0;
  private scoreText!: Phaser.GameObjects.Text;
  private readonly boatSpeed = simulationToPhaserPixels(PLAYER_BOAT_SPEED_SIMULATION_UNITS_PER_SECOND);
  private multiplayer!: MultiplayerManager;
  private remoteBoats = new Map<string, RemoteBoatData>();
  private isSceneActive = true;
  private lifeBar!: Phaser.GameObjects.Graphics;
  private experienceBar!: Phaser.GameObjects.Graphics;
  private sea!: Phaser.GameObjects.TileSprite;
  private borderTop!: Phaser.GameObjects.TileSprite;
  private borderBottom!: Phaser.GameObjects.TileSprite;
  private borderLeft!: Phaser.GameObjects.TileSprite;
  private borderRight!: Phaser.GameObjects.TileSprite;
  private life = MAX_LIFE;
  private experience = 0;
  private level = 1;
  private killsOctopus = 0;
  private killsStingray = 0;
  /** Lifetime normal-mode prat captures; mirrored from server and persisted like kills_octopus. */
  private pratsCaptured = 0;
  /** Spendable projectile resource for full-range shots; authoritative on server. */
  private prats = 0;
  /** From authoritative game state `players`; includes the local client. */
  private connectedPlayerCount = 1;
  /** Below the Ko-fi button (top-right overlay); screen Y for fixed multiplayer label. */
  private readonly multiplayerHudTopPx = 72;
  private playerName: string | null = null;
  private octopuses = new Map<string, OctopusEntity>();
  private octopusesEnabled = true;
  private stingraysEnabled = true;
  /** Combat, prats, boats, and projectiles are driven by the Next game API (SSE + POST). */
  private readonly authoritativeGameServer = true;
  private lastMoveInputSentAt = 0;
  private readonly serverMoveThrottleMs = 100;
  private serverProjectileSprites = new Map<string, Phaser.GameObjects.Text>();
  private processedEliminationIds = new Set<string>();
  private processedProjectileHitReceivedEventIds = new Set<string>();
  private processedProjectileHitDealtEventIds = new Set<string>();
  private stingrays = new Map<string, StingrayEntity>();
  /** After first SSE snapshot, score delta triggers prat score pickup VFX (heal uses negative damage events). */
  private hudSyncedFromServer = false;
  /**
   * Until the first authoritative snapshot places the boat, skip MOVE so client (0,0) does not overwrite
   * server random spawn.
   */
  private localBoatPositionSyncedFromAuthoritativeState = false;
  /** Camera follow starts after the first authoritative boat position (avoids framing 0,0). */
  private cameraFollowsLocalBoat = false;
  private localIsGhost = false;
  /** Mirrors server ghost prat count; used for Supabase persistence like experience. */
  private syncedGhostPratsCaptured = 0;
  private ghostHudText: Phaser.GameObjects.Text | null = null;
  /** True when the game canvas uses CSS invert for local ghost mode (affects boat tint vs clear tint). */
  private ghostCameraInversionActive = false;
  /** When the local player is alive, ghost remote boats use per-sprite inversion (camera is off). */
  private remoteBoatGhostFx = new WeakMap<Phaser.GameObjects.Image, Phaser.FX.Controller>();
  /** Destroyed when the death overlay animation finishes or the scene shuts down. */
  private deathPratOverlayRoot: Phaser.GameObjects.Container | null = null;
  private gameSessionId: string | null = null;
  private gameSessionLoggedEnded = false;
  private sessionBaseline = {
    exp: 0,
    killsOctopus: 0,
    killsStingray: 0,
    ghostPratsCaptured: 0,
  };
  private sessionActionsCount = 0;
  private sessionPageHideHandler: (() => void) | null = null;

  constructor() {
    super({ key: "GameScene" });
  }

  init(data: { octopusesEnabled?: boolean; stingraysEnabled?: boolean; playerName?: string }): void {
    this.octopusesEnabled = coerceClientFeatureFlag(data?.octopusesEnabled);
    this.stingraysEnabled = coerceClientFeatureFlag(data?.stingraysEnabled);
    this.playerName = data?.playerName ?? null;
  }

  async create(): Promise<void> {
    this.physics.world.setBounds(-WORLD_SIZE, -WORLD_SIZE, WORLD_SIZE * 2, WORLD_SIZE * 2);

    this.sea = this.add.tileSprite(0, 0, SEA_TILE_SIZE, SEA_TILE_SIZE, "sea");
    this.sea.setOrigin(0.5);

    this.createWorldBorders();
    this.input.on("pointerdown", this.onPointerDown, this);
    this.input.on("pointermove", this.onPointerMove, this);
    this.game.canvas.addEventListener("contextmenu", (event) => event.preventDefault());

    this.multiplayer = new MultiplayerManager({
      onRemotePlayerUpdate: (players) => {
        if (!this.isSceneActive) return;
        this.updateRemoteBoats(players);
      },
      onConnected: () => {
        if (!this.isSceneActive) return;
        this.updateMultiplayerStatus();
      },
      onGameStateUpdate: (state) => {
        if (!this.isSceneActive) return;
        this.applyServerGameState(state);
      },
      getLocalState: () => {
        if (!this.boat) {
          return {
            x: phaserPixelsToSimulation(400),
            y: phaserPixelsToSimulation(300),
            rotation: 0,
            score: this.score,
            life: this.life,
            level: this.level,
            name: this.playerName ?? undefined,
          };
        }
        return {
          x: phaserPixelsToSimulation(this.boat.x),
          y: phaserPixelsToSimulation(this.boat.y),
          rotation: this.boat.rotation,
          score: this.score,
          life: this.life,
          level: this.level,
          name: this.playerName ?? undefined,
        };
      },
    });
    this.multiplayer.setUseSupabaseForRemoteBoatPositions(false);
    this.multiplayer.connect();
    if (!this.playerName) {
      this.playerName = this.multiplayer.getPlayerId();
    }
    let resolvedPlayer: Awaited<ReturnType<typeof getPlayerByName>> = null;
    if (this.playerName) {
      const existingPlayer = await getPlayerByName(this.playerName);
      resolvedPlayer = existingPlayer;
      if (existingPlayer) {
        this.experience = existingPlayer.exp;
        this.level = existingPlayer.level;
        this.killsOctopus = existingPlayer.kills_octopus;
        this.killsStingray = existingPlayer.kills_stingray;
        this.pratsCaptured = existingPlayer.prats_captured ?? 0;
        this.prats = existingPlayer.prats ?? 0;
        this.localIsGhost = existingPlayer.is_ghost ?? false;
        this.syncedGhostPratsCaptured = existingPlayer.ghost_prats_captured ?? 0;
      } else {
        const created = await upsertPlayer({
          name: this.playerName ?? undefined,
          exp: 0,
          level: 1,
          kills_octopus: 0,
          kills_stingray: 0,
          prats_captured: 0,
          prats: 0,
          is_ghost: false,
          ghost_prats_captured: 0,
        });
        if (!created) {
          console.warn("Failed to create player in database");
        } else {
          resolvedPlayer = await getPlayerByName(this.playerName);
        }
      }
    }

    const ghostRestoreFromDb =
      resolvedPlayer?.is_ghost === true
        ? { isGhost: true as const, ghostPratsCaptured: resolvedPlayer.ghost_prats_captured ?? 0 }
        : undefined;

    this.boat = this.physics.add.sprite(0, 0, "boat");
    this.boat.setAlpha(0);
    this.boat.setCollideWorldBounds(true);
    this.refreshLocalBoatDisplayScale();
    this.boat.rotation = Math.PI;
    this.boat.setTint(BOAT_SILHOUETTE_TINT);
    this.setLocalGhostCameraInversion(this.localIsGhost);
    this.applyLocalBoatGhostVisual(this.boat, this.localIsGhost);
    setBackgroundMusicForGhostMode(this.registry, this.localIsGhost);

    const displayName =
      this.playerName && this.playerName.length <= MAX_PLAYER_NAME_LENGTH
        ? this.playerName
        : shortId(this.multiplayer.getPlayerId());
    this.boatNameLabel = this.add
      .text(0, -50, displayName, {
        fontSize: "12px",
        color: "#000",
      })
      .setOrigin(0.5);
    this.boatNameLabel.setAlpha(0);

    this.cameras.main.setBounds(-WORLD_SIZE, -WORLD_SIZE, WORLD_SIZE * 2, WORLD_SIZE * 2);
    this.updateCameraZoom();
    this.scale.on("resize", this.updateCameraZoom, this);

    // Apply profile on the server before SSE: first snapshot would otherwise use default level 1 and overwrite DB values.
    try {
      await this.multiplayer.sendGameInput({
        type: "SYNC_PROFILE",
        timestamp: Date.now(),
        experience: this.experience,
        killsOctopus: this.killsOctopus,
        killsStingray: this.killsStingray,
        pratsCaptured: this.pratsCaptured,
        prats: this.prats,
        ...(ghostRestoreFromDb ? ghostRestoreFromDb : {}),
      });
    } catch {
      // Still connect; HUD may briefly mismatch until the next successful sync.
    }

    // Start SSE after the boat exists so damage VFX always has a world position (sprite or snapshot fallback).
    this.multiplayer.connectGameStream("default");

    if (typeof window !== "undefined") {
      // Tab close and many navigations skip Phaser shutdown; still a normal player exit (not a crash signal).
      this.sessionPageHideHandler = () => {
        if (!this.gameSessionLoggedEnded && this.gameSessionId) {
          this.endGameSessionRecord(false);
        }
      };
      window.addEventListener("pagehide", this.sessionPageHideHandler);
    }

    if (resolvedPlayer?.id) {
      await this.beginGameSessionRecording(resolvedPlayer.id);
    }

    this.scoreText = this.add
      .text(0, 0, formatPratsHudLabel(0, 0), {
        fontSize: "20px",
        color: "#000",
      })
      .setScrollFactor(0)
      .setOrigin(0, 0)
      .setPosition(40, 20);

    this.ghostHudText = this.add
      .text(20, 48, "", {
        fontSize: "14px",
        color: "#444",
      })
      .setScrollFactor(0)
      .setOrigin(0, 0)
      .setVisible(false);

    const statusText = this.add
      .text(0, 0, "", {
        fontSize: "14px",
        color: "#333",
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setName("multiplayer-status");
    statusText.setPosition(this.scale.width - 20, this.multiplayerHudTopPx);

    this.createLifeAndExperienceBars();

    this.updateMultiplayerStatus();

    EventBus.emit("current-scene-ready", this);
  }

  private createWorldBorders(): void {
    const borderThickness = 2;
    const worldExtent = WORLD_SIZE * 2;

    this.borderTop = this.add.tileSprite(0, -WORLD_SIZE, worldExtent, borderThickness, "cascade");
    this.borderTop.setOrigin(0.5, 0);
    this.borderTop.setDepth(1);

    this.borderBottom = this.add.tileSprite(0, WORLD_SIZE, worldExtent, borderThickness, "cascade");
    this.borderBottom.setOrigin(0.5, 1);
    this.borderBottom.setAngle(180);
    this.borderBottom.setDepth(1);

    this.borderLeft = this.add.tileSprite(-WORLD_SIZE, 0, borderThickness, worldExtent, "cascade");
    this.borderLeft.setOrigin(0, 0.5);
    this.borderLeft.setDepth(1);

    this.borderRight = this.add.tileSprite(WORLD_SIZE, 0, borderThickness, worldExtent, "cascade");
    this.borderRight.setOrigin(1, 0.5);
    this.borderRight.setDepth(1);
  }

  private createLifeAndExperienceBars(): void {
    const barWidth = 200;
    const barHeight = 14;
    const labelX = 20;
    const lifeY = this.scale.height - 55;
    const experienceY = this.scale.height - 35;

    this.lifeBar = this.add.graphics().setScrollFactor(0);

    this.experienceBar = this.add.graphics().setScrollFactor(0);
    this.drawBar(this.experienceBar, BAR_X, experienceY, barWidth, barHeight, 0x333333, 0x9b59b6, 0);

    this.add
      .text(labelX, lifeY + barHeight / 2, "PV", { fontSize: "12px", color: "#000" })
      .setOrigin(0, 0.5)
      .setScrollFactor(0);
    this.add
      .text(labelX, experienceY + barHeight / 2, "Exp.", { fontSize: "12px", color: "#000" })
      .setOrigin(0, 0.5)
      .setScrollFactor(0);
    this.add
      .text(BAR_X + barWidth + 10, experienceY + barHeight / 2, `Niv. ${this.level}`, { fontSize: "12px", color: "#000" })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setName("level-text");
  }

  private recordSessionAction(): void {
    this.sessionActionsCount += 1;
  }

  private async beginGameSessionRecording(playerId: string): Promise<void> {
    this.sessionBaseline = {
      exp: this.experience,
      killsOctopus: this.killsOctopus,
      killsStingray: this.killsStingray,
      ghostPratsCaptured: this.syncedGhostPratsCaptured,
    };
    const sessionId = await startGameSession(playerId);
    if (!sessionId) return;
    this.gameSessionId = sessionId;
  }

  private endGameSessionRecord(disconnectedUnexpectedly: boolean): void {
    if (this.gameSessionLoggedEnded || !this.gameSessionId) return;
    this.gameSessionLoggedEnded = true;
    const sessionId = this.gameSessionId;
    const expGained = Math.max(0, this.experience - this.sessionBaseline.exp);
    const killsOctopus = Math.max(0, this.killsOctopus - this.sessionBaseline.killsOctopus);
    const killsStingray = Math.max(0, this.killsStingray - this.sessionBaseline.killsStingray);
    const ghostPratsCaptured = Math.max(
      0,
      this.syncedGhostPratsCaptured - this.sessionBaseline.ghostPratsCaptured
    );
    endGameSession(sessionId, {
      actionsCount: this.sessionActionsCount,
      expGained,
      killsOctopus,
      killsStingray,
      ghostPratsCaptured,
      disconnectedUnexpectedly,
    });
  }

  private async savePlayer(): Promise<void> {
    if (!this.playerName) return;
    await upsertPlayer({
      name: this.playerName,
      exp: this.experience,
      level: this.level,
      kills_octopus: this.killsOctopus,
      kills_stingray: this.killsStingray,
      prats_captured: this.pratsCaptured,
      prats: this.prats,
      is_ghost: this.localIsGhost,
      ghost_prats_captured: this.syncedGhostPratsCaptured,
    });
  }

  private showLevelUpMessage(newLevel: number): void {
    const levelUpText = this.add
      .text(this.scale.width / 2, this.scale.height / 2 - 50, `Niveau ${newLevel} !`, {
        fontSize: "32px",
        fontStyle: "bold",
        color: "#9b59b6",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(100);
    this.tweens.add({
      targets: levelUpText,
      alpha: 0,
      y: levelUpText.y - 80,
      duration: 1500,
      onComplete: () => levelUpText.destroy(),
    });
  }

  private drawBar(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    width: number,
    height: number,
    bgColor: number,
    fillColor: number,
    fillRatio: number
  ): void {
    graphics.clear();
    graphics.fillStyle(bgColor, 0.8);
    graphics.fillRect(x, y, width, height);
    graphics.fillStyle(fillColor, 1);
    graphics.fillRect(x, y, width * fillRatio, height);
  }

  shutdown(): void {
    this.isSceneActive = false;
    if (typeof window !== "undefined" && this.sessionPageHideHandler) {
      window.removeEventListener("pagehide", this.sessionPageHideHandler);
      this.sessionPageHideHandler = null;
    }
    this.endGameSessionRecord(false);
    stopBackgroundMusic(this.registry);
    this.savePlayer();
    this.input.off("pointerdown", this.onPointerDown, this);
    this.input.off("pointermove", this.onPointerMove, this);
    this.scale.off("resize", this.updateCameraZoom, this);
    for (const text of this.serverProjectileSprites.values()) {
      text.destroy();
    }
    this.serverProjectileSprites.clear();
    this.processedEliminationIds.clear();
    this.processedProjectileHitReceivedEventIds.clear();
    this.processedProjectileHitDealtEventIds.clear();
    for (const entity of this.pratEntities.values()) {
      entity.text.destroy();
    }
    this.pratEntities.clear();
    this.pratCaptureRequestSent.clear();
    for (const entity of this.townEntities.values()) {
      entity.text.destroy();
      entity.nameLabel.destroy();
      entity.captureBar.destroy();
    }
    this.townEntities.clear();
    this.townPreviousOwnerById.clear();
    this.townPreviousContenderSalvosById.clear();
    for (const octopus of this.octopuses.values()) {
      octopus.sprite.destroy();
      octopus.lifeBar.destroy();
    }
    this.octopuses.clear();
    for (const stingray of this.stingrays.values()) {
      stingray.sprite.destroy();
      stingray.lifeBar.destroy();
    }
    this.stingrays.clear();
    this.multiplayer.disconnect();
    this.setLocalGhostCameraInversion(false);
    for (const [, boatData] of this.remoteBoats) {
      const fx = this.remoteBoatGhostFx.get(boatData.sprite);
      if (fx) {
        try {
          boatData.sprite.postFX.remove(fx);
        } catch {
          // Scene tearing down
        }
        this.remoteBoatGhostFx.delete(boatData.sprite);
      }
    }
    this.ghostHudText?.destroy();
    this.ghostHudText = null;
    this.deathPratOverlayRoot?.destroy(true);
    this.deathPratOverlayRoot = null;
  }

  /**
   * Full-screen inversion for local ghost mode via CSS on the canvas.
   * Camera postFX ColorMatrix was limited to a wrong-sized region with zoom; CSS inverts the whole bitmap.
   */
  private setLocalGhostCameraInversion(enabled: boolean): void {
    const canvas = this.game?.canvas;
    if (enabled) {
      if (this.ghostCameraInversionActive) return;
      if (canvas) {
        canvas.style.filter = "invert(1)";
        this.ghostCameraInversionActive = true;
      } else {
        this.ghostCameraInversionActive = false;
      }
    } else {
      if (canvas) {
        canvas.style.filter = "";
      }
      this.ghostCameraInversionActive = false;
    }
  }

  private clearDeathPratOverlay(): void {
    this.deathPratOverlayRoot?.destroy(true);
    this.deathPratOverlayRoot = null;
  }

  /**
   * Invert, ghost HUD, music, and local boat look after server player state is applied.
   */
  private applyLocalGhostPresentationAfterServer(me: PlayerState, previousWasGhost: boolean): void {
    this.setLocalGhostCameraInversion(this.localIsGhost);
    if (this.ghostHudText) {
      if (me.isGhost) {
        this.ghostHudText.setText(
          `Ghost: ${me.ghostPratsCaptured ?? 0} / ${GHOST_PRATS_TO_LEAVE} prats to revive`
        );
        this.ghostHudText.setVisible(true);
      } else {
        this.ghostHudText.setVisible(false);
      }
    }
    if (previousWasGhost !== this.localIsGhost) {
      setBackgroundMusicForGhostMode(this.registry, this.localIsGhost);
    }
    if (this.boat) {
      this.applyLocalBoatGhostVisual(this.boat, me.isGhost ?? false);
    }
  }

  /**
   * Black screen with large label text that scales in, then fades (invert/day switch happens underneath first).
   */
  private playPratTransitionOverlay(overrides?: Partial<PratTransitionOverlayOptions>): void {
    if (!this.isSceneActive) return;
    this.clearDeathPratOverlay();

    const options: PratTransitionOverlayOptions = {
      ...DEFAULT_PRAT_TRANSITION_OVERLAY,
      ...overrides,
    };

    const width = this.scale.width;
    const height = this.scale.height;
    const root = this.add.container(0, 0);
    this.deathPratOverlayRoot = root;
    root.setScrollFactor(0);
    root.setDepth(DEATH_PRAT_OVERLAY_DEPTH);

    const background = this.add
      .rectangle(width / 2, height / 2, width + 8, height + 8, 0x000000)
      .setAlpha(1);
    const fontPixels = Math.min(width, height) * 0.2;
    const label = this.add
      .text(width / 2, height / 2, options.labelText, {
        fontFamily: "Arial Black, Arial, sans-serif",
        fontSize: `${fontPixels}px`,
        color: "#ffffff",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setAlpha(1);
    label.setScale(0.32);

    root.add([background, label]);

    this.tweens.add({
      targets: label,
      scale: 1,
      duration: options.scaleInDurationMs,
      ease: "Back.easeOut",
      onComplete: () => {
        if (!this.isSceneActive || !this.deathPratOverlayRoot) return;
        this.tweens.add({
          targets: [background, label],
          alpha: 0,
          duration: options.fadeOutDurationMs,
          ease: "Sine.easeInOut",
          onComplete: () => {
            this.clearDeathPratOverlay();
          },
        });
      },
    });
  }

  /**
   * White texture: black tint = normal boat; ghost with full-screen invert = black tint (reads white after invert);
   * ghost without invert = clear tint (white boat).
   */
  private applyLocalBoatGhostVisual(sprite: Phaser.Physics.Arcade.Sprite, isGhost: boolean): void {
    if (isGhost) {
      if (this.ghostCameraInversionActive) {
        sprite.setTint(BOAT_SILHOUETTE_TINT);
      } else {
        sprite.clearTint();
      }
    } else {
      sprite.setTint(BOAT_SILHOUETTE_TINT);
    }
  }

  private refreshLocalBoatDisplayScale(): void {
    if (!this.boat) return;
    this.boat.setScale(boatDisplayScaleForLevel(this.level));
    this.boat.refreshBody();
  }

  private applyRemoteBoatGhostAppearance(sprite: Phaser.GameObjects.Image, remotePlayerIsGhost: boolean): void {
    const existingFx = this.remoteBoatGhostFx.get(sprite);
    if (this.localIsGhost) {
      if (existingFx) {
        try {
          sprite.postFX.remove(existingFx);
        } catch {
          // ignore
        }
        this.remoteBoatGhostFx.delete(sprite);
      }
      if (this.ghostCameraInversionActive) {
        sprite.setTint(BOAT_SILHOUETTE_TINT);
      } else if (remotePlayerIsGhost) {
        sprite.clearTint();
      } else {
        sprite.setTint(BOAT_SILHOUETTE_TINT);
      }
      return;
    }
    if (remotePlayerIsGhost) {
      if (!existingFx) {
        try {
          if (sprite.postFX == null) {
            sprite.initPostPipeline();
          }
          const colorMatrix = sprite.postFX.addColorMatrix();
          colorMatrix.negative();
          this.remoteBoatGhostFx.set(sprite, colorMatrix as unknown as Phaser.FX.Controller);
        } catch {
          // WebGL post FX unavailable: white ghost boat without per-sprite invert
        }
      }
      if (this.remoteBoatGhostFx.has(sprite)) {
        sprite.setTint(BOAT_SILHOUETTE_TINT);
      } else {
        sprite.clearTint();
      }
    } else {
      if (existingFx) {
        try {
          sprite.postFX.remove(existingFx);
        } catch {
          // ignore
        }
        this.remoteBoatGhostFx.delete(sprite);
      }
      sprite.setTint(BOAT_SILHOUETTE_TINT);
    }
  }

  private layoutRemoteBoatHud(boatData: RemoteBoatData, data: RemotePlayer): void {
    const remoteScale = boatDisplayScaleForLevel(data.level ?? 1);
    boatData.sprite.setScale(remoteScale);
    const displayName =
      data.name && data.name.length <= MAX_PLAYER_NAME_LENGTH ? data.name : shortId(data.id);
    boatData.nameLabel.setText(displayName);
    boatData.nameLabel.setStyle({ fontSize: `${boatNameFontSizePxForScale(remoteScale)}px` });
    const labelOffset = nameLabelOffsetAboveBoatForScale(remoteScale);
    const displayedX = boatData.sprite.x;
    const displayedY = boatData.sprite.y;
    boatData.nameLabel.setPosition(displayedX, displayedY - labelOffset);
    const lifeRatio = (data.life ?? MAX_LIFE) / MAX_LIFE;
    boatData.lifeBar?.clear();
    if (boatData.lifeBar) {
      const remoteLifeBarTopY = displayedY - labelOffset - REMOTE_LIFE_BAR_OFFSET_ABOVE_NAME_CENTER;
      this.drawBar(boatData.lifeBar, displayedX - 25, remoteLifeBarTopY, 50, 6, 0x333333, 0xff0000, lifeRatio);
    }
  }

  /**
   * Remote boats would otherwise jump every SSE tick; ease sprites toward the last authoritative snapshot.
   */
  private smoothRemoteBoatSpritesTowardAuthoritativeState(): void {
    if (!this.isSceneActive || this.remoteBoats.size === 0) return;
    try {
      if (this.scene == null || !this.scene.isActive()) return;
    } catch {
      return;
    }
    const deltaSeconds = this.game.loop.delta / 1000;
    const positionSmoothingRate = 14;
    const rotationSmoothingRate = 16;
    const positionBlend = 1 - Math.exp(-positionSmoothingRate * deltaSeconds);
    const rotationBlend = 1 - Math.exp(-rotationSmoothingRate * deltaSeconds);
    for (const [, boatData] of this.remoteBoats) {
      const sprite = boatData.sprite;
      const targetX = boatData.authoritativeWorldX;
      const targetY = boatData.authoritativeWorldY;
      const targetRotation = boatData.authoritativeRotation;
      sprite.x += (targetX - sprite.x) * positionBlend;
      sprite.y += (targetY - sprite.y) * positionBlend;
      const currentRotation = sprite.rotation;
      const rotationDelta = Phaser.Math.Angle.Wrap(targetRotation - currentRotation);
      sprite.rotation = currentRotation + rotationDelta * rotationBlend;
      this.layoutRemoteBoatHud(boatData, boatData.lastRemotePlayerPayload);
    }
  }

  private updateMultiplayerStatus(): void {
    const statusText = this.children.getByName("multiplayer-status") as Phaser.GameObjects.Text;
    if (statusText) {
      const n = this.connectedPlayerCount;
      const label = n === 1 ? "1 joueur" : `${n} joueurs`;
      statusText.setText(label);
      statusText.setPosition(this.scale.width - 70, this.multiplayerHudTopPx);
    }
  }

  private updateRemoteBoats(players: Map<string, RemotePlayer>): void {
    if (!this.isSceneActive || !this.add) return;
    try {
      if (this.scene == null || !this.scene.isActive()) return;
    } catch {
      return;
    }
    try {
      for (const [playerId, data] of players) {
        if (data.x == null || data.y == null) continue;
        const remotePayload: RemotePlayer = { ...data, id: playerId };
        const targetRotation = data.rotation ?? 0;
        let boatData = this.remoteBoats.get(playerId);
        if (!boatData) {
          if (!this.textures.exists("boat")) return;
          const sprite = this.add.image(data.x, data.y, "boat");
          sprite.setDepth(5);
          sprite.setInteractive({ useHandCursor: true });
          const displayName =
            data.name && data.name.length <= MAX_PLAYER_NAME_LENGTH ? data.name : shortId(playerId);
          const nameLabel = this.add
            .text(data.x, data.y - 50, displayName, {
              fontSize: "12px",
              color: "#000",
            })
            .setOrigin(0.5)
            .setDepth(6);
          const lifeBar = this.add.graphics().setDepth(7);
          boatData = {
            sprite,
            nameLabel,
            lifeBar,
            authoritativeWorldX: data.x,
            authoritativeWorldY: data.y,
            authoritativeRotation: targetRotation,
            lastRemotePlayerPayload: remotePayload,
          };
          this.remoteBoats.set(playerId, boatData);
          this.applyRemoteBoatGhostAppearance(boatData.sprite, data.isGhost ?? false);
          this.layoutRemoteBoatHud(boatData, remotePayload);
          continue;
        }
        boatData.authoritativeWorldX = data.x;
        boatData.authoritativeWorldY = data.y;
        boatData.authoritativeRotation = targetRotation;
        boatData.lastRemotePlayerPayload = remotePayload;
        this.applyRemoteBoatGhostAppearance(boatData.sprite, data.isGhost ?? false);
      }
      for (const playerId of this.remoteBoats.keys()) {
        if (!players.has(playerId)) {
          const data = this.remoteBoats.get(playerId);
          data?.sprite.destroy();
          data?.nameLabel.destroy();
          data?.lifeBar?.destroy();
          this.remoteBoats.delete(playerId);
        }
      }
    } catch {
      // Scene may be destroyed, ignore
    }
  }

  private fireLettersAtTarget(targetPlayerId: string): void {
    if (this.localIsGhost) return;
    const targetBoat = this.remoteBoats.get(targetPlayerId);
    if (!targetBoat) return;

    const startX = this.boat.x;
    const startY = this.boat.y;
    const ts = Date.now();
    this.recordSessionAction();
    void this.multiplayer.sendGameInput({
      type: "SHOOT",
      timestamp: ts,
      startX: phaserPixelsToSimulation(startX),
      startY: phaserPixelsToSimulation(startY),
      targetX: phaserPixelsToSimulation(targetBoat.sprite.x),
      targetY: phaserPixelsToSimulation(targetBoat.sprite.y),
    });
  }

  private fireLettersAtPosition(worldX: number, worldY: number): void {
    if (this.localIsGhost) return;
    const startX = this.boat.x;
    const startY = this.boat.y;
    const ts = Date.now();
    this.recordSessionAction();
    void this.multiplayer.sendGameInput({
      type: "SHOOT",
      timestamp: ts,
      startX: phaserPixelsToSimulation(startX),
      startY: phaserPixelsToSimulation(startY),
      targetX: phaserPixelsToSimulation(worldX),
      targetY: phaserPixelsToSimulation(worldY),
    });
  }

  private fireLettersAtOctopus(octopusId: string): void {
    if (this.localIsGhost) return;
    if (!this.octopuses.has(octopusId)) return;

    const octopus = this.octopuses.get(octopusId);
    if (!octopus) return;

    const ts = Date.now();
    this.recordSessionAction();
    void this.multiplayer.sendGameInput({
      type: "SHOOT",
      timestamp: ts,
      startX: phaserPixelsToSimulation(this.boat.x),
      startY: phaserPixelsToSimulation(this.boat.y),
      targetX: phaserPixelsToSimulation(octopus.sprite.x),
      targetY: phaserPixelsToSimulation(octopus.sprite.y),
    });
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    if (pointer.button === 2) {
      this.recordSessionAction();
      this.moveTargetX = this.clampToWorldBounds(worldPoint.x);
      this.moveTargetY = this.clampToWorldBounds(worldPoint.y);
      return;
    }
    if (pointer.button === 0) {
      this.handleLeftClick(worldPoint.x, worldPoint.y);
    }
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    this.input.setDefaultCursor("crosshair");
  }

  private handleLeftClick(worldX: number, worldY: number): void {
    if (this.localIsGhost) return;
    const clickRadius = CLICK_TARGET_RADIUS;
    for (const [playerId, boatData] of this.remoteBoats) {
      const distance = Phaser.Math.Distance.Between(worldX, worldY, boatData.sprite.x, boatData.sprite.y);
      if (distance < clickRadius) {
        this.fireLettersAtTarget(playerId);
        return;
      }
    }
    if (this.octopusesEnabled) {
      for (const [octopusId, octopus] of this.octopuses) {
        const distance = Phaser.Math.Distance.Between(worldX, worldY, octopus.sprite.x, octopus.sprite.y);
        if (distance < clickRadius) {
          this.fireLettersAtOctopus(octopusId);
          return;
        }
      }
    }
    if (this.stingraysEnabled) {
      for (const [, stingray] of this.stingrays) {
        const distance = Phaser.Math.Distance.Between(worldX, worldY, stingray.sprite.x, stingray.sprite.y);
        if (distance < clickRadius) {
          this.fireLettersAtPosition(stingray.sprite.x, stingray.sprite.y);
          return;
        }
      }
    }
    this.fireLettersAtPosition(worldX, worldY);
  }

  private spawnEphemeralHudMessage(message: string): void {
    if (!this.isSceneActive) return;
    try {
      const label = this.add
        .text(this.scale.width / 2, 110, message, { fontSize: "16px", color: "#1f2d3d" })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(1000);
      this.tweens.add({
        targets: label,
        alpha: 0,
        y: label.y - 18,
        duration: 900,
        ease: "Sine.easeInOut",
        onComplete: () => label.destroy(),
      });
    } catch {
      // Scene tearing down
    }
  }

  private updateBoatMovement(): void {
    if (this.moveTargetX === null || this.moveTargetY === null) {
      this.boat.setVelocity(0, 0);
      return;
    }
    const distance = Phaser.Math.Distance.Between(
      this.boat.x,
      this.boat.y,
      this.moveTargetX,
      this.moveTargetY
    );
    if (distance < this.moveArrivalThreshold) {
      this.moveTargetX = null;
      this.moveTargetY = null;
      this.boat.setVelocity(0, 0);
      return;
    }
    const direction = normalizeDirection(
      this.boat.x,
      this.boat.y,
      this.moveTargetX,
      this.moveTargetY
    );
    this.boat.setVelocity(
      direction.x * this.boatSpeed,
      direction.y * this.boatSpeed
    );
    const movementAngle = Phaser.Math.Angle.Between(
      this.boat.x,
      this.boat.y,
      this.moveTargetX,
      this.moveTargetY
    );
    this.boat.rotation =
      Math.abs(movementAngle) < Math.PI / 2
        ? movementAngle + Math.PI
        : movementAngle;
  }

  private clampToWorldBounds(value: number): number {
    return Phaser.Math.Clamp(value, -WORLD_SIZE + WORLD_MARGIN, WORLD_SIZE - WORLD_MARGIN);
  }

  update(): void {
    if (!this.boat || !this.boatNameLabel || !this.lifeBar || !this.experienceBar) return;
    const localNameFontPx = boatNameFontSizePxForScale(this.boat.scaleX);
    this.boatNameLabel.setStyle({ fontSize: `${localNameFontPx}px` });
    this.boatNameLabel.setPosition(
      this.boat.x,
      this.boat.y - nameLabelOffsetAboveBoatForScale(this.boat.scaleX)
    );
    this.sea.setPosition(this.boat.x, this.boat.y);
    this.sea.tilePositionX = this.boat.x;
    this.sea.tilePositionY = this.boat.y;

    const barWidth = 200;
    const barHeight = 14;
    const lifeY = this.scale.height - 55;
    const experienceY = this.scale.height - 35;
    this.drawBar(this.lifeBar, BAR_X, lifeY, barWidth, barHeight, 0x333333, 0x00ff00, this.life / MAX_LIFE);
    const { current: experienceInCurrentLevel, needed: experienceNeededForNextLevel } =
      getExperienceProgressTowardNextLevel(this.experience);
    const experienceBarRatio =
      experienceNeededForNextLevel > 0 ? experienceInCurrentLevel / experienceNeededForNextLevel : 0;
    this.drawBar(
      this.experienceBar,
      BAR_X,
      experienceY,
      barWidth,
      barHeight,
      0x333333,
      0x9b59b6,
      experienceBarRatio
    );
    const levelText = this.children.getByName("level-text") as Phaser.GameObjects.Text;
    if (levelText) levelText.setText(`Niv. ${this.level}`);

    if (this.authoritativeGameServer && this.boat && this.localBoatPositionSyncedFromAuthoritativeState) {
      const now = Date.now();
      if (now - this.lastMoveInputSentAt >= this.serverMoveThrottleMs) {
        this.lastMoveInputSentAt = now;
        void this.multiplayer.sendGameInput({
          type: "MOVE",
          timestamp: now,
          x: phaserPixelsToSimulation(this.boat.x),
          y: phaserPixelsToSimulation(this.boat.y),
          rotation: this.boat.rotation,
          name: this.playerName ?? undefined,
        });
      }
    }
    this.updateStingrays();
    this.updateBoatMovement();

    this.checkPratCapture();
    this.smoothRemoteBoatSpritesTowardAuthoritativeState();
  }

  private updateCameraZoom(): void {
    const camera = this.cameras.main;
    const zoomX = camera.width / VIEW_WIDTH;
    const zoomY = camera.height / VIEW_HEIGHT;
    camera.setZoom(Math.min(zoomX, zoomY));
  }

  private applyServerGameState(state: SerializableGameState): void {
    this.applyServerPlayersState(state);
    this.applyServerPratsState(state);
    this.applyServerTownsState(state);
    this.applyServerOctopusState(state);
    this.applyServerStingrayState(state);
    this.applyServerProjectilesState(state);
    this.applyServerCombatEvents(state);
  }

  /** Remote boats and local HUD fields from authoritative game state. */
  private applyServerPlayersState(state: SerializableGameState): void {
    const localPlayerId = this.multiplayer.getPlayerId();
    const me = state.players?.[localPlayerId];
    if (me) {
      const oldScore = this.score;
      const newLife = me.life ?? MAX_LIFE;
      const newScore = me.score ?? 0;
      const boat = this.boat;
      const wasGhost = this.localIsGhost;
      const prevGhostPrats = this.syncedGhostPratsCaptured;
      const becameGhostFromDeath =
        this.hudSyncedFromServer && !wasGhost && (me.isGhost ?? false);
      const revivedFromGhost =
        this.hudSyncedFromServer && wasGhost && !(me.isGhost ?? false);

      if (this.hudSyncedFromServer && boat && !me.isGhost) {
        if (newScore > oldScore && newScore - oldScore <= SCORE_DELTA_PRAT_PICKUP_MAX) {
          this.spawnPratPickupBurst(boat.x, boat.y, false);
        }
      }
      const nextGhostPratsCaptured = me.ghostPratsCaptured ?? 0;
      if (this.hudSyncedFromServer && boat && me.isGhost) {
        if (
          nextGhostPratsCaptured > prevGhostPrats &&
          nextGhostPratsCaptured === prevGhostPrats + 1
        ) {
          this.spawnGhostPratFloatingNumber(
            boat.x,
            boat.y,
            GHOST_PRATS_TO_LEAVE - prevGhostPrats
          );
        }
      }
      if (
        this.hudSyncedFromServer &&
        boat &&
        wasGhost &&
        !me.isGhost &&
        prevGhostPrats === GHOST_PRATS_TO_LEAVE - 1
      ) {
        this.spawnGhostPratFloatingNumber(boat.x, boat.y, 1);
      }
      this.hudSyncedFromServer = true;

      const previousLevel = this.level;
      this.life = newLife;
      this.score = newScore;
      this.level = me.level ?? 1;
      this.experience = me.experience ?? 0;
      this.killsOctopus = me.killsOctopus ?? 0;
      this.killsStingray = me.killsStingray ?? 0;
      this.pratsCaptured = me.pratsCaptured ?? 0;
      this.prats = me.prats ?? 0;
      this.scoreText.setText(formatPratsHudLabel(this.pratsCaptured, this.prats));
      this.localIsGhost = me.isGhost ?? false;
      this.syncedGhostPratsCaptured = me.ghostPratsCaptured ?? 0;

      if (boat) {
        const serverX = simulationToPhaserPixels(me.x);
        const serverY = simulationToPhaserPixels(me.y);
        const dist = Phaser.Math.Distance.Between(boat.x, boat.y, serverX, serverY);
        const reconciliationThresholdPhaser = simulationToPhaserPixels(120);
        const awaitingFirstAuthoritativePlacement = !this.localBoatPositionSyncedFromAuthoritativeState;
        if (awaitingFirstAuthoritativePlacement) {
          boat.setPosition(serverX, serverY);
          boat.setAlpha(1);
          this.boatNameLabel.setAlpha(1);
          if (!this.cameraFollowsLocalBoat) {
            this.cameras.main.startFollow(boat, true, 0.1, 0.1);
            this.cameraFollowsLocalBoat = true;
          }
        } else if (dist > reconciliationThresholdPhaser) {
          boat.setPosition(serverX, serverY);
        }
        this.localBoatPositionSyncedFromAuthoritativeState = true;
        this.refreshLocalBoatDisplayScale();
      }

      this.applyLocalGhostPresentationAfterServer(me, wasGhost);

      if (wasGhost !== this.localIsGhost || prevGhostPrats !== this.syncedGhostPratsCaptured) {
        void this.savePlayer();
      }
      if (this.level > previousLevel) {
        void this.savePlayer();
        this.showLevelUpMessage(this.level);
      }

      if (becameGhostFromDeath) {
        this.playPratTransitionOverlay();
      } else if (revivedFromGhost) {
        this.playPratTransitionOverlay({
          labelText: REVIVE_PRAT_LABEL_TEXT,
          scaleInDurationMs: REVIVE_PRAT_SCALE_IN_MS,
          fadeOutDurationMs: REVIVE_PRAT_FADE_OUT_MS,
        });
      }
    }

    const playersFromServer = new Map<string, RemotePlayer>();
    for (const [playerId, playerData] of Object.entries(state.players ?? {})) {
      if (playerId === localPlayerId) continue;
      playersFromServer.set(playerId, {
        id: playerId,
        name: playerData.name,
        x: simulationToPhaserPixels(playerData.x ?? 0),
        y: simulationToPhaserPixels(playerData.y ?? 0),
        rotation: playerData.rotation,
        score: playerData.score ?? 0,
        life: playerData.life ?? MAX_LIFE,
        level: playerData.level ?? 1,
        color: playerData.color ?? playerIdToColor(playerId),
        isGhost: playerData.isGhost,
        ghostPratsCaptured: playerData.ghostPratsCaptured,
      });
    }
    this.updateRemoteBoats(playersFromServer);

    this.connectedPlayerCount = Object.keys(state.players ?? {}).length;
    this.updateMultiplayerStatus();
  }

  private applyServerPratsState(state: SerializableGameState): void {
    try {
      const pratsRecord = state.prats ?? {};
      const seenIds = new Set<string>();
      for (const [id, prat] of Object.entries(pratsRecord)) {
        seenIds.add(id);
        this.upsertPratVisual(id, prat);
      }
      for (const id of Array.from(this.pratEntities.keys())) {
        if (!seenIds.has(id)) {
          this.pratEntities.get(id)?.text.destroy();
          this.pratEntities.delete(id);
          this.pratCaptureRequestSent.delete(id);
        }
      }
    } catch {
      // Scene may be destroyed during apply
    }
  }

  private upsertPratVisual(id: string, prat: PratState): void {
    const px = simulationToPhaserPixels(prat.x);
    const py = simulationToPhaserPixels(prat.y);
    let entity = this.pratEntities.get(id);
    if (!entity) {
      const text = this.add.text(px, py, prat.word, {
        fontSize: `${prat.fontSize}px`,
        fontStyle: prat.fontStyle,
        color: prat.color,
      });
      text.setOrigin(0.5);
      text.setDepth(3);
      entity = { id, text };
      this.pratEntities.set(id, entity);
      return;
    }
    entity.text.setPosition(px, py);
    if (entity.text.text !== prat.word) {
      entity.text.setText(prat.word);
    }
    entity.text.setStyle({
      fontSize: `${prat.fontSize}px`,
      fontStyle: prat.fontStyle,
      color: prat.color,
    });
  }

  private applyServerTownsState(state: SerializableGameState): void {
    try {
      const townsRecord = state.towns ?? {};
      const seenIds = new Set<string>();
      const localPlayerId = this.multiplayer.getPlayerId();
      for (const [id, town] of Object.entries(townsRecord)) {
        seenIds.add(id);
        const previousOwnerId = this.townPreviousOwnerById.get(id);
        const previousContenderSalvos = this.townPreviousContenderSalvosById.get(id);
        if (
          previousOwnerId !== undefined &&
          town.ownerId === localPlayerId &&
          previousOwnerId !== town.ownerId
        ) {
          this.spawnTownCapturedToast();
        }
        if (
          previousContenderSalvos !== undefined &&
          town.contenderId != null &&
          town.contenderSalvos > previousContenderSalvos
        ) {
          this.spawnTownInterceptionBurst(
            simulationToPhaserPixels(town.x),
            simulationToPhaserPixels(town.y)
          );
        }
        this.townPreviousOwnerById.set(id, town.ownerId);
        this.townPreviousContenderSalvosById.set(id, town.contenderSalvos);
        this.upsertTownVisual(id, town);
      }
      for (const id of Array.from(this.townEntities.keys())) {
        if (!seenIds.has(id)) {
          const entity = this.townEntities.get(id);
          entity?.text.destroy();
          entity?.nameLabel.destroy();
          entity?.captureBar.destroy();
          this.townEntities.delete(id);
          this.townPreviousOwnerById.delete(id);
          this.townPreviousContenderSalvosById.delete(id);
        }
      }

    } catch {
      // Scene may be destroyed during apply
    }
  }

  private formatTownOwnerDisplayName(town: TownState): string {
    if (town.ownerId == null) return "";
    const raw = town.ownerName?.trim() ?? "";
    if (raw.length > 0 && raw.length <= MAX_PLAYER_NAME_LENGTH) return raw;
    if (raw.length > MAX_PLAYER_NAME_LENGTH) return raw.slice(0, MAX_PLAYER_NAME_LENGTH);
    return shortId(town.ownerId);
  }

  private upsertTownVisual(id: string, town: TownState): void {
    const px = simulationToPhaserPixels(town.x);
    const py = simulationToPhaserPixels(town.y);
    let entity = this.townEntities.get(id);
    const labelText = "T";
    const localPlayerId = this.multiplayer.getPlayerId();
    const isOwnedByMe = town.ownerId === localPlayerId;
    const isNeutral = town.ownerId == null;
    const color = isOwnedByMe ? TOWN_LETTER_COLOR_LOCAL : isNeutral ? "#000000" : TOWN_LETTER_COLOR_OTHER_OWNER;
    const glowColor = isOwnedByMe ? TOWN_GLOW_COLOR_LOCAL : TOWN_GLOW_COLOR_OTHER_OWNER;
    const ownerDisplayName = this.formatTownOwnerDisplayName(town);
    const nameLabelY = py - TOWN_OWNER_NAME_OFFSET_ABOVE_LETTER_PX;

    if (!entity) {
      const text = this.add.text(px, py, labelText, {
        fontSize: "46px",
        fontStyle: "bold",
        color: "#000000",
      });
      text.setOrigin(0.5);
      text.setDepth(9);
      text.setAlpha(1);

      const nameLabel = this.add.text(px, nameLabelY, ownerDisplayName, {
        fontSize: "14px",
        fontStyle: "bold",
        color: "#000000",
      });
      nameLabel.setOrigin(0.5, 1);
      nameLabel.setDepth(10);

      const captureBar = this.add.graphics();
      captureBar.setDepth(10);

      entity = { id, text, nameLabel, captureBar };
      this.townEntities.set(id, entity);
      this.applyTownVisualState(entity, px, py, color, glowColor, isNeutral, ownerDisplayName, nameLabelY, town);
      return;
    }

    entity.text.setPosition(px, py);
    entity.nameLabel.setPosition(px, nameLabelY);
    this.applyTownVisualState(entity, px, py, color, glowColor, isNeutral, ownerDisplayName, nameLabelY, town);
  }

  private applyTownVisualState(
    entity: TownEntity,
    px: number,
    py: number,
    letterColor: string,
    glowColor: string,
    isNeutral: boolean,
    ownerDisplayName: string,
    nameLabelY: number,
    town: TownState
  ): void {
    this.tweens.killTweensOf(entity.text);
    entity.text.setPosition(px, py);
    entity.nameLabel.setPosition(px, nameLabelY);

    if (isNeutral) {
      entity.text.setAlpha(1);
      entity.text.setStyle({ fontSize: "46px", fontStyle: "bold", color: "#000000" });
      entity.text.setShadow(0, 0, "#000000", 0, false, false);
      entity.nameLabel.setText("");
      entity.nameLabel.setVisible(false);
      this.drawTownCaptureBar(entity, px, py, town);
      return;
    }

    entity.text.setStyle({ fontSize: "46px", fontStyle: "bold", color: letterColor });
    entity.text.setShadow(0, 0, glowColor, 10, true, true);
    entity.text.setAlpha(1);
    this.tweens.add({
      targets: entity.text,
      alpha: 0.25,
      duration: TOWN_OWNED_BLINK_HALF_PERIOD_MS,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    entity.nameLabel.setText(ownerDisplayName);
    entity.nameLabel.setVisible(true);
    entity.nameLabel.setStyle({ fontSize: "14px", fontStyle: "bold", color: "#000000" });
    this.drawTownCaptureBar(entity, px, py, town);
  }

  private drawTownCaptureBar(entity: TownEntity, px: number, py: number, town: TownState): void {
    const captureProgress =
      town.contenderId == null ? 0 : Phaser.Math.Clamp(town.contenderSalvos / TOWN_CAPTURE_SALVOS_REQUIRED, 0, 1);
    const width = 60;
    const height = 8;
    const x = px - width / 2;
    const y = py + 34;
    entity.captureBar.clear();
    entity.captureBar.fillStyle(0x333333, 0.8);
    entity.captureBar.fillRect(x, y, width, height);
    if (captureProgress > 0) {
      entity.captureBar.fillStyle(0x00ff00, 1);
      entity.captureBar.fillRect(x, y, width * captureProgress, height);
    }
  }

  /** Toast when the local player captures a town (gold style like ghost prat feedback). */
  private spawnTownCapturedToast(): void {
    if (!this.isSceneActive) return;
    try {
      const label = this.add
        .text(this.scale.width / 2, this.scale.height * 0.22, "Captured", {
          fontFamily: "Arial",
          fontSize: "28px",
          fontStyle: "bold",
          color: "#ffd700",
          stroke: "#000000",
          strokeThickness: 4,
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(1200);
      this.tweens.add({
        targets: label,
        y: label.y - 48,
        alpha: 0,
        duration: 1800,
        ease: "Sine.easeInOut",
        onComplete: () => label.destroy(),
      });
    } catch {
      // Scene tearing down
    }
  }

  /** Green pulse when a projectile is intercepted by a town and capture progress increases. */
  private spawnTownInterceptionBurst(worldX: number, worldY: number): void {
    if (!this.isSceneActive) return;
    try {
      const flash = this.add.circle(worldX, worldY, 64, 0x00c853, 0.36);
      flash.setDepth(12);
      this.tweens.add({
        targets: flash,
        alpha: 0,
        scale: 2.2,
        duration: 380,
        ease: "Sine.easeOut",
        onComplete: () => flash.destroy(),
      });
    } catch {
      // Scene tearing down
    }
  }

  private applyServerProjectilesState(state: SerializableGameState): void {
    try {
      const seen = new Set<string>();
      for (const [id, projectile] of Object.entries(state.projectiles)) {
        const fromOctopus = projectile.shooterId.startsWith("octopus:");
        const fromTown = projectile.shooterId.startsWith("town:");
        if (fromOctopus && !this.octopusesEnabled) {
          continue;
        }
        seen.add(id);
        let fontSize: string;
        if (fromOctopus || fromTown) {
          fontSize = "24px";
        } else {
          const shooterLevel = state.players?.[projectile.shooterId]?.level ?? 1;
          const shooterScale = boatDisplayScaleForLevel(shooterLevel);
          const baseFontSize = playerProjectileFontSizePxForScale(shooterScale);
          const adjustedFontSize = projectile.isShortRange ? Math.max(14, Math.round(baseFontSize * 0.65)) : baseFontSize;
          fontSize = `${adjustedFontSize}px`;
        }
        const projX = simulationToPhaserPixels(projectile.x);
        const projY = simulationToPhaserPixels(projectile.y);
        let text = this.serverProjectileSprites.get(id);
        if (!text) {
          text = this.add.text(projX, projY, projectile.letter, {
            fontSize,
            fontStyle: "bold",
            color: "#000000",
          });
          text.setOrigin(0.5);
          text.setDepth(8);
          this.serverProjectileSprites.set(id, text);
        } else {
          text.setPosition(projX, projY);
          if (text.text !== projectile.letter) {
            text.setText(projectile.letter);
          }
          text.setStyle({ fontSize, fontStyle: "bold", color: "#000000" });
        }
      }
      for (const id of Array.from(this.serverProjectileSprites.keys())) {
        if (!seen.has(id)) {
          this.serverProjectileSprites.get(id)?.destroy();
          this.serverProjectileSprites.delete(id);
        }
      }
    } catch {
      // Scene destroyed
    }
  }

  private applyServerCombatEvents(state: SerializableGameState): void {
    const maxTracked = 400;
    const localId = this.multiplayer.getPlayerId();
    const localFromState = state.players?.[localId];

    // Local player was damaged or healed (mirror of projectileHitDealtEvents for the attacker).
    for (const event of state.projectileHitReceivedEvents ?? []) {
      if (this.processedProjectileHitReceivedEventIds.has(event.id)) continue;
      if (event.targetPlayerId !== localId) {
        this.processedProjectileHitReceivedEventIds.add(event.id);
        continue;
      }
      this.processedProjectileHitReceivedEventIds.add(event.id);
      const damageAmount = Number(event.damage);
      const worldX = this.boat?.x ?? simulationToPhaserPixels(event.x ?? localFromState?.x ?? 0);
      const worldY = this.boat?.y ?? simulationToPhaserPixels(event.y ?? localFromState?.y ?? 0);
      if (damageAmount > 0) {
        this.spawnDamageBurst(worldX, worldY, damageAmount);
      } else if (damageAmount < 0) {
        this.spawnPratPickupBurst(worldX, worldY, true);
      }
    }
    this.trimStringIdSet(this.processedProjectileHitReceivedEventIds, maxTracked);

    // Local player dealt damage to any target (player, octopus, or stingray); one burst per hit.
    for (const event of state.projectileHitDealtEvents ?? []) {
      if (this.processedProjectileHitDealtEventIds.has(event.id)) continue;
      if (event.attackerId !== localId) {
        this.processedProjectileHitDealtEventIds.add(event.id);
        continue;
      }
      this.processedProjectileHitDealtEventIds.add(event.id);
      const damageAmount = Number(event.damage);
      if (damageAmount > 0) {
        this.spawnDamageBurst(simulationToPhaserPixels(event.x), simulationToPhaserPixels(event.y), damageAmount);
      }
    }
    this.trimStringIdSet(this.processedProjectileHitDealtEventIds, maxTracked);

    for (const event of state.eliminationEvents ?? []) {
      if (this.processedEliminationIds.has(event.id)) continue;
      this.processedEliminationIds.add(event.id);
      if (event.attackerId === localId) {
        this.savePlayer();
      }
    }
    this.trimStringIdSet(this.processedEliminationIds, maxTracked);
  }

  private trimStringIdSet(set: Set<string>, maxSize: number): void {
    while (set.size > maxSize) {
      const first = set.values().next().value;
      if (first === undefined) break;
      set.delete(first);
    }
  }

  /** Syncs stingray entities from authoritative server state (SSE). */
  private applyServerStingrayState(state: SerializableGameState): void {
    if (!this.stingraysEnabled) {
      for (const stingray of this.stingrays.values()) {
        stingray.sprite.destroy();
        stingray.lifeBar.destroy();
      }
      this.stingrays.clear();
      return;
    }
    if (!this.textures.exists("stingray")) return;
    try {
      const stingraysFromServer = state.stingrays ?? {};
      const seenIds = new Set<string>();
      for (const [id, ray] of Object.entries(stingraysFromServer)) {
        seenIds.add(id);
        const rayX = simulationToPhaserPixels(ray.x);
        const rayY = simulationToPhaserPixels(ray.y);
        let entity = this.stingrays.get(id);
        if (!entity) {
          const sprite = this.add.image(rayX, rayY, "stingray");
          sprite.setScale(1.2);
          sprite.setDepth(4);
          sprite.setInteractive({ useHandCursor: true });
          const lifeBar = this.add.graphics().setDepth(6);
          entity = {
            id,
            sprite,
            lifeBar,
            life: ray.life,
            baseY: ray.baseY,
            spawnTime: ray.spawnTime,
          };
          this.stingrays.set(id, entity);
        } else {
          entity.sprite.setPosition(rayX, rayY);
          entity.life = ray.life;
          entity.baseY = ray.baseY;
          entity.spawnTime = ray.spawnTime;
        }
        const maxLife = ray.maxLife > 0 ? ray.maxLife : STINGRAY_LIFE;
        const lifeRatio = ray.life / maxLife;
        entity.lifeBar.clear();
        this.drawBar(entity.lifeBar, rayX - 20, rayY - 35, 40, 5, 0x333333, 0xff6600, lifeRatio);
      }
      for (const id of Array.from(this.stingrays.keys())) {
        if (!seenIds.has(id)) {
          const stingray = this.stingrays.get(id);
          if (stingray) {
            stingray.sprite.destroy();
            stingray.lifeBar.destroy();
          }
          this.stingrays.delete(id);
        }
      }
    } catch {
      // Scene may be destroyed during apply
    }
  }

  /** Syncs octopus entities from authoritative server state (SSE). */
  private applyServerOctopusState(state: SerializableGameState): void {
    if (!this.octopusesEnabled) {
      for (const octopus of this.octopuses.values()) {
        octopus.sprite.destroy();
        octopus.lifeBar.destroy();
      }
      this.octopuses.clear();
      return;
    }
    if (!this.textures.exists("octopus")) return;
    try {
      const seenIds = new Set<string>();
      for (const [id, enemy] of Object.entries(state.enemies)) {
        seenIds.add(id);
        const enemyX = simulationToPhaserPixels(enemy.x);
        const enemyY = simulationToPhaserPixels(enemy.y);

        let entity = this.octopuses.get(id);
        if (!entity) {
          const sprite = this.add.image(enemyX, enemyY, "octopus");
          sprite.setScale(0.8);
          sprite.setDepth(5);
          sprite.setInteractive({ useHandCursor: true });
          const lifeBar = this.add.graphics().setDepth(7);
          entity = {
            id,
            sprite,
            lifeBar,
            life: enemy.life,
            lastShotTime: enemy.lastShotTime,
            spawnTime: enemy.spawnTime,
          };
          this.octopuses.set(id, entity);
        } else {
          entity.sprite.setPosition(enemyX, enemyY);
          entity.life = enemy.life;
          entity.lastShotTime = enemy.lastShotTime;
          entity.spawnTime = enemy.spawnTime;
        }

        const maxLife = enemy.maxLife > 0 ? enemy.maxLife : OCTOPUS_LIFE;
        const lifeRatio = enemy.life / maxLife;
        entity.lifeBar.clear();
        this.drawBar(entity.lifeBar, enemyX - 25, enemyY - 50, 50, 6, 0x333333, 0xff0000, lifeRatio);
      }

      for (const id of Array.from(this.octopuses.keys())) {
        if (!seenIds.has(id)) {
          const octopus = this.octopuses.get(id);
          if (octopus) {
            octopus.sprite.destroy();
            octopus.lifeBar.destroy();
          }
          this.octopuses.delete(id);
        }
      }
    } catch {
      // Scene may be destroyed during apply
    }
  }

  private updateStingrays(): void {
    // Stingray motion and spawn come from the game server via applyServerStingrayState.
  }

  private spawnDamageBurst(worldX: number, worldY: number, damage: number): void {
    if (!this.isSceneActive) return;
    try {
      // Match prat pickup burst size and duration so the red hit feedback is equally visible.
      const radius = 52 + Math.min(24, damage * 1.2);
      const flash = this.add.circle(worldX, worldY, radius, 0xff2222, 0.48);
      flash.setDepth(12);
      this.tweens.add({
        targets: flash,
        alpha: 0,
        scale: 2,
        duration: 360 + Math.min(80, damage * 3),
        onComplete: () => flash.destroy(),
      });
    } catch {
      // Scene tearing down
    }
  }

  private spawnPratPickupBurst(worldX: number, worldY: number, isHeal: boolean): void {
    if (!this.isSceneActive) return;
    try {
      const color = isHeal ? 0x00aa44 : 0x111111;
      const alpha = isHeal ? 0.4 : 0.45;
      const flash = this.add.circle(worldX, worldY, 58, color, alpha);
      flash.setDepth(11);
      this.tweens.add({
        targets: flash,
        alpha: 0,
        scale: 2,
        duration: isHeal ? 420 : 380,
        onComplete: () => flash.destroy(),
      });
    } catch {
      // Scene tearing down
    }
  }

  /** One Mario-style number per ghost prat pickup (remaining count for this capture). */
  private spawnGhostPratFloatingNumber(worldX: number, worldY: number, displayValue: number): void {
    if (!this.isSceneActive) return;
    try {
      const label = this.add.text(worldX, worldY, String(displayValue), {
        fontFamily: "Arial",
        fontSize: "32px",
        fontStyle: "bold",
        color: "#ffd700",
        stroke: "#000000",
        strokeThickness: 3,
      });
      label.setOrigin(0.5, 0.5);
      label.setDepth(13);
      this.tweens.add({
        targets: label,
        y: worldY - GHOST_PRAT_FLOAT_RISE_PIXELS,
        alpha: 0,
        duration: GHOST_PRAT_FLOAT_DURATION_MS,
        ease: "Linear",
        onComplete: () => label.destroy(),
      });
    } catch {
      // Scene tearing down
    }
  }

  private checkPratCapture(): void {
    const boatX = this.boat.x;
    const boatY = this.boat.y;

    for (const [pratId, entity] of this.pratEntities) {
      if (this.pratCaptureRequestSent.has(pratId)) continue;

      const distance = Phaser.Math.Distance.Between(boatX, boatY, entity.text.x, entity.text.y);

      if (distance < PRAT_CAPTURE_RADIUS_PIXELS) {
        this.pratCaptureRequestSent.add(pratId);
        this.recordSessionAction();
        void this.multiplayer.sendGameInput({
          type: "PRAT_CAPTURE",
          timestamp: Date.now(),
          pratId,
          x: phaserPixelsToSimulation(boatX),
          y: phaserPixelsToSimulation(boatY),
        });
      }
    }
  }
}
