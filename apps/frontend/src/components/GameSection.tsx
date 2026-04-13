"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { warmupBackendOncePerSession } from "@/lib/backendWarmup";

const PhaserGame = dynamic(
  () => import("@/components/PhaserGame").then((mod) => mod.PhaserGame),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-white text-black">
        Chargement du jeu...
      </div>
    ),
  }
);

export function GameSection() {
  useEffect(() => {
    void warmupBackendOncePerSession();
  }, []);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <PhaserGame />
    </div>
  );
}
