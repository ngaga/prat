import { GameSection } from "@/components/GameSection";
import { KofiButton } from "@/components/KofiButton";

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
          <GameSection />
        </div>
      </main>
    </div>
  );
}
