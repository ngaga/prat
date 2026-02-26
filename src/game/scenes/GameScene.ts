import Phaser from "phaser";
import { EventBus } from "../EventBus";
import { MultiplayerManager } from "../multiplayer/MultiplayerManager";

interface PratEntity {
  id: string;
  text: Phaser.GameObjects.Text;
  power: number;
  captured: boolean;
}

interface RemoteBoatData {
  sprite: Phaser.GameObjects.Image;
  nameLabel: Phaser.GameObjects.Text;
}

const WORLD_SIZE = 50000;
const SEA_TILE_SIZE = 2000;
const PRAT_SPAWN_INTERVAL_MS = 800;
const PRAT_SPAWN_RADIUS = 600;
const MAX_PRATS = 80;
const CAPTURE_FLASH_COLOR = 0x000000;

function shortId(uuid: string): string {
  return uuid.slice(0, 8);
}

export class GameScene extends Phaser.Scene {
  private boat!: Phaser.Physics.Arcade.Sprite;
  private boatNameLabel!: Phaser.GameObjects.Text;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
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
  private manaBar!: Phaser.GameObjects.Graphics;
  private sea!: Phaser.GameObjects.TileSprite;

  constructor() {
    super({ key: "GameScene" });
  }

  create(): void {
    this.physics.world.setBounds(-WORLD_SIZE, -WORLD_SIZE, WORLD_SIZE * 2, WORLD_SIZE * 2);

    this.sea = this.add.tileSprite(0, 0, SEA_TILE_SIZE, SEA_TILE_SIZE, "sea");
    this.sea.setOrigin(0.5);

    this.cursors = this.input.keyboard!.createCursorKeys();

    this.multiplayer = new MultiplayerManager({
      onRemotePlayerUpdate: (players) => {
        if (!this.isSceneActive) return;
        this.updateRemoteBoats(players);
      },
      onPratCaptured: () => {},
      onConnected: () => {
        if (!this.isSceneActive) return;
        this.updateMultiplayerStatus();
      },
      getLocalState: () => ({
        x: this.boat.x,
        y: this.boat.y,
        rotation: this.boat.rotation,
        score: this.score,
      }),
    });
    this.multiplayer.connect();

    this.boat = this.physics.add.sprite(0, 0, "boat");
    this.boat.setCollideWorldBounds(false);
    this.boat.setScale(0.5);

    this.boatNameLabel = this.add
      .text(0, -50, shortId(this.multiplayer.getPlayerId()), {
        fontSize: "12px",
        color: "#000",
      })
      .setOrigin(0.5);

    this.cameras.main.startFollow(this.boat, true, 0.1, 0.1);
    this.cameras.main.setBounds(-WORLD_SIZE, -WORLD_SIZE, WORLD_SIZE * 2, WORLD_SIZE * 2);

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

    this.createLifeAndManaBars();

    this.spawnInitialPrats();
    this.startPratRespawn();

    this.updateMultiplayerStatus();

    EventBus.emit("current-scene-ready", this);
  }

  private createLifeAndManaBars(): void {
    const barWidth = 200;
    const barHeight = 14;
    const x = 20;
    const lifeY = this.scale.height - 55;
    const manaY = this.scale.height - 35;

    this.lifeBar = this.add.graphics().setScrollFactor(0);
    this.drawBar(this.lifeBar, x, lifeY, barWidth, barHeight, 0x333333, 0x00ff00, 1);

    this.manaBar = this.add.graphics().setScrollFactor(0);
    this.drawBar(this.manaBar, x, manaY, barWidth, barHeight, 0x333333, 0x0066ff, 1);

    this.add
      .text(x, lifeY - 16, "Vie", { fontSize: "12px", color: "#000" })
      .setScrollFactor(0);
    this.add
      .text(x, manaY - 16, "Magie", { fontSize: "12px", color: "#000" })
      .setScrollFactor(0);
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

  private updateRemoteBoats(players: Map<string, { id: string; x: number; y: number; rotation: number }>): void {
    if (!this.isSceneActive || !this.scene?.isActive?.() || !this.add) return;
    try {
      for (const [playerId, data] of players) {
        if (data.x == null || data.y == null) continue;
        let boatData = this.remoteBoats.get(playerId);
        if (!boatData) {
          if (!this.textures.exists("boat")) return;
          const sprite = this.add.image(data.x, data.y, "boat");
          sprite.setScale(0.5);
          sprite.setDepth(5);
          const nameLabel = this.add
            .text(data.x, data.y - 50, shortId(playerId), {
              fontSize: "12px",
              color: "#000",
            })
            .setOrigin(0.5)
            .setDepth(6);
          this.remoteBoats.set(playerId, { sprite, nameLabel });
          boatData = { sprite, nameLabel };
        }
        boatData.sprite.setPosition(data.x, data.y);
        boatData.sprite.setRotation(data.rotation);
        boatData.nameLabel.setPosition(data.x, data.y - 50);
      }
      for (const playerId of this.remoteBoats.keys()) {
        if (!players.has(playerId)) {
          const data = this.remoteBoats.get(playerId);
          data?.sprite.destroy();
          data?.nameLabel.destroy();
          this.remoteBoats.delete(playerId);
        }
      }
    } catch {
      // Scene may be destroyed, ignore
    }
  }

  private spawnPratNearBoat(): void {
    for (let count = 0; count < 3; count++) {
      const activeCount = this.pratEntities.filter((entity) => !entity.captured).length;
      if (activeCount >= MAX_PRATS) return;
      const angle = Math.random() * Math.PI * 2;
      const distance = PRAT_SPAWN_RADIUS + Math.random() * 400;
      const x = this.boat.x + Math.cos(angle) * distance;
      const y = this.boat.y + Math.sin(angle) * distance;
      this.spawnPratAt(x, y);
    }
  }

  private spawnPratAt(x: number, y: number): void {
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
    for (let index = 0; index < 40; index++) {
      const x = Phaser.Math.Between(-2000, 2000);
      const y = Phaser.Math.Between(-2000, 2000);
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

    let velocityX = 0;
    let velocityY = 0;

    if (this.cursors.left.isDown) velocityX = -this.boatSpeed;
    if (this.cursors.right.isDown) velocityX = this.boatSpeed;
    if (this.cursors.up.isDown) velocityY = -this.boatSpeed;
    if (this.cursors.down.isDown) velocityY = this.boatSpeed;

    this.boat.setVelocity(velocityX, velocityY);

    if (velocityX !== 0 || velocityY !== 0) {
      this.boat.rotation = Phaser.Math.Angle.Between(0, 0, velocityX, velocityY);
    }

    this.checkPratCapture();
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
        this.score += entity.power;
        this.scoreText.setText(`Prat capturés: ${this.score}`);

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
