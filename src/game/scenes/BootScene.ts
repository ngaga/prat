import Phaser from "phaser";
import { EventBus } from "../EventBus";

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "BootScene" });
  }

  preload(): void {
    this.createBoatTexture();
    this.load.audio("music", "/sounds/music.mp3");
  }

  private createBoatTexture(): void {
    const graphics = this.add.graphics();
    graphics.fillStyle(0xffffff, 1);
    graphics.fillRect(0, 0, 64, 64);
    graphics.generateTexture("sea", 64, 64);
    graphics.destroy();

    const boatGraphics = this.add.graphics();
    boatGraphics.fillStyle(0x000000, 1);
    boatGraphics.fillTriangle(40, 0, 0, 30, 80, 30);
    boatGraphics.fillRect(35, 30, 10, 40);
    boatGraphics.fillTriangle(45, 30, 45, 0, 55, 15);
    boatGraphics.generateTexture("boat", 80, 70);
    boatGraphics.destroy();
  }

  create(): void {
    EventBus.emit("current-scene-ready", this);
    this.scene.start("MenuScene");
  }
}
