import Phaser from "phaser";
import { EventBus } from "../EventBus";

interface PratEntity {
  text: Phaser.GameObjects.Text;
  power: number;
  captured: boolean;
}

export class GameScene extends Phaser.Scene {
  private boat!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private pratEntities: PratEntity[] = [];
  private score: number = 0;
  private scoreText!: Phaser.GameObjects.Text;
  private readonly boatSpeed = 200;
  private readonly captureRadius = 80;

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

    this.spawnInitialPrat();
    EventBus.emit("current-scene-ready", this);
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
      const word = pratWords[index % pratWords.length];
      const style = styles[index % styles.length];
      const x = Phaser.Math.Between(100, 700);
      const y = Phaser.Math.Between(100, 500);

      const text = this.add.text(x, y, word, {
        fontSize: `${24 + index * 4}px`,
        fontStyle: style.fontStyle,
        color: "#ffd700",
      });
      text.setOrigin(0.5);

      this.pratEntities.push({
        text,
        power: style.power,
        captured: false,
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
