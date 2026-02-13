import type { Types } from "phaser";

export const gameConfig: Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game-container",
  backgroundColor: "#1a3a52",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 800,
    height: 600,
  },
  physics: {
    default: "arcade",
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  scene: [],
};
