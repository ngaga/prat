import Phaser from "phaser";
import { EventBus } from "../EventBus";
import { MultiplayerManager, type RemotePlayer } from "../multiplayer/MultiplayerManager";
import type { PratState, SerializableGameState } from "@/lib/gameTypes";
import {
  getExperienceProgressTowardNextLevel,
  GHOST_PRATS_TO_LEAVE,
  MAX_LIFE,
  PRAT_CAPTURE_RADIUS,
} from "@/lib/gameBalance";
import {
  CLICK_TARGET_RADIUS_SIMULATION_UNITS,
  PLAYER_BOAT_SPEED_SIMULATION_UNITS_PER_SECOND,
  PLAYER_MOVE_ARRIVAL_THRESHOLD_SIMULATION_UNITS,
  WORLD_HALF_EXTENT_SIMULATION_UNITS,
  WORLD_MARGIN_SIMULATION_UNITS,
} from "@/lib/simulationSpace";
import { playerIdToColor } from "@/lib/playerColor";
import { getPlayerByName, upsertPlayer } from "@/lib/players";
import { MAX_PLAYER_NAME_LENGTH, VIEW_HEIGHT, VIEW_WIDTH } from "../config";
import { phaserPixelsToSimulation, simulationToPhaserPixels } from "../simulationToDisplay";
import { setBackgroundMusicForGhostMode, stopBackgroundMusic } from "../backgroundMusic";

interface PratEntity {
  id: string;
  text: Phaser.GameObjects.Text;
}

interface RemoteBoatData {
  sprite: Phaser.GameObjects.Image;
  nameLabel: Phaser.GameObjects.Text;
  lifeBar?: Phaser.GameObjects.Graphics;
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
/** Black tint on white boat texture (normal appearance). */
const BOAT_SILHOUETTE_TINT = 0x000000;
function shortId(uuid: string): string {
  return uuid.slice(0, 8);
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
  private localIsGhost = false;
  /** Mirrors server ghost prat count; used for Supabase persistence like experience. */
  private syncedGhostPratsCaptured = 0;
  private ghostHudText: Phaser.GameObjects.Text | null = null;
  /** True when the game canvas uses CSS invert for local ghost mode (affects boat tint vs clear tint). */
  private ghostCameraInversionActive = false;
  /** When the local player is alive, ghost remote boats use per-sprite inversion (camera is off). */
  private remoteBoatGhostFx = new WeakMap<Phaser.GameObjects.Image, Phaser.FX.Controller>();

  constructor() {
    super({ key: "GameScene" });
  }

  init(data: { octopusesEnabled?: boolean; stingraysEnabled?: boolean; playerName?: string }): void {
    this.octopusesEnabled = data?.octopusesEnabled ?? true;
    this.stingraysEnabled = data?.stingraysEnabled ?? true;
    this.playerName = data?.playerName ?? null;
  }

  async create(): Promise<void> {
    this.physics.world.setBounds(-WORLD_SIZE, -WORLD_SIZE, WORLD_SIZE * 2, WORLD_SIZE * 2);

    this.sea = this.add.tileSprite(0, 0, SEA_TILE_SIZE, SEA_TILE_SIZE, "sea");
    this.sea.setOrigin(0.5);

    this.createWorldBorders();
    this.input.on("pointerdown", this.onPointerDown, this);
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
    let existingPlayerForGhost: Awaited<ReturnType<typeof getPlayerByName>> = null;
    if (this.playerName) {
      const existingPlayer = await getPlayerByName(this.playerName);
      existingPlayerForGhost = existingPlayer;
      if (existingPlayer) {
        this.experience = existingPlayer.exp;
        this.level = existingPlayer.level;
        this.killsOctopus = existingPlayer.kills_octopus;
        this.killsStingray = existingPlayer.kills_stingray;
        this.pratsCaptured = existingPlayer.prats_captured ?? 0;
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
          is_ghost: false,
          ghost_prats_captured: 0,
        });
        if (!created) {
          console.warn("Failed to create player in database");
        }
      }
    }

    const ghostRestoreFromDb =
      existingPlayerForGhost?.is_ghost === true
        ? { isGhost: true as const, ghostPratsCaptured: existingPlayerForGhost.ghost_prats_captured ?? 0 }
        : undefined;

    this.boat = this.physics.add.sprite(0, 0, "boat");
    this.boat.setCollideWorldBounds(true);
    this.boat.setScale(0.5);
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

    this.cameras.main.startFollow(this.boat, true, 0.1, 0.1);
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
        ...(ghostRestoreFromDb ? ghostRestoreFromDb : {}),
      });
    } catch {
      // Still connect; HUD may briefly mismatch until the next successful sync.
    }

    // Start SSE after the boat exists so damage VFX always has a world position (sprite or snapshot fallback).
    this.multiplayer.connectGameStream("default");

    this.scoreText = this.add
      .text(0, 0, "Prat capturés: 0", {
        fontSize: "20px",
        color: "#000",
      })
      .setScrollFactor(0)
      .setOrigin(0, 0)
      .setPosition(20, 20);

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

  private async savePlayer(): Promise<void> {
    if (!this.playerName) return;
    await upsertPlayer({
      name: this.playerName,
      exp: this.experience,
      level: this.level,
      kills_octopus: this.killsOctopus,
      kills_stingray: this.killsStingray,
      prats_captured: this.pratsCaptured,
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
    stopBackgroundMusic(this.registry);
    this.savePlayer();
    this.input.off("pointerdown", this.onPointerDown, this);
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
        let boatData = this.remoteBoats.get(playerId);
        if (!boatData) {
          if (!this.textures.exists("boat")) return;
          const sprite = this.add.image(data.x, data.y, "boat");
          sprite.setScale(0.5);
          sprite.setDepth(5);
          sprite.setInteractive({ useHandCursor: true });
          const displayName = data.name && data.name.length <= MAX_PLAYER_NAME_LENGTH ? data.name : shortId(playerId);
          const nameLabel = this.add
            .text(data.x, data.y - 50, displayName, {
              fontSize: "12px",
              color: "#000",
            })
            .setOrigin(0.5)
            .setDepth(6);
          const lifeBar = this.add.graphics().setDepth(7);
          this.remoteBoats.set(playerId, { sprite, nameLabel, lifeBar });
          boatData = { sprite, nameLabel, lifeBar };
        }
        boatData.sprite.setPosition(data.x, data.y);
        boatData.sprite.setRotation(data.rotation);
        this.applyRemoteBoatGhostAppearance(boatData.sprite, data.isGhost ?? false);
        const displayName = data.name && data.name.length <= MAX_PLAYER_NAME_LENGTH ? data.name : shortId(playerId);
        boatData.nameLabel.setText(displayName);
        boatData.nameLabel.setPosition(data.x, data.y - 50);
        const lifeRatio = (data.life ?? MAX_LIFE) / MAX_LIFE;
        boatData.lifeBar?.clear();
        if (boatData.lifeBar) {
          this.drawBar(boatData.lifeBar, data.x - 25, data.y - 65, 50, 6, 0x333333, 0xff0000, lifeRatio);
        }
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
      this.moveTargetX = this.clampToWorldBounds(worldPoint.x);
      this.moveTargetY = this.clampToWorldBounds(worldPoint.y);
      return;
    }
    if (pointer.button === 0) {
      this.handleLeftClick(worldPoint.x, worldPoint.y);
    }
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
    this.boat.rotation = Phaser.Math.Angle.Between(
      this.boat.x,
      this.boat.y,
      this.moveTargetX,
      this.moveTargetY
    );
  }

  private clampToWorldBounds(value: number): number {
    return Phaser.Math.Clamp(value, -WORLD_SIZE + WORLD_MARGIN, WORLD_SIZE - WORLD_MARGIN);
  }

  update(): void {
    if (!this.boat || !this.boatNameLabel || !this.lifeBar || !this.experienceBar) return;
    this.boatNameLabel.setPosition(this.boat.x, this.boat.y - 50);
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

    if (this.authoritativeGameServer && this.boat) {
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

      if (this.hudSyncedFromServer && boat && !me.isGhost) {
        if (newScore > oldScore && newScore - oldScore <= SCORE_DELTA_PRAT_PICKUP_MAX) {
          this.spawnPratPickupBurst(boat.x, boat.y, false);
        }
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
      this.scoreText.setText(`Prat capturés: ${this.pratsCaptured}`);
      this.localIsGhost = me.isGhost ?? false;
      this.syncedGhostPratsCaptured = me.ghostPratsCaptured ?? 0;
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
      if (wasGhost !== this.localIsGhost) {
        setBackgroundMusicForGhostMode(this.registry, this.localIsGhost);
      }
      if (wasGhost !== this.localIsGhost || prevGhostPrats !== this.syncedGhostPratsCaptured) {
        void this.savePlayer();
      }
      if (this.level > previousLevel) {
        void this.savePlayer();
        this.showLevelUpMessage(this.level);
      }

      if (boat) {
        const serverX = simulationToPhaserPixels(me.x);
        const serverY = simulationToPhaserPixels(me.y);
        const dist = Phaser.Math.Distance.Between(boat.x, boat.y, serverX, serverY);
        if (dist > simulationToPhaserPixels(120)) {
          boat.setPosition(serverX, serverY);
        }
        this.applyLocalBoatGhostVisual(boat, me.isGhost ?? false);
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

  private applyServerProjectilesState(state: SerializableGameState): void {
    try {
      const seen = new Set<string>();
      for (const [id, projectile] of Object.entries(state.projectiles)) {
        seen.add(id);
        const fromOctopus = projectile.shooterId.startsWith("octopus:");
        const fontSize = fromOctopus ? "24px" : "28px";
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
    if (!this.textures.exists("stingray")) return;
    if (!this.stingraysEnabled) {
      for (const stingray of this.stingrays.values()) {
        stingray.sprite.destroy();
        stingray.lifeBar.destroy();
      }
      this.stingrays.clear();
      return;
    }
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
    if (!this.textures.exists("octopus")) return;
    if (!this.octopusesEnabled) {
      for (const octopus of this.octopuses.values()) {
        octopus.sprite.destroy();
        octopus.lifeBar.destroy();
      }
      this.octopuses.clear();
      return;
    }
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

  private checkPratCapture(): void {
    const boatX = this.boat.x;
    const boatY = this.boat.y;

    for (const [pratId, entity] of this.pratEntities) {
      if (this.pratCaptureRequestSent.has(pratId)) continue;

      const distance = Phaser.Math.Distance.Between(boatX, boatY, entity.text.x, entity.text.y);

      if (distance < PRAT_CAPTURE_RADIUS_PIXELS) {
        this.pratCaptureRequestSent.add(pratId);
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
