import { GameSection } from "@/components/GameSection";
import { KofiButton } from "@/components/KofiButton";

export default function Home() {
  return (
    <div className="relative h-screen w-screen overflow-hidden bg-white">
      <div className="absolute right-4 top-4 z-10">
        <KofiButton />
      </div>
      <div className="absolute left-4 top-4 z-10 text-black">Prat</div>
      <div id="game-wrapper" className="absolute inset-0">
        <GameSection />
      </div>
    </div>
  );
}
