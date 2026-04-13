"use client";

import { forwardRef, useEffect, useLayoutEffect, useRef } from "react";
import type { Game, Scene } from "phaser";
import StartGame from "@/game/main";
import { EventBus } from "@/game/EventBus";

export interface PhaserGameRef {
  game: Game | null;
  scene: Scene | null;
}

interface PhaserGameProps {
  currentActiveScene?: (scene: Scene) => void;
}

export const PhaserGame = forwardRef<PhaserGameRef, PhaserGameProps>(
  function PhaserGame({ currentActiveScene }, ref) {
    const gameRef = useRef<Game | null>(null);

    useLayoutEffect(() => {
      const container = document.getElementById("game-container");
      if (!container || gameRef.current) return;

      const game = StartGame("game-container");
      gameRef.current = game;

      const refreshGameScale = (): void => {
        game.scale.refresh();
      };

      const scheduleScaleRefreshForRotation = (): void => {
        refreshGameScale();
        requestAnimationFrame(refreshGameScale);
        window.setTimeout(refreshGameScale, 120);
        window.setTimeout(refreshGameScale, 350);
      };

      window.addEventListener("resize", scheduleScaleRefreshForRotation);
      window.addEventListener("orientationchange", scheduleScaleRefreshForRotation);
      const visualViewport = window.visualViewport;
      visualViewport?.addEventListener("resize", scheduleScaleRefreshForRotation);

      const refValue = { game, scene: null };
      if (typeof ref === "function") {
        ref(refValue);
      } else if (ref) {
        ref.current = refValue;
      }

      return () => {
        window.removeEventListener("resize", scheduleScaleRefreshForRotation);
        window.removeEventListener("orientationchange", scheduleScaleRefreshForRotation);
        visualViewport?.removeEventListener("resize", scheduleScaleRefreshForRotation);
        if (gameRef.current) {
          gameRef.current.destroy(true);
          gameRef.current = null;
        }
        if (typeof ref === "function") {
          ref({ game: null, scene: null });
        } else if (ref) {
          ref.current = { game: null, scene: null };
        }
      };
    }, [ref]);

    useEffect(() => {
      const handler = (scene: Scene) => {
        currentActiveScene?.(scene);
        const refValue = {
          game: gameRef.current,
          scene,
        };
        if (typeof ref === "function") {
          ref(refValue);
        } else if (ref) {
          ref.current = refValue;
        }
      };
      EventBus.on("current-scene-ready", handler);
      return () => {
        EventBus.removeListener("current-scene-ready");
      };
    }, [currentActiveScene, ref]);

    return (
      <div id="game-container" className="h-full min-h-0 min-w-0 w-full flex-1" />
    );
  }
);
