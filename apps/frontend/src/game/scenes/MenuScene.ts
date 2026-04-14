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

    const title = this.add
      .text(centerX, centerY - 100, "Prat", {
        fontFamily: MENU_TEXT_FONT_FAMILY,
        fontSize: "64px",
        color: "#000",
      })
      .setOrigin(0.5);

    const subtitle = this.add
      .text(centerX, centerY - 30, "Chasse aux Prat en mer", {
        fontFamily: MENU_TEXT_FONT_FAMILY,
        fontSize: "20px",
        color: "#333",
      })
      .setOrigin(0.5);

    const nameLabel = this.add
      .text(centerX, centerY + 10, "Entre ton nom", {
        fontFamily: MENU_TEXT_FONT_FAMILY,
        fontSize: "18px",
        color: "#333",
      })
      .setOrigin(0.5);

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

    const playButtonBackground = this.add
      .rectangle(centerX, playButtonY, playButtonWidth, playButtonHeight, 0x333333)
      .setInteractive({ useHandCursor: true });

    const playButtonText = this.add
      .text(centerX, playButtonY, "Jouer", {
        fontFamily: MENU_TEXT_FONT_FAMILY,
        fontSize: "32px",
        color: "#fff",
      })
      .setOrigin(0.5)
      .setDepth(1);

    const errorText = this.add
      .text(centerX, centerY + 150, "", {
        fontFamily: MENU_TEXT_FONT_FAMILY,
        fontSize: "16px",
        color: "#c00",
      })
      .setOrigin(0.5);

    playButtonBackground.on("pointerover", () => {
      playButtonBackground.setFillStyle(0x555555);
    });
    playButtonBackground.on("pointerout", () => {
      playButtonBackground.setFillStyle(0x333333);
    });

    const submitPlay = (): void => {
      const name = (nameInputDom.node as HTMLInputElement).value.trim();
      if (!name) {
        errorText.setText("Entre ton nom pour jouer");
        this.tweens.add({
          targets: errorText,
          alpha: 0.3,
          duration: 150,
          yoyo: true,
        });
        return;
      }
      errorText.setText("");
      this.startGame(name);
    };

    playButtonBackground.on("pointerdown", submitPlay);

    const keyboard = this.input.keyboard;
    if (keyboard) {
      const onEnter = (): void => {
        submitPlay();
      };
      keyboard.on("keydown-ENTER", onEnter);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        keyboard.off("keydown-ENTER", onEnter);
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
