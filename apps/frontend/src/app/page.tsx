import { GameSection } from "@/components/GameSection";
import { KofiButton } from "@/components/KofiButton";

export default function Home() {
  return (
    <div className="fixed inset-0 flex min-h-dvh w-full flex-col overflow-hidden bg-white">
      <div className="absolute right-4 top-4 z-10">
        <KofiButton />
      </div>
      <div id="game-wrapper" className="relative min-h-0 min-w-0 flex-1">
        <GameSection />
      </div>
    </div>
  );
}
