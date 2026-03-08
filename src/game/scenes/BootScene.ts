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

    const cascadeGraphics = this.add.graphics();
    cascadeGraphics.fillStyle(0x333333, 1);
    cascadeGraphics.fillRect(0, 0, 64, 32);
    cascadeGraphics.fillStyle(0x000000, 1);
    for (let index = 0; index < 4; index++) {
      const x = index * 16;
      cascadeGraphics.fillRect(x, 0, 12, 4);
      cascadeGraphics.fillRect(x + 4, 4, 4, 24);
      cascadeGraphics.fillRect(x + 2, 24, 8, 4);
    }
    cascadeGraphics.generateTexture("cascade", 64, 32);
    cascadeGraphics.destroy();

    const octopusGraphics = this.add.graphics();
    octopusGraphics.fillStyle(0x333333, 1);
    octopusGraphics.fillCircle(32, 32, 28);
    octopusGraphics.fillStyle(0x000000, 1);
    octopusGraphics.lineStyle(4, 0x000000, 1);
    for (let index = 0; index < 8; index++) {
      const angle = (index / 8) * Math.PI * 2 - Math.PI / 2;
      const tipX = 32 + Math.cos(angle) * 45;
      const tipY = 32 + Math.sin(angle) * 45;
      octopusGraphics.lineBetween(32 + Math.cos(angle) * 20, 32 + Math.sin(angle) * 20, tipX, tipY);
    }
    octopusGraphics.fillStyle(0x000000, 1);
    octopusGraphics.fillCircle(32, 24, 6);
    octopusGraphics.fillCircle(38, 26, 5);
    octopusGraphics.generateTexture("octopus", 64, 64);
    octopusGraphics.destroy();

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
