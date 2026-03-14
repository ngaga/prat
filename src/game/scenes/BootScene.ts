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

    const octopusText = this.add.text(0, 0, "P", {
      fontSize: "48px",
      color: "#333333",
      fontFamily: "sans-serif",
    });
    octopusText.setOrigin(0.5, 0.5);
    const octopusRenderTexture = this.add.renderTexture(0, 0, 64, 64);
    octopusRenderTexture.draw(octopusText, 32, 32);
    octopusRenderTexture.saveTexture("octopus");
    octopusText.destroy();
    octopusRenderTexture.destroy();

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
