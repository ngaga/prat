import Phaser from "phaser";
import type { Types } from "phaser";
import { VIEW_HEIGHT, VIEW_WIDTH } from "@/lib/displayConstants";

export const MAX_PLAYER_NAME_LENGTH = 20;

export { VIEW_HEIGHT, VIEW_WIDTH };

const DEVICE_PIXEL_RATIO =
  typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
const RENDER_RESOLUTION = Phaser.Math.Clamp(DEVICE_PIXEL_RATIO, 1, 2);

export const gameConfig: Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game-container",
  backgroundColor: "#ffffff",
  resolution: RENDER_RESOLUTION,
  render: {
    antialias: true,
    pixelArt: false,
    roundPixels: true,
  },
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: VIEW_WIDTH,
    height: VIEW_HEIGHT,
  },
  audio: {
    noAudio: true,
  },
  physics: {
    default: "arcade",
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  dom: {
    createContainer: true,
  },
  scene: [],
};
