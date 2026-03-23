import Phaser from "phaser";
import { EventBus } from "../EventBus";
import { MultiplayerManager, type RemotePlayer } from "../multiplayer/MultiplayerManager";
import type { PratState, SerializableGameState } from "@/lib/gameTypes";
import {
  getLevelFromExperience,
  MAX_LIFE,
  PRAT_CAPTURE_RADIUS,
  XP_BASE_FOR_LEVEL_2,
  XP_MULTIPLIER_PER_LEVEL,
} from "@/lib/gameBalance";
import { playerIdToColor } from "@/lib/playerColor";
import { getPlayerByName, upsertPlayer } from "@/lib/players";
import { MAX_PLAYER_NAME_LENGTH, VIEW_HEIGHT, VIEW_WIDTH } from "../config";

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

const WORLD_SIZE = 2000;
const WORLD_MARGIN = 50;
const SEA_TILE_SIZE = 2000;
const OCTOPUS_LIFE = 80;
const STINGRAY_LIFE = 60;
const BAR_LABEL_WIDTH = 70;
const BAR_X = 20 + BAR_LABEL_WIDTH;
/** Max score delta treated as a single prat pickup (avoid full-screen burst on unrelated updates). */
const SCORE_DELTA_PRAT_PICKUP_MAX = 4;
function shortId(uuid: string): string {
  return uuid.slice(0, 8);
}

function getExperienceProgressForCurrentLevel(totalExperience: number): { current: number; needed: number } {
  const level = getLevelFromExperience(totalExperience);
  const cumulativeForCurrentLevel =
    level <= 1 ? 0 : XP_BASE_FOR_LEVEL_2 * (Math.pow(XP_MULTIPLIER_PER_LEVEL, level - 1) - 1);
  const xpInCurrentLevel = totalExperience - cumulativeForCurrentLevel;
  const xpNeededForNextLevel = XP_BASE_FOR_LEVEL_2 * Math.pow(XP_MULTIPLIER_PER_LEVEL, level - 1);
  return { current: xpInCurrentLevel, needed: xpNeededForNextLevel };
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
  private readonly moveArrivalThreshold = 15;
  private pratEntities = new Map<string, PratEntity>();
  private pratCaptureRequestSent = new Set<string>();
  private score: number = 0;
  private scoreText!: Phaser.GameObjects.Text;
  private readonly boatSpeed = 200;
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
  private processedDamageEventIds = new Set<string>();
  private stingrays = new Map<string, StingrayEntity>();
  /** After first SSE snapshot, score delta triggers prat score pickup VFX (heal uses negative damage events). */
  private hudSyncedFromServer = false;

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
          return { x: 400, y: 300, rotation: 0, score: this.score, life: this.life, level: this.level, name: this.playerName ?? undefined };
        }
        return {
          x: this.boat.x,
          y: this.boat.y,
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
    if (this.playerName) {
      const existingPlayer = await getPlayerByName(this.playerName);
      if (existingPlayer) {
        this.experience = existingPlayer.exp;
        this.level = existingPlayer.level;
        this.killsOctopus = existingPlayer.kills_octopus;
        this.killsStingray = existingPlayer.kills_stingray;
      } else {
        const created = await upsertPlayer({
          name: this.playerName ?? undefined,
          exp: 0,
          level: 1,
          kills_octopus: 0,
          kills_stingray: 0,
        });
        if (!created) {
          console.warn("Failed to create player in database");
        }
      }
    }

    void this.multiplayer.sendGameInput({
      type: "SYNC_PROFILE",
      timestamp: Date.now(),
      experience: this.experience,
      killsOctopus: this.killsOctopus,
      killsStingray: this.killsStingray,
    });

    this.boat = this.physics.add.sprite(0, 0, "boat");
    this.boat.setCollideWorldBounds(true);
    this.boat.setScale(0.5);

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

    const statusText = this.add
      .text(0, 0, "", {
        fontSize: "14px",
        color: "#333",
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setName("multiplayer-status");
    statusText.setPosition(this.scale.width - 20, 20);

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
      .text(BAR_X + barWidth + 10, experienceY + barHeight / 2, "Niv. 1", { fontSize: "12px", color: "#000" })
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
    this.savePlayer();
    this.input.off("pointerdown", this.onPointerDown, this);
    this.scale.off("resize", this.updateCameraZoom, this);
    for (const text of this.serverProjectileSprites.values()) {
      text.destroy();
    }
    this.serverProjectileSprites.clear();
    this.processedEliminationIds.clear();
    this.processedDamageEventIds.clear();
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
  }

  private updateMultiplayerStatus(): void {
    const statusText = this.children.getByName("multiplayer-status") as Phaser.GameObjects.Text;
    if (statusText) {
      statusText.setText(this.multiplayer.isActive() ? "Multijoueur actif" : "Solo");
      statusText.setPosition(this.scale.width - 20, 20);
    }
  }

  private updateRemoteBoats(players: Map<string, { id: string; name?: string; x: number; y: number; rotation: number; life: number }>): void {
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
    const targetBoat = this.remoteBoats.get(targetPlayerId);
    if (!targetBoat) return;

    const startX = this.boat.x;
    const startY = this.boat.y;
    const ts = Date.now();
    void this.multiplayer.sendGameInput({
      type: "SHOOT",
      timestamp: ts,
      startX,
      startY,
      targetX: targetBoat.sprite.x,
      targetY: targetBoat.sprite.y,
    });
  }

  private fireLettersAtPosition(worldX: number, worldY: number): void {
    const startX = this.boat.x;
    const startY = this.boat.y;
    const ts = Date.now();
    void this.multiplayer.sendGameInput({
      type: "SHOOT",
      timestamp: ts,
      startX,
      startY,
      targetX: worldX,
      targetY: worldY,
    });
  }

  private fireLettersAtOctopus(octopusId: string): void {
    if (!this.octopuses.has(octopusId)) return;

    const octopus = this.octopuses.get(octopusId);
    if (!octopus) return;

    const ts = Date.now();
    void this.multiplayer.sendGameInput({
      type: "SHOOT",
      timestamp: ts,
      startX: this.boat.x,
      startY: this.boat.y,
      targetX: octopus.sprite.x,
      targetY: octopus.sprite.y,
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
    const clickRadius = 60;
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
    if (!this.boat || !this.boatNameLabel) return;
    this.boatNameLabel.setPosition(this.boat.x, this.boat.y - 50);
    this.sea.setPosition(this.boat.x, this.boat.y);
    this.sea.tilePositionX = this.boat.x;
    this.sea.tilePositionY = this.boat.y;

    const barWidth = 200;
    const barHeight = 14;
    const lifeY = this.scale.height - 55;
    const experienceY = this.scale.height - 35;
    this.drawBar(this.lifeBar, BAR_X, lifeY, barWidth, barHeight, 0x333333, 0x00ff00, this.life / MAX_LIFE);
    const { current: xpCurrent, needed: xpNeeded } = getExperienceProgressForCurrentLevel(this.experience);
    this.drawBar(this.experienceBar, BAR_X, experienceY, barWidth, barHeight, 0x333333, 0x9b59b6, xpCurrent / xpNeeded);
    const levelText = this.children.getByName("level-text") as Phaser.GameObjects.Text;
    if (levelText) levelText.setText(`Niv. ${this.level}`);

    if (this.authoritativeGameServer && this.boat) {
      const now = Date.now();
      if (now - this.lastMoveInputSentAt >= this.serverMoveThrottleMs) {
        this.lastMoveInputSentAt = now;
        void this.multiplayer.sendGameInput({
          type: "MOVE",
          timestamp: now,
          x: this.boat.x,
          y: this.boat.y,
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

      if (this.hudSyncedFromServer && boat) {
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
      this.scoreText.setText(`Prat capturés: ${this.score}`);
      if (this.level > previousLevel) {
        this.savePlayer();
        this.showLevelUpMessage(this.level);
      }
    }

    const playersFromServer = new Map<string, RemotePlayer>();
    for (const [playerId, playerData] of Object.entries(state.players ?? {})) {
      if (playerId === localPlayerId) continue;
      playersFromServer.set(playerId, {
        id: playerId,
        name: playerData.name,
        x: playerData.x,
        y: playerData.y,
        rotation: playerData.rotation,
        score: playerData.score ?? 0,
        life: playerData.life ?? MAX_LIFE,
        level: playerData.level ?? 1,
        color: playerData.color ?? playerIdToColor(playerId),
      });
    }
    this.updateRemoteBoats(playersFromServer);
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
    let entity = this.pratEntities.get(id);
    if (!entity) {
      const text = this.add.text(prat.x, prat.y, prat.word, {
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
    entity.text.setPosition(prat.x, prat.y);
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
        let text = this.serverProjectileSprites.get(id);
        if (!text) {
          text = this.add.text(projectile.x, projectile.y, projectile.letter, {
            fontSize,
            fontStyle: "bold",
            color: "#000000",
          });
          text.setOrigin(0.5);
          text.setDepth(8);
          this.serverProjectileSprites.set(id, text);
        } else {
          text.setPosition(projectile.x, projectile.y);
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

    for (const event of state.damageEvents ?? []) {
      if (this.processedDamageEventIds.has(event.id)) continue;
      if (event.targetPlayerId !== localId) {
        this.processedDamageEventIds.add(event.id);
        continue;
      }
      // Same coordinate fallback as prat pickup bursts (boat + server); avoid skipping the event
      // when one source is missing (would drop one-shot damageEvents forever).
      const worldX = this.boat?.x ?? localFromState?.x ?? 0;
      const worldY = this.boat?.y ?? localFromState?.y ?? 0;
      this.processedDamageEventIds.add(event.id);
      const damageAmount = Number(event.damage);
      if (damageAmount > 0) {
        this.spawnDamageBurst(worldX, worldY, damageAmount);
      } else if (damageAmount < 0) {
        this.spawnPratPickupBurst(worldX, worldY, true);
      }
    }
    this.trimStringIdSet(this.processedDamageEventIds, maxTracked);

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
        let entity = this.stingrays.get(id);
        if (!entity) {
          const sprite = this.add.image(ray.x, ray.y, "stingray");
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
          const previousLife = entity.life;
          entity.sprite.setPosition(ray.x, ray.y);
          if (ray.life < previousLife) {
            this.spawnDamageBurst(ray.x, ray.y, previousLife - ray.life);
          }
          entity.life = ray.life;
          entity.baseY = ray.baseY;
          entity.spawnTime = ray.spawnTime;
        }
        const maxLife = ray.maxLife > 0 ? ray.maxLife : STINGRAY_LIFE;
        const lifeRatio = ray.life / maxLife;
        entity.lifeBar.clear();
        this.drawBar(entity.lifeBar, ray.x - 20, ray.y - 35, 40, 5, 0x333333, 0xff6600, lifeRatio);
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

        let entity = this.octopuses.get(id);
        if (!entity) {
          const sprite = this.add.image(enemy.x, enemy.y, "octopus");
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
          const previousLife = entity.life;
          entity.sprite.setPosition(enemy.x, enemy.y);
          if (enemy.life < previousLife) {
            this.spawnDamageBurst(enemy.x, enemy.y, previousLife - enemy.life);
          }
          entity.life = enemy.life;
          entity.lastShotTime = enemy.lastShotTime;
          entity.spawnTime = enemy.spawnTime;
        }

        const maxLife = enemy.maxLife > 0 ? enemy.maxLife : OCTOPUS_LIFE;
        const lifeRatio = enemy.life / maxLife;
        entity.lifeBar.clear();
        this.drawBar(entity.lifeBar, enemy.x - 25, enemy.y - 50, 50, 6, 0x333333, 0xff0000, lifeRatio);
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

      if (distance < PRAT_CAPTURE_RADIUS) {
        this.pratCaptureRequestSent.add(pratId);
        void this.multiplayer.sendGameInput({
          type: "PRAT_CAPTURE",
          timestamp: Date.now(),
          pratId,
          x: boatX,
          y: boatY,
        });
      }
    }
  }
}
