import Phaser from "phaser";
import { EventBus } from "../EventBus";
import { MultiplayerManager } from "../multiplayer/MultiplayerManager";

interface PratEntity {
  text: Phaser.GameObjects.Text;
  power: number;
  captured: boolean;
  index: number;
}

const PRAT_POSITIONS = [
  { x: 150, y: 120 },
  { x: 400, y: 150 },
  { x: 650, y: 200 },
  { x: 200, y: 300 },
  { x: 500, y: 350 },
  { x: 600, y: 450 },
  { x: 100, y: 450 },
  { x: 350, y: 500 },
];

export class GameScene extends Phaser.Scene {
  private boat!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private pratEntities: PratEntity[] = [];
  private score: number = 0;
  private scoreText!: Phaser.GameObjects.Text;
  private readonly boatSpeed = 200;
  private readonly captureRadius = 80;
  private multiplayer!: MultiplayerManager;
  private remoteBoatSprites = new Map<string, Phaser.GameObjects.Image>();
  private isSceneActive = true;

  constructor() {
    super({ key: "GameScene" });
  }

  create(): void {
    this.add
      .rectangle(0, 0, 1600, 1200, 0x1a3a52)
      .setOrigin(0)
      .setScrollFactor(0);

    this.add
      .rectangle(400, 300, 800, 600, 0x2d5a7b, 0.3)
      .setStrokeStyle(2, 0x4a90b8);

    this.cursors = this.input.keyboard!.createCursorKeys();

    this.boat = this.physics.add.sprite(400, 300, "boat");
    this.boat.setCollideWorldBounds(true);
    this.boat.setScale(0.5);

    this.scoreText = this.add
      .text(16, 16, "Prat capturés: 0", {
        fontSize: "20px",
        color: "#fff",
      })
      .setScrollFactor(0);

    this.add
      .text(784, 16, "", {
        fontSize: "14px",
        color: "#aaa",
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setName("multiplayer-status");

    this.spawnInitialPrat();

    this.multiplayer = new MultiplayerManager({
      onRemotePlayerUpdate: (players) => {
        if (!this.isSceneActive) return;
        this.updateRemoteBoats(players);
      },
      onPratCaptured: (pratIndex, playerId) => {
        if (!this.isSceneActive) return;
        this.handleRemotePratCapture(pratIndex, playerId);
      },
      onConnected: () => {
        if (!this.isSceneActive) return;
        this.updateMultiplayerStatus();
      },
      getLocalState: () => {
        if (!this.isSceneActive) return { x: 0, y: 0, rotation: 0, score: 0 };
        return {
        x: this.boat.x,
        y: this.boat.y,
        rotation: this.boat.rotation,
        score: this.score,
        };
      },
    });
    this.multiplayer.connect();
    this.updateMultiplayerStatus();

    EventBus.emit("current-scene-ready", this);
  }

  shutdown(): void {
    this.isSceneActive = false;
    this.multiplayer.disconnect();
  }

  private updateMultiplayerStatus(): void {
    const statusText = this.children.getByName("multiplayer-status") as Phaser.GameObjects.Text;
    if (statusText) {
      statusText.setText(this.multiplayer.isActive() ? "Multijoueur actif" : "Solo");
    }
  }

  private updateRemoteBoats(players: Map<string, { id: string; x: number; y: number; rotation: number; color: number }>): void {
    if (!this.isSceneActive || !this.scene?.isActive?.() || !this.add) return;
    try {
      for (const [playerId, data] of players) {
        if (data.x == null || data.y == null) continue;
        let sprite = this.remoteBoatSprites.get(playerId);
        if (!sprite) {
          if (!this.textures.exists("boat")) return;
          sprite = this.add.image(data.x, data.y, "boat");
          sprite.setScale(0.5);
          sprite.setTint(data.color);
          sprite.setDepth(5);
          this.remoteBoatSprites.set(playerId, sprite);
        }
        sprite.setPosition(data.x, data.y);
        sprite.setRotation(data.rotation);
      }
      for (const playerId of this.remoteBoatSprites.keys()) {
        if (!players.has(playerId)) {
          const sprite = this.remoteBoatSprites.get(playerId);
          sprite?.destroy();
          this.remoteBoatSprites.delete(playerId);
        }
      }
    } catch {
      // Scene may be destroyed, ignore
    }
  }

  private handleRemotePratCapture(pratIndex: number, _playerId: string): void {
    const entity = this.pratEntities.find((entity) => entity.index === pratIndex);
    if (entity && !entity.captured) {
      entity.captured = true;
      this.tweens.add({
        targets: entity.text,
        alpha: 0,
        scale: 0,
        duration: 300,
        onComplete: () => entity.text.destroy(),
      });
    }
  }

  private spawnInitialPrat(): void {
    const pratWords = ["prat", "PRAT", "prat", "PrAt", "prat"];
    const styles = [
      { fontStyle: "normal", power: 1 },
      { fontStyle: "bold", power: 2 },
      { fontStyle: "italic", power: 2 },
      { fontStyle: "bold italic", power: 3 },
    ];

    for (let index = 0; index < 8; index++) {
      const position = PRAT_POSITIONS[index];
      const word = pratWords[index % pratWords.length];
      const style = styles[index % styles.length];

      const text = this.add.text(position.x, position.y, word, {
        fontSize: `${24 + index * 4}px`,
        fontStyle: style.fontStyle,
        color: "#ffd700",
      });
      text.setOrigin(0.5);

      this.pratEntities.push({
        text,
        power: style.power,
        captured: false,
        index,
      });
    }
  }

  update(): void {
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

        if (this.multiplayer.isActive()) {
          this.multiplayer.broadcastPratCapture(entity.index, this.score);
        }

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
