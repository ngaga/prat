import Phaser from "phaser";
import { EventBus } from "../EventBus";
import {
  MultiplayerManager,
  type PlayerShotPayload,
} from "../multiplayer/MultiplayerManager";
import { upsertPlayer } from "@/lib/players";
import { VIEW_HEIGHT, VIEW_WIDTH } from "../config";

interface PratEntity {
  id: string;
  text: Phaser.GameObjects.Text;
  power: number;
  captured: boolean;
  healAmount?: number;
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

interface LetterProjectile {
  text: Phaser.GameObjects.Text;
  targetPlayerId: string | null;
  targetOctopusId: string | null;
  damage: number;
  speed: number;
  directionX: number;
  directionY: number;
  originX: number;
  originY: number;
}

const WORLD_SIZE = 2000;
const WORLD_MARGIN = 50;
const SEA_TILE_SIZE = 2000;
const PRAT_SPAWN_INTERVAL_MS = 800;
const PRAT_SPAWN_RADIUS = 600;
const MAX_PRATS = 80;
const CAPTURE_FLASH_COLOR = 0x000000;
const MAX_LIFE = 100;
const XP_PER_PRAT = 1;
const XP_PER_OCTOPUS_OR_STINGRAY = 100;
const XP_BASE_FOR_LEVEL_2 = 1000;
const XP_MULTIPLIER_PER_LEVEL = 2;
const XP_PER_PLAYER_LEVEL = 50;
const HEAL_LETTER_PROBABILITY = 0.1;
const HEAL_PERCENT_OF_MAX = 0.1;
const LETTER_DAMAGE = 10;
const LETTER_SPEED = 400;
const PRAT_LETTERS = ["P", "R", "A", "T"];
const OCTOPUS_LIFE = 80;
const OCTOPUS_DAMAGE = 4;
const OCTOPUS_LIFETIME_MS = 20000;
const OCTOPUS_SHOOT_DELAY_MS = 5000;
const OCTOPUS_SHOOT_INTERVAL_MS = 3000;
const OCTOPUS_SPAWN_CHECK_INTERVAL_MS = 3000;
const OCTOPUS_SPAWN_PROBABILITY = 1 / 3;
const STINGRAY_LIFE = 60;
const STINGRAY_SPEED = 80;
const STINGRAY_AMPLITUDE = 25;
const STINGRAY_WAVE_FREQUENCY = 0.5;
const STINGRAY_SPAWN_INTERVAL_MS = 4000;
const PROJECTILE_MAX_RANGE = Math.sqrt(VIEW_WIDTH ** 2 + VIEW_HEIGHT ** 2) / 2;
const BAR_LABEL_WIDTH = 70;
const BAR_X = 20 + BAR_LABEL_WIDTH;
function shortId(uuid: string): string {
  return uuid.slice(0, 8);
}

function getLevelFromExperience(totalExperience: number): number {
  if (totalExperience < XP_BASE_FOR_LEVEL_2) return 1;
  return Math.floor(Math.log2(totalExperience / XP_BASE_FOR_LEVEL_2 + 1)) + 1;
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
  private pratEntities: PratEntity[] = [];
  private score: number = 0;
  private scoreText!: Phaser.GameObjects.Text;
  private readonly boatSpeed = 200;
  private readonly captureRadius = 80;
  private multiplayer!: MultiplayerManager;
  private remoteBoats = new Map<string, RemoteBoatData>();
  private isSceneActive = true;
  private pratSpawnTimer: ReturnType<typeof setInterval> | null = null;
  private nextPratId = 0;
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
  private letterProjectiles: LetterProjectile[] = [];
  private remoteProjectiles: LetterProjectile[] = [];
  private octopuses = new Map<string, OctopusEntity>();
  private enemyProjectiles: LetterProjectile[] = [];
  private nextOctopusId = 0;
  private octopusesEnabled = true;
  private lastOctopusSpawnCheckTime = 0;
  private stingrays = new Map<string, StingrayEntity>();
  private nextStingrayId = 0;
  private lastStingraySpawnTime = 0;

  constructor() {
    super({ key: "GameScene" });
  }

  init(data: { octopusesEnabled?: boolean; playerName?: string }): void {
    this.octopusesEnabled = data?.octopusesEnabled ?? true;
    this.playerName = data?.playerName ?? null;
  }

  create(): void {
    this.physics.world.setBounds(-WORLD_SIZE, -WORLD_SIZE, WORLD_SIZE * 2, WORLD_SIZE * 2);

    this.sea = this.add.tileSprite(0, 0, SEA_TILE_SIZE, SEA_TILE_SIZE, "sea");
    this.sea.setOrigin(0.5);

    this.createWorldBorders();
    if (this.octopusesEnabled) {
      this.lastOctopusSpawnCheckTime = Date.now();
    }
    this.lastStingraySpawnTime = Date.now();

    this.input.on("pointerdown", this.onPointerDown, this);
    this.game.canvas.addEventListener("contextmenu", (event) => event.preventDefault());

    this.multiplayer = new MultiplayerManager({
      onRemotePlayerUpdate: (players) => {
        if (!this.isSceneActive) return;
        this.updateRemoteBoats(players);
      },
      onPratCaptured: () => {},
      onPlayerHit: (payload) => {
        if (payload.targetId === this.multiplayer.getPlayerId()) {
          const previousLife = this.life;
          this.life = Math.max(0, this.life - payload.damage);
          if (previousLife > 0 && this.life <= 0) {
            this.multiplayer.broadcastPlayerEliminated(payload.attackerId, this.multiplayer.getPlayerId(), this.level);
          }
        }
      },
      onPlayerEliminated: (payload) => {
        if (payload.attackerId === this.multiplayer.getPlayerId()) {
          this.addExperience(payload.victimLevel * XP_PER_PLAYER_LEVEL);
        }
      },
      onPlayerShot: (payload) => {
        if (!this.isSceneActive) return;
        this.spawnRemoteProjectiles(payload);
      },
      onConnected: () => {
        if (!this.isSceneActive) return;
        this.updateMultiplayerStatus();
      },
      getLocalState: () => ({
        x: this.boat.x,
        y: this.boat.y,
        rotation: this.boat.rotation,
        score: this.score,
        life: this.life,
        level: this.level,
      }),
    });
    this.multiplayer.connect();
    if (!this.playerName) {
      this.playerName = this.multiplayer.getPlayerId();
    }

    this.boat = this.physics.add.sprite(0, 0, "boat");
    this.boat.setCollideWorldBounds(true);
    this.boat.setScale(0.5);

    this.boatNameLabel = this.add
      .text(0, -50, shortId(this.multiplayer.getPlayerId()), {
        fontSize: "12px",
        color: "#000",
      })
      .setOrigin(0.5);

    this.cameras.main.startFollow(this.boat, true, 0.1, 0.1);
    this.cameras.main.setBounds(-WORLD_SIZE, -WORLD_SIZE, WORLD_SIZE * 2, WORLD_SIZE * 2);
    this.updateCameraZoom();
    this.scale.on("resize", this.updateCameraZoom, this);

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

    this.spawnInitialPrats();
    this.startPratRespawn();

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

  private addExperience(amount: number): void {
    const previousLevel = this.level;
    this.experience += amount;
    this.level = getLevelFromExperience(this.experience);
    if (this.level > previousLevel) {
      this.savePlayer();
      const levelUpText = this.add
        .text(this.scale.width / 2, this.scale.height / 2 - 50, `Niveau ${this.level} !`, {
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
    for (const projectile of this.letterProjectiles) {
      projectile.text.destroy();
    }
    this.letterProjectiles = [];
    for (const projectile of this.remoteProjectiles) {
      projectile.text.destroy();
    }
    this.remoteProjectiles = [];
    for (const projectile of this.enemyProjectiles) {
      projectile.text.destroy();
    }
    this.enemyProjectiles = [];
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
    if (this.pratSpawnTimer) {
      clearInterval(this.pratSpawnTimer);
      this.pratSpawnTimer = null;
    }
    this.multiplayer.disconnect();
  }

  private updateMultiplayerStatus(): void {
    const statusText = this.children.getByName("multiplayer-status") as Phaser.GameObjects.Text;
    if (statusText) {
      statusText.setText(this.multiplayer.isActive() ? "Multijoueur actif" : "Solo");
      statusText.setPosition(this.scale.width - 20, 20);
    }
  }

  private updateRemoteBoats(players: Map<string, { id: string; x: number; y: number; rotation: number; life: number }>): void {
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
          const nameLabel = this.add
            .text(data.x, data.y - 50, shortId(playerId), {
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
    const direction = normalizeDirection(
      startX,
      startY,
      targetBoat.sprite.x,
      targetBoat.sprite.y
    );

    PRAT_LETTERS.forEach((letter, index) => {
      this.time.delayedCall(index * 80, () => {
        if (!this.isSceneActive) return;
        const text = this.add.text(startX, startY, letter, {
          fontSize: "28px",
          fontStyle: "bold",
          color: "#000000",
        });
        text.setOrigin(0.5);
        text.setDepth(8);

        this.letterProjectiles.push({
          text,
          targetPlayerId,
          targetOctopusId: null,
          damage: LETTER_DAMAGE,
          speed: LETTER_SPEED,
          directionX: direction.x,
          directionY: direction.y,
          originX: startX,
          originY: startY,
        });
      });
    });

    this.multiplayer.broadcastPlayerShot(
      targetPlayerId,
      startX,
      startY,
      direction.x,
      direction.y
    );
  }

  private spawnRemoteProjectiles(payload: PlayerShotPayload): void {
    PRAT_LETTERS.forEach((letter, index) => {
      this.time.delayedCall(index * 80, () => {
        if (!this.isSceneActive) return;
        const text = this.add.text(payload.startX, payload.startY, letter, {
          fontSize: "28px",
          fontStyle: "bold",
          color: "#000000",
        });
        text.setOrigin(0.5);
        text.setDepth(8);

        this.remoteProjectiles.push({
          text,
          targetPlayerId: payload.targetId || null,
          targetOctopusId: null,
          damage: LETTER_DAMAGE,
          speed: LETTER_SPEED,
          directionX: payload.directionX,
          directionY: payload.directionY,
          originX: payload.startX,
          originY: payload.startY,
        });
      });
    });
  }

  private fireLettersAtPosition(worldX: number, worldY: number): void {
    const startX = this.boat.x;
    const startY = this.boat.y;
    const direction = normalizeDirection(startX, startY, worldX, worldY);

    PRAT_LETTERS.forEach((letter, index) => {
      this.time.delayedCall(index * 80, () => {
        if (!this.isSceneActive) return;
        const text = this.add.text(startX, startY, letter, {
          fontSize: "28px",
          fontStyle: "bold",
          color: "#000000",
        });
        text.setOrigin(0.5);
        text.setDepth(8);

        this.letterProjectiles.push({
          text,
          targetPlayerId: null,
          targetOctopusId: null,
          damage: LETTER_DAMAGE,
          speed: LETTER_SPEED,
          directionX: direction.x,
          directionY: direction.y,
          originX: startX,
          originY: startY,
        });
      });
    });

    this.multiplayer.broadcastPlayerShot("", startX, startY, direction.x, direction.y);
  }

  private fireLettersAtOctopus(octopusId: string): void {
    if (!this.octopuses.has(octopusId)) return;

    const startX = this.boat.x;
    const startY = this.boat.y;
    const octopus = this.octopuses.get(octopusId);
    if (!octopus) return;
    const direction = normalizeDirection(
      startX,
      startY,
      octopus.sprite.x,
      octopus.sprite.y
    );

    PRAT_LETTERS.forEach((letter, index) => {
      this.time.delayedCall(index * 80, () => {
        if (!this.isSceneActive) return;
        const text = this.add.text(startX, startY, letter, {
          fontSize: "28px",
          fontStyle: "bold",
          color: "#000000",
        });
        text.setOrigin(0.5);
        text.setDepth(8);

        this.letterProjectiles.push({
          text,
          targetPlayerId: null,
          targetOctopusId: octopusId,
          damage: LETTER_DAMAGE,
          speed: LETTER_SPEED,
          directionX: direction.x,
          directionY: direction.y,
          originX: startX,
          originY: startY,
        });
      });
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
    for (const [octopusId, octopus] of this.octopuses) {
      const distance = Phaser.Math.Distance.Between(worldX, worldY, octopus.sprite.x, octopus.sprite.y);
      if (distance < clickRadius) {
        this.fireLettersAtOctopus(octopusId);
        return;
      }
    }
    for (const [, stingray] of this.stingrays) {
      const distance = Phaser.Math.Distance.Between(worldX, worldY, stingray.sprite.x, stingray.sprite.y);
      if (distance < clickRadius) {
        this.fireLettersAtPosition(stingray.sprite.x, stingray.sprite.y);
        return;
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

  private spawnPratNearBoat(): void {
    for (let count = 0; count < 3; count++) {
      const activeCount = this.pratEntities.filter((entity) => !entity.captured).length;
      if (activeCount >= MAX_PRATS) return;
      const angle = Math.random() * Math.PI * 2;
      const distance = PRAT_SPAWN_RADIUS + Math.random() * 400;
      const x = this.clampToWorldBounds(this.boat.x + Math.cos(angle) * distance);
      const y = this.clampToWorldBounds(this.boat.y + Math.sin(angle) * distance);
      this.spawnPratAt(x, y);
    }
  }

  private spawnPratAt(x: number, y: number): void {
    const isHealLetter = Math.random() < HEAL_LETTER_PROBABILITY;

    if (isHealLetter) {
      const size = 28;
      const id = `prat-${this.nextPratId++}`;
      const text = this.add.text(x, y, "A", {
        fontSize: `${size}px`,
        fontStyle: "bold",
        color: "#00aa00",
      });
      text.setOrigin(0.5);

      this.pratEntities.push({
        id,
        text,
        power: 0,
        captured: false,
        healAmount: Math.floor(MAX_LIFE * HEAL_PERCENT_OF_MAX),
      });
      return;
    }

    const pratWords = ["prat", "PRAT", "prat", "PrAt", "prat"];
    const styles = [
      { fontStyle: "normal", power: 1 },
      { fontStyle: "bold", power: 2 },
      { fontStyle: "italic", power: 2 },
      { fontStyle: "bold italic", power: 3 },
    ];
    const style = styles[Math.floor(Math.random() * styles.length)];
    const word = pratWords[Math.floor(Math.random() * pratWords.length)];
    const size = 20 + Math.floor(Math.random() * 24);

    const id = `prat-${this.nextPratId++}`;
    const text = this.add.text(x, y, word, {
      fontSize: `${size}px`,
      fontStyle: style.fontStyle,
      color: "#000000",
    });
    text.setOrigin(0.5);

    this.pratEntities.push({
      id,
      text,
      power: style.power,
      captured: false,
    });
  }

  private spawnInitialPrats(): void {
    const min = -WORLD_SIZE + WORLD_MARGIN;
    const max = WORLD_SIZE - WORLD_MARGIN;
    for (let index = 0; index < 40; index++) {
      const x = Phaser.Math.Between(min, max);
      const y = Phaser.Math.Between(min, max);
      this.spawnPratAt(x, y);
    }
  }

  private startPratRespawn(): void {
    this.pratSpawnTimer = setInterval(() => {
      if (this.isSceneActive) {
        this.spawnPratNearBoat();
      }
    }, PRAT_SPAWN_INTERVAL_MS);
  }

  update(): void {
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

    this.updateLetterProjectiles();
    this.updateRemoteProjectiles();
    this.updateEnemyProjectiles();
    if (this.octopusesEnabled) {
      this.updateOctopuses();
    }
    this.updateStingrays();
    this.updateBoatMovement();

    this.checkPratCapture();
  }

  private getProjectileTargetPosition(projectile: LetterProjectile): { x: number; y: number } | null {
    if (projectile.targetPlayerId) {
      const targetBoat = this.remoteBoats.get(projectile.targetPlayerId);
      return targetBoat ? { x: targetBoat.sprite.x, y: targetBoat.sprite.y } : null;
    }
    if (projectile.targetOctopusId) {
      const octopus = this.octopuses.get(projectile.targetOctopusId);
      return octopus ? { x: octopus.sprite.x, y: octopus.sprite.y } : null;
    }
    return null;
  }

  private updateLetterProjectiles(): void {
    const hitThreshold = 40;
    for (let index = this.letterProjectiles.length - 1; index >= 0; index--) {
      const projectile = this.letterProjectiles[index];
      const traveled = Phaser.Math.Distance.Between(
        projectile.originX,
        projectile.originY,
        projectile.text.x,
        projectile.text.y
      );
      if (traveled >= PROJECTILE_MAX_RANGE) {
        projectile.text.destroy();
        this.letterProjectiles.splice(index, 1);
        continue;
      }
      const target = this.getProjectileTargetPosition(projectile);
      let hitTarget: { x: number; y: number; playerId?: string; octopusId?: string; stingrayId?: string } | null = null;
      if (target) {
        const distanceToTarget = Phaser.Math.Distance.Between(
          projectile.text.x,
          projectile.text.y,
          target.x,
          target.y
        );
        if (distanceToTarget < hitThreshold) {
          hitTarget = {
            x: target.x,
            y: target.y,
            playerId: projectile.targetPlayerId ?? undefined,
            octopusId: projectile.targetOctopusId ?? undefined,
          };
        }
      } else {
        for (const [playerId, boatData] of this.remoteBoats) {
          const distance = Phaser.Math.Distance.Between(
            projectile.text.x,
            projectile.text.y,
            boatData.sprite.x,
            boatData.sprite.y
          );
          if (distance < hitThreshold) {
            hitTarget = { x: boatData.sprite.x, y: boatData.sprite.y, playerId };
            break;
          }
        }
        if (!hitTarget) {
          for (const [octopusId, octopus] of this.octopuses) {
            const distance = Phaser.Math.Distance.Between(
              projectile.text.x,
              projectile.text.y,
              octopus.sprite.x,
              octopus.sprite.y
            );
            if (distance < hitThreshold) {
              hitTarget = { x: octopus.sprite.x, y: octopus.sprite.y, octopusId };
              break;
            }
          }
        }
        if (!hitTarget) {
          for (const [stingrayId, stingray] of this.stingrays) {
            const distance = Phaser.Math.Distance.Between(
              projectile.text.x,
              projectile.text.y,
              stingray.sprite.x,
              stingray.sprite.y
            );
            if (distance < hitThreshold) {
              hitTarget = { x: stingray.sprite.x, y: stingray.sprite.y, stingrayId };
              break;
            }
          }
        }
      }
      if (hitTarget) {
        if (hitTarget.playerId) {
          this.multiplayer.broadcastPlayerHit(hitTarget.playerId, projectile.damage);
        } else if (hitTarget.octopusId) {
          const octopus = this.octopuses.get(hitTarget.octopusId);
          if (octopus) {
            octopus.life -= projectile.damage;
            if (octopus.life <= 0) {
              this.killsOctopus++;
              this.addExperience(XP_PER_OCTOPUS_OR_STINGRAY);
              octopus.sprite.destroy();
              octopus.lifeBar.destroy();
              this.octopuses.delete(hitTarget.octopusId);
            }
          }
        } else if (hitTarget.stingrayId) {
          const stingray = this.stingrays.get(hitTarget.stingrayId);
          if (stingray) {
            stingray.life -= projectile.damage;
            if (stingray.life <= 0) {
              this.killsStingray++;
              this.addExperience(XP_PER_OCTOPUS_OR_STINGRAY);
              stingray.sprite.destroy();
              stingray.lifeBar.destroy();
              this.stingrays.delete(hitTarget.stingrayId);
            }
          }
        }
        const flash = this.add.circle(hitTarget.x, hitTarget.y, 30, CAPTURE_FLASH_COLOR, 0.5);
        flash.setDepth(4);
        this.tweens.add({
          targets: flash,
          alpha: 0,
          scale: 2,
          duration: 200,
          onComplete: () => flash.destroy(),
        });
        projectile.text.destroy();
        this.letterProjectiles.splice(index, 1);
        continue;
      }
      const speed = (projectile.speed * this.game.loop.delta) / 1000;
      projectile.text.x += projectile.directionX * speed;
      projectile.text.y += projectile.directionY * speed;
    }
  }

  private updateRemoteProjectiles(): void {
    const hitThreshold = 40;
    for (let index = this.remoteProjectiles.length - 1; index >= 0; index--) {
      const projectile = this.remoteProjectiles[index];
      const traveled = Phaser.Math.Distance.Between(
        projectile.originX,
        projectile.originY,
        projectile.text.x,
        projectile.text.y
      );
      if (traveled >= PROJECTILE_MAX_RANGE) {
        projectile.text.destroy();
        this.remoteProjectiles.splice(index, 1);
        continue;
      }
      let targetX: number | null = null;
      let targetY: number | null = null;
      if (projectile.targetPlayerId === this.multiplayer.getPlayerId()) {
        targetX = this.boat.x;
        targetY = this.boat.y;
      } else {
        const targetBoat = this.remoteBoats.get(projectile.targetPlayerId!);
        if (targetBoat) {
          targetX = targetBoat.sprite.x;
          targetY = targetBoat.sprite.y;
        }
      }
      if (targetX !== null && targetY !== null) {
        const distanceToTarget = Phaser.Math.Distance.Between(
          projectile.text.x,
          projectile.text.y,
          targetX,
          targetY
        );
        if (distanceToTarget < hitThreshold) {
          const flash = this.add.circle(targetX, targetY, 30, CAPTURE_FLASH_COLOR, 0.5);
          flash.setDepth(4);
          this.tweens.add({
            targets: flash,
            alpha: 0,
            scale: 2,
            duration: 200,
            onComplete: () => flash.destroy(),
          });
          projectile.text.destroy();
          this.remoteProjectiles.splice(index, 1);
          continue;
        }
      }
      const speed = (projectile.speed * this.game.loop.delta) / 1000;
      projectile.text.x += projectile.directionX * speed;
      projectile.text.y += projectile.directionY * speed;
    }
  }

  private updateEnemyProjectiles(): void {
    const hitThreshold = 40;
    for (let index = this.enemyProjectiles.length - 1; index >= 0; index--) {
      const projectile = this.enemyProjectiles[index];
      const traveled = Phaser.Math.Distance.Between(
        projectile.originX,
        projectile.originY,
        projectile.text.x,
        projectile.text.y
      );
      if (traveled >= PROJECTILE_MAX_RANGE) {
        projectile.text.destroy();
        this.enemyProjectiles.splice(index, 1);
        continue;
      }
      const targetX = this.boat.x;
      const targetY = this.boat.y;
      const distance = Phaser.Math.Distance.Between(
        projectile.text.x,
        projectile.text.y,
        targetX,
        targetY
      );
      if (distance < hitThreshold) {
        this.life = Math.max(0, this.life - projectile.damage);
        const flash = this.add.circle(targetX, targetY, 30, CAPTURE_FLASH_COLOR, 0.5);
        flash.setDepth(4);
        this.tweens.add({
          targets: flash,
          alpha: 0,
          scale: 2,
          duration: 200,
          onComplete: () => flash.destroy(),
        });
        projectile.text.destroy();
        this.enemyProjectiles.splice(index, 1);
      } else {
        const speed = (projectile.speed * this.game.loop.delta) / 1000;
        projectile.text.x += projectile.directionX * speed;
        projectile.text.y += projectile.directionY * speed;
      }
    }
  }

  private updateCameraZoom(): void {
    const camera = this.cameras.main;
    const zoomX = camera.width / VIEW_WIDTH;
    const zoomY = camera.height / VIEW_HEIGHT;
    camera.setZoom(Math.min(zoomX, zoomY));
  }

  private getVisibleBounds(): { left: number; right: number; top: number; bottom: number } {
    const camera = this.cameras.main;
    const margin = 60;
    return {
      left: camera.scrollX + margin,
      right: camera.scrollX + VIEW_WIDTH - margin,
      top: camera.scrollY + margin,
      bottom: camera.scrollY + VIEW_HEIGHT - margin,
    };
  }

  private isPlayerVisibleToOctopus(octopus: OctopusEntity): boolean {
    const bounds = this.getVisibleBounds();
    return (
      octopus.sprite.x >= bounds.left &&
      octopus.sprite.x <= bounds.right &&
      octopus.sprite.y >= bounds.top &&
      octopus.sprite.y <= bounds.bottom
    );
  }

  private spawnSingleOctopus(): void {
    const id = `octopus-${this.nextOctopusId++}`;
    const bounds = this.getVisibleBounds();
    const minX = Math.max(bounds.left, -WORLD_SIZE + WORLD_MARGIN);
    const maxX = Math.min(bounds.right, WORLD_SIZE - WORLD_MARGIN);
    const minY = Math.max(bounds.top, -WORLD_SIZE + WORLD_MARGIN);
    const maxY = Math.min(bounds.bottom, WORLD_SIZE - WORLD_MARGIN);
    if (minX >= maxX || minY >= maxY) return;
    const x = Phaser.Math.Between(minX, maxX);
    const y = Phaser.Math.Between(minY, maxY);
    const sprite = this.add.image(x, y, "octopus");
    sprite.setScale(0.8);
    sprite.setDepth(5);
    sprite.setInteractive({ useHandCursor: true });
    sprite.setInteractive({ useHandCursor: true });
    const lifeBar = this.add.graphics().setDepth(7);
    this.octopuses.set(id, {
      id,
      sprite,
      lifeBar,
      life: OCTOPUS_LIFE,
      lastShotTime: 0,
      spawnTime: Date.now(),
    });
  }

  private spawnSingleStingray(): void {
    if (!this.textures.exists("stingray")) return;
    const spawnX = -WORLD_SIZE + WORLD_MARGIN;
    const baseY = Phaser.Math.Between(-WORLD_SIZE + WORLD_MARGIN, WORLD_SIZE - WORLD_MARGIN);
    const id = `stingray-${this.nextStingrayId++}`;
    const sprite = this.add.image(spawnX, baseY, "stingray");
    sprite.setScale(1.2);
    sprite.setDepth(4);
    sprite.setInteractive({ useHandCursor: true });
    const lifeBar = this.add.graphics().setDepth(6);
    this.stingrays.set(id, {
      id,
      sprite,
      lifeBar,
      life: STINGRAY_LIFE,
      baseY,
      spawnTime: Date.now(),
    });
  }

  private updateStingrays(): void {
    const now = Date.now();
    const deltaSeconds = this.game.loop.delta / 1000;
    const toRemove: string[] = [];

    if (now - this.lastStingraySpawnTime >= STINGRAY_SPAWN_INTERVAL_MS) {
      this.lastStingraySpawnTime = now;
      this.spawnSingleStingray();
    }

    for (const stingray of this.stingrays.values()) {
      stingray.sprite.x += STINGRAY_SPEED * deltaSeconds;
      const elapsedSeconds = (now - stingray.spawnTime) / 1000;
      stingray.sprite.y =
        stingray.baseY +
        STINGRAY_AMPLITUDE * Math.sin(2 * Math.PI * STINGRAY_WAVE_FREQUENCY * elapsedSeconds);

      const lifeRatio = stingray.life / STINGRAY_LIFE;
      stingray.lifeBar.clear();
      this.drawBar(stingray.lifeBar, stingray.sprite.x - 20, stingray.sprite.y - 35, 40, 5, 0x333333, 0xff6600, lifeRatio);

      if (stingray.sprite.x > WORLD_SIZE + 50 || stingray.life <= 0) {
        toRemove.push(stingray.id);
      }
    }

    for (const id of toRemove) {
      const stingray = this.stingrays.get(id);
      if (stingray) {
        stingray.sprite.destroy();
        stingray.lifeBar.destroy();
        this.stingrays.delete(id);
      }
    }
  }

  private countOctopusesInVisibleArea(): number {
    const bounds = this.getVisibleBounds();
    let count = 0;
    for (const octopus of this.octopuses.values()) {
      if (
        octopus.sprite.x >= bounds.left &&
        octopus.sprite.x <= bounds.right &&
        octopus.sprite.y >= bounds.top &&
        octopus.sprite.y <= bounds.bottom
      ) {
        count++;
      }
    }
    return count;
  }

  private removeOctopus(octopusId: string): void {
    const octopus = this.octopuses.get(octopusId);
    if (octopus) {
      octopus.sprite.destroy();
      octopus.lifeBar.destroy();
      this.octopuses.delete(octopusId);
    }
  }

  private updateOctopuses(): void {
    const now = Date.now();
    const bounds = this.getVisibleBounds();
    const toRemove: string[] = [];

    for (const octopus of this.octopuses.values()) {
      const inView =
        octopus.sprite.x >= bounds.left &&
        octopus.sprite.x <= bounds.right &&
        octopus.sprite.y >= bounds.top &&
        octopus.sprite.y <= bounds.bottom;

      if (!inView || now - octopus.spawnTime >= OCTOPUS_LIFETIME_MS) {
        toRemove.push(octopus.id);
        continue;
      }

      const lifeRatio = octopus.life / OCTOPUS_LIFE;
      octopus.lifeBar.clear();
      this.drawBar(octopus.lifeBar, octopus.sprite.x - 25, octopus.sprite.y - 50, 50, 6, 0x333333, 0xff0000, lifeRatio);

      const canShoot =
        now - octopus.spawnTime >= OCTOPUS_SHOOT_DELAY_MS &&
        now - octopus.lastShotTime >= OCTOPUS_SHOOT_INTERVAL_MS;
      if (canShoot) {
        octopus.lastShotTime = now;
        this.octopusShoot(octopus);
      }
    }

    for (const id of toRemove) {
      this.removeOctopus(id);
    }

    const visibleCount = this.countOctopusesInVisibleArea();
    if (
      visibleCount === 0 &&
      now - this.lastOctopusSpawnCheckTime >= OCTOPUS_SPAWN_CHECK_INTERVAL_MS &&
      Math.random() < OCTOPUS_SPAWN_PROBABILITY
    ) {
      this.lastOctopusSpawnCheckTime = now;
      this.spawnSingleOctopus();
    }
  }

  private octopusShoot(octopus: OctopusEntity): void {
    const startX = octopus.sprite.x;
    const startY = octopus.sprite.y;
    const direction = normalizeDirection(startX, startY, this.boat.x, this.boat.y);

    PRAT_LETTERS.forEach((letter, index) => {
      this.time.delayedCall(index * 80, () => {
        if (!this.isSceneActive || !this.octopuses.has(octopus.id)) return;
        const text = this.add.text(startX, startY, letter, {
          fontSize: "24px",
          fontStyle: "bold",
          color: "#000000",
        });
        text.setOrigin(0.5);
        text.setDepth(8);

        this.enemyProjectiles.push({
          text,
          targetPlayerId: null,
          targetOctopusId: null,
          damage: OCTOPUS_DAMAGE,
          speed: LETTER_SPEED * 0.8,
          directionX: direction.x,
          directionY: direction.y,
          originX: startX,
          originY: startY,
        });
      });
    });
  }

  private checkPratCapture(): void {
    const boatX = this.boat.x;
    const boatY = this.boat.y;

    for (const entity of this.pratEntities) {
      if (entity.captured) continue;

      const distance = Phaser.Math.Distance.Between(
        boatX,
        boatY,
        entity.text.x,
        entity.text.y
      );

      if (distance < this.captureRadius) {
        entity.captured = true;
        if (entity.healAmount != null) {
          this.life = Math.min(MAX_LIFE, this.life + entity.healAmount);
        } else {
          this.score += entity.power;
          this.addExperience(XP_PER_PRAT);
          this.scoreText.setText(`Prat capturés: ${this.score}`);
        }

        const flash = this.add.circle(entity.text.x, entity.text.y, 60, CAPTURE_FLASH_COLOR, 0.5);
        flash.setDepth(4);
        this.tweens.add({
          targets: flash,
          alpha: 0,
          scale: 2,
          duration: 400,
          onComplete: () => flash.destroy(),
        });

        this.tweens.add({
          targets: entity.text,
          alpha: 0,
          scale: 0,
          duration: 300,
          onComplete: () => {
            entity.text.destroy();
          },
        });
      }
    }
  }
}
