import Phaser from "phaser";
import { MAX_PLAYER_NAME_LENGTH } from "@/game/config";
import { isOctopusesEnabled, isStingraysEnabled } from "@/lib/featureFlags";

const MENU_TEXT_FONT_FAMILY = "Verdana, Arial, sans-serif";

export class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: "MenuScene" });
  }

  create(): void {
    this.cameras.main.roundPixels = true;
    const centerX = Math.round(this.cameras.main.centerX);
    const centerY = Math.round(this.cameras.main.centerY);

    this.add.rectangle(centerX, centerY, 800, 600, 0xffffff);

    const titleElement = document.createElement("div");
    titleElement.textContent = "Prat";
    titleElement.style.cssText = `font-family: ${MENU_TEXT_FONT_FAMILY}; font-size: 64px; font-weight: 700; color: #000; line-height: 1; text-align: center;`;
    this.add.dom(centerX, centerY - 100, titleElement);

    const subtitleElement = document.createElement("div");
    subtitleElement.textContent = "Chasse aux Prat en mer";
    subtitleElement.style.cssText = `font-family: ${MENU_TEXT_FONT_FAMILY}; font-size: 20px; color: #333; line-height: 1.2; text-align: center;`;
    this.add.dom(centerX, centerY - 30, subtitleElement);

    const nameLabelElement = document.createElement("div");
    nameLabelElement.textContent = "Entre ton nom";
    nameLabelElement.style.cssText = `font-family: ${MENU_TEXT_FONT_FAMILY}; font-size: 18px; color: #333; line-height: 1.2; text-align: center;`;
    this.add.dom(centerX, centerY + 10, nameLabelElement);

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "Ton nom";
    nameInput.maxLength = MAX_PLAYER_NAME_LENGTH;
    nameInput.style.cssText =
      `width: 220px; height: 40px; font-size: 18px; font-family: ${MENU_TEXT_FONT_FAMILY}; padding: 8px; border: 2px solid #333; text-align: center; pointer-events: auto;`;
    const nameInputDom = this.add.dom(centerX, centerY + 50, nameInput);
    nameInputDom.pointerEvents = "auto";

    this.time.delayedCall(0, () => {
      nameInput.focus();
    });

    const playButtonY = centerY + 110;
    const playButtonWidth = 200;
    const playButtonHeight = 56;

    const playButtonElement = document.createElement("button");
    playButtonElement.type = "button";
    playButtonElement.textContent = "Jouer";
    playButtonElement.style.cssText = `width: ${playButtonWidth}px; height: ${playButtonHeight}px; border: 0; border-radius: 8px; background: #333; color: #fff; font-family: ${MENU_TEXT_FONT_FAMILY}; font-size: 32px; line-height: 1; cursor: pointer;`;
    playButtonElement.addEventListener("mouseenter", () => {
      playButtonElement.style.background = "#555";
    });
    playButtonElement.addEventListener("mouseleave", () => {
      playButtonElement.style.background = "#333";
    });
    const playButtonDom = this.add.dom(centerX, playButtonY, playButtonElement);
    playButtonDom.pointerEvents = "auto";

    const errorTextElement = document.createElement("div");
    errorTextElement.style.cssText = `min-height: 20px; font-family: ${MENU_TEXT_FONT_FAMILY}; font-size: 16px; color: #c00; text-align: center;`;
    const errorText = this.add.dom(centerX, centerY + 150, errorTextElement);

    const submitPlay = (): void => {
      const name = (nameInputDom.node as HTMLInputElement).value.trim();
      if (!name) {
        errorTextElement.textContent = "Entre ton nom pour jouer";
        this.tweens.add({
          targets: errorText,
          alpha: 0.3,
          duration: 150,
          yoyo: true,
        });
        return;
      }
      errorTextElement.textContent = "";
      this.startGame(name);
    };

    playButtonElement.addEventListener("click", submitPlay);

    const keyboard = this.input.keyboard;
    if (keyboard) {
      const onEnter = (): void => {
        submitPlay();
      };
      keyboard.on("keydown-ENTER", onEnter);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        keyboard.off("keydown-ENTER", onEnter);
        playButtonElement.removeEventListener("click", submitPlay);
      });
    } else {
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        playButtonElement.removeEventListener("click", submitPlay);
      });
    }
  }

  private async startGame(playerName: string): Promise<void> {
    const [octopusesEnabled, stingraysEnabled] = await Promise.all([
      isOctopusesEnabled(),
      isStingraysEnabled(),
    ]);
    this.scene.start("GameScene", { octopusesEnabled, stingraysEnabled, playerName });
  }
}
