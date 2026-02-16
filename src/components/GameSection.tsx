"use client";

import dynamic from "next/dynamic";

const PhaserGame = dynamic(
  () => import("@/components/PhaserGame").then((mod) => mod.PhaserGame),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[400px] items-center justify-center bg-[#1a3a52] text-white">
        Chargement du jeu...
      </div>
    ),
  }
);

export function GameSection() {
  return <PhaserGame />;
}
