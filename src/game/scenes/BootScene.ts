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
    graphics.fillStyle(0x8b4513, 1);
    graphics.fillTriangle(40, 0, 0, 30, 80, 30);
    graphics.fillStyle(0x654321, 1);
    graphics.fillRect(35, 30, 10, 40);
    graphics.fillStyle(0xffffff, 0.9);
    graphics.fillTriangle(45, 30, 45, 0, 55, 15);
    graphics.generateTexture("boat", 80, 70);
    graphics.destroy();
  }

  create(): void {
    EventBus.emit("current-scene-ready", this);
    this.scene.start("MenuScene");
  }
}
