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

      const refValue = { game, scene: null };
      if (typeof ref === "function") {
        ref(refValue);
      } else if (ref) {
        ref.current = refValue;
      }

      return () => {
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

    return <div id="game-container" className="min-h-[400px]" />;
  }
);
