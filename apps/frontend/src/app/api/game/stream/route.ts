import { ensureServerGameFeatureFlagsLoaded, GAME_LOOP_INTERVAL_MS, getGameEngine } from "@/lib/gameEngine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Track concurrent SSE streams per room/player to avoid removing active players during EventSource reconnect races. */
const activeStreamCountByRoomAndPlayer = new Map<string, number>();

function streamKey(roomId: string, playerId: string): string {
  return `${roomId}::${playerId}`;
}

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
  const key = streamKey(roomId, playerId);
  const nextActiveCount = (activeStreamCountByRoomAndPlayer.get(key) ?? 0) + 1;
  activeStreamCountByRoomAndPlayer.set(key, nextActiveCount);
  if (nextActiveCount > 1) {
    console.warn("[game-stream] concurrent streams for same player", {
      roomId,
      playerId,
      activeStreamCount: nextActiveCount,
    });
  }
  room.touchPlayer(playerId);

  const encoder = new TextEncoder();
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let cleanedUp = false;

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
    const currentActiveCount = activeStreamCountByRoomAndPlayer.get(key) ?? 0;
    if (currentActiveCount <= 0) {
      console.warn("[game-stream] cleanup without active stream count", {
        roomId,
        playerId,
      });
      activeStreamCountByRoomAndPlayer.delete(key);
      return;
    }
    if (currentActiveCount <= 1) {
      activeStreamCountByRoomAndPlayer.delete(key);
      room.removePlayer(playerId);
      return;
    }
    activeStreamCountByRoomAndPlayer.set(key, currentActiveCount - 1);
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
