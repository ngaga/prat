import Phaser from "phaser";
import { isOctopusesEnabled } from "@/lib/featureFlags";

export class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: "MenuScene" });
  }

  create(): void {
    const centerX = this.cameras.main.centerX;
    const centerY = this.cameras.main.centerY;

    this.add.rectangle(centerX, centerY, 800, 600, 0xffffff);

    const title = this.add
      .text(centerX, centerY - 100, "Prat", {
        fontSize: "64px",
        color: "#000",
      })
      .setOrigin(0.5);

    const subtitle = this.add
      .text(centerX, centerY - 30, "Chasse aux Prat en mer", {
        fontSize: "20px",
        color: "#333",
      })
      .setOrigin(0.5);

    const playButton = this.add
      .text(centerX, centerY + 80, "Jouer", {
        fontSize: "32px",
        color: "#fff",
        backgroundColor: "#333",
      })
      .setOrigin(0.5)
      .setPadding(24, 12)
      .setInteractive({ useHandCursor: true });

    playButton.on("pointerover", () => {
      playButton.setStyle({ backgroundColor: "#555" });
    });
    playButton.on("pointerout", () => {
      playButton.setStyle({ backgroundColor: "#333" });
    });
    playButton.on("pointerdown", () => {
      this.startGame();
    });
  }

  private async startGame(): Promise<void> {
    this.playBackgroundMusic();
    const octopusesEnabled = await isOctopusesEnabled();
    this.scene.start("GameScene", { octopusesEnabled });
  }

  private playBackgroundMusic(): void {
    const musicUrl = this.cache.audio.exists("music")
      ? "/sounds/music.mp3"
      : "https://assets.mixkit.co/music/preview/mixkit-game-level-music-689.mp3";
    try {
      const audio = new Audio(musicUrl);
      audio.loop = true;
      audio.volume = 0.5;
      this.registry.set("backgroundMusic", audio);
      audio.play().catch(() => {
        // Autoplay blocked or load failed
      });
    } catch {
      // Ignore audio errors
    }
  }
}
