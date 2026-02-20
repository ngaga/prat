import Phaser from "phaser";

export class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: "MenuScene" });
  }

  create(): void {
    this.add.rectangle(400, 300, 800, 600, 0x1a3a52);

    const title = this.add
      .text(400, 200, "Prat", {
        fontSize: "64px",
        color: "#ffd700",
      })
      .setOrigin(0.5);

    const subtitle = this.add
      .text(400, 270, "Chasse aux Prat en mer", {
        fontSize: "20px",
        color: "#aaa",
      })
      .setOrigin(0.5);

    const playButton = this.add
      .text(400, 380, "Jouer", {
        fontSize: "32px",
        color: "#fff",
        backgroundColor: "#2d5a7b",
      })
      .setOrigin(0.5)
      .setPadding(24, 12)
      .setInteractive({ useHandCursor: true });

    playButton.on("pointerover", () => {
      playButton.setStyle({ backgroundColor: "#4a90b8" });
    });
    playButton.on("pointerout", () => {
      playButton.setStyle({ backgroundColor: "#2d5a7b" });
    });
    playButton.on("pointerdown", () => {
      this.startGame();
    });
  }

  private startGame(): void {
    this.playBackgroundMusic();
    this.scene.start("GameScene");
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
