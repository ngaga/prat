import dynamic from "next/dynamic";
import { KofiButton } from "@/components/KofiButton";

const PhaserGame = dynamic(() => import("@/components/PhaserGame").then((mod) => mod.PhaserGame), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-[400px] items-center justify-center bg-[#1a3a52] text-white">
      Chargement du jeu...
    </div>
  ),
});

export default function Home() {
  return (
    <div className="min-h-screen bg-[#0f172a]">
      <header className="flex items-center justify-between border-b border-slate-700/50 px-4 py-3">
        <h1 className="text-xl font-bold text-amber-400">Prat</h1>
        <KofiButton />
      </header>

      <main className="flex flex-col items-center p-4">
        <p className="mb-4 max-w-lg text-center text-slate-300">
          Pilote ton bateau avec les flèches et capture les Prat ! Plus ils sont
          gros ou en italique, plus ils valent de points.
        </p>
        <div className="overflow-hidden rounded-lg border-2 border-amber-500/30 shadow-xl">
          <PhaserGame />
        </div>
      </main>
    </div>
  );
}
