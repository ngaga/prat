import Phaser from "phaser";
import { EventBus } from "../EventBus";

const UI_MSDF_FONT_KEY = "uiMsdf";
const UI_MSDF_TEXTURE_PATH = "/fonts/ui-msdf.png";
const UI_MSDF_DATA_PATH = "/fonts/ui-msdf.fnt";
const UI_MSDF_PIPELINE_KEY = "uiMsdfPipeline";
const UI_MSDF_FRAGMENT_SHADER = `
precision mediump float;

uniform sampler2D uMainSampler;
varying vec2 outTexCoord;
varying vec4 outTint;

float median(float red, float green, float blue) {
  return max(min(red, green), min(max(red, green), blue));
}

void main() {
  vec4 sampledColor = texture2D(uMainSampler, outTexCoord);
  float signedDistance = median(sampledColor.r, sampledColor.g, sampledColor.b);
  float smoothing = 0.1;
  float weightBias = 0.08;
  float alpha = smoothstep((0.5 - weightBias) - smoothing, (0.5 - weightBias) + smoothing, signedDistance);
  gl_FragColor = vec4(outTint.rgb, outTint.a * alpha);
}
`;

class MsdfBitmapPipeline extends Phaser.Renderer.WebGL.Pipelines.SinglePipeline {
  constructor(game: Phaser.Game) {
    super({
      game,
      fragShader: UI_MSDF_FRAGMENT_SHADER,
    });
  }
}

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "BootScene" });
  }

  preload(): void {
    this.load.bitmapFont(UI_MSDF_FONT_KEY, UI_MSDF_TEXTURE_PATH, UI_MSDF_DATA_PATH);
    this.load.audio("musicDay", "/sounds/day.m4a");
    this.load.audio("musicNight", "/sounds/night.m4a");
  }

  private registerMsdfPipeline(): void {
    const renderer = this.game.renderer;
    if (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return;
    if (renderer.pipelines.has(UI_MSDF_PIPELINE_KEY)) return;
    renderer.pipelines.add(UI_MSDF_PIPELINE_KEY, new MsdfBitmapPipeline(this.game));
  }

  private configureMsdfTextureFiltering(): void {
    const msdfTexture = this.textures.get(UI_MSDF_FONT_KEY);
    msdfTexture.setFilter(Phaser.Textures.FilterMode.LINEAR);
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

    this.createOctopusTexture();
    this.createStingrayTexture();

    const boatGraphics = this.add.graphics();
    // White base so tint can produce a black silhouette (normal) or white ghost (clear tint), like dark mode.
    boatGraphics.fillStyle(0xffffff, 1);
    boatGraphics.fillTriangle(40, 0, 0, 30, 80, 30);
    boatGraphics.fillRect(35, 30, 10, 40);
    boatGraphics.fillTriangle(45, 30, 45, 0, 55, 15);
    boatGraphics.generateTexture("boat", 80, 70);
    boatGraphics.destroy();
  }

  private createOctopusTexture(): void {
    this.createLetterTexture({
      letter: "P",
      textureKey: "octopus",
      textureWidth: 64,
      textureHeight: 64,
      fontSizePx: 56,
      colorHex: "#333333",
    });
  }

  private createStingrayTexture(): void {
    this.createLetterTexture({
      letter: "R",
      textureKey: "stingray",
      textureWidth: 56,
      textureHeight: 48,
      fontSizePx: 44,
      colorHex: "#555555",
    });
  }

  private createLetterTexture(options: {
    letter: string;
    textureKey: string;
    textureWidth: number;
    textureHeight: number;
    fontSizePx: number;
    colorHex: string;
  }): void {
    const renderTexture = this.add.renderTexture(0, 0, options.textureWidth, options.textureHeight);
    const centerX = Math.round(options.textureWidth / 2);
    const centerY = Math.round(options.textureHeight / 2);
    const bitmapLabel = this.add.bitmapText(centerX, centerY, UI_MSDF_FONT_KEY, options.letter);
    bitmapLabel.setFontSize(options.fontSizePx);
    bitmapLabel.setOrigin(0.5);
    bitmapLabel.setTint(Phaser.Display.Color.HexStringToColor(options.colorHex).color);
    bitmapLabel.setPipeline(UI_MSDF_PIPELINE_KEY);
    renderTexture.draw(bitmapLabel, centerX, centerY);
    bitmapLabel.destroy();

    renderTexture.saveTexture(options.textureKey);
    renderTexture.destroy();
  }

  create(): void {
    this.registerMsdfPipeline();
    this.configureMsdfTextureFiltering();
    this.createBoatTexture();
    EventBus.emit("current-scene-ready", this);
    this.scene.start("MenuScene");
  }
}
