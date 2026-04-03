import { ensureServerGameFeatureFlagsLoaded, GAME_LOOP_INTERVAL_MS, getGameEngine } from "@/lib/gameEngine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const roomId = url.searchParams.get("roomId") ?? "default";
  const playerId = url.searchParams.get("playerId");
  if (!playerId?.trim()) {
    return new Response("Missing playerId query parameter", { status: 400 });
  }

  await ensureServerGameFeatureFlagsLoaded();
  const engine = getGameEngine();
  const room = engine.getRoom(roomId);
  room.touchPlayer(playerId);

  const encoder = new TextEncoder();
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let cleanedUp = false;

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
    room.removePlayer(playerId);
  };

  request.signal.addEventListener("abort", cleanup);

  const stream = new ReadableStream({
    start(controller) {
      const send = () => {
        const state = room.getState();
        const body = `data: ${JSON.stringify(state)}\n\n`;
        controller.enqueue(encoder.encode(body));
      };
      send();
      intervalId = setInterval(send, GAME_LOOP_INTERVAL_MS);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
