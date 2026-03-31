import Phaser from "phaser";
import { gameConfig } from "./config";
import { BootScene } from "./scenes/BootScene";
import { GameScene } from "./scenes/GameScene";
import { MenuScene } from "./scenes/MenuScene";

function registerScenes(game: Phaser.Game): void {
  game.scene.add("BootScene", BootScene);
  game.scene.add("MenuScene", MenuScene);
  game.scene.add("GameScene", GameScene);
}

export default function StartGame(containerId: string): Phaser.Game {
  const config = {
    ...gameConfig,
    parent: containerId,
  };
  const game = new Phaser.Game(config);
  registerScenes(game);
  game.scene.start("BootScene");
  return game;
}
