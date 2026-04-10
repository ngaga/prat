import { ensureServerGameFeatureFlagsLoaded, getGameEngine } from "@/lib/gameEngine";
import type { PlayerInput, PlayerInputType } from "@/lib/gameTypes";

export const runtime = "nodejs";

const allowedInputTypes: PlayerInputType[] = [
  "MOVE",
  "SHOOT",
  "ROTATE",
  "PRAT_CAPTURE",
  "SYNC_PROFILE",
  "TOWN_SEND_SALVO",
];

interface InputBody {
  roomId?: string;
  playerId?: string;
  input?: PlayerInput;
}

export async function POST(request: Request): Promise<Response> {
  let body: InputBody;
  try {
    body = (await request.json()) as InputBody;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const roomId = typeof body.roomId === "string" && body.roomId.trim() ? body.roomId : "default";
  const playerId = body.playerId?.trim();
  const input = body.input;

  if (!playerId) {
    return new Response(JSON.stringify({ error: "Missing playerId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (
    !input ||
    typeof input.type !== "string" ||
    typeof input.timestamp !== "number" ||
    !allowedInputTypes.includes(input.type as PlayerInputType)
  ) {
    return new Response(JSON.stringify({ error: "Missing or invalid input" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  await ensureServerGameFeatureFlagsLoaded();
  const engine = getGameEngine();
  const room = engine.getRoom(roomId);
  const result = room.handlePlayerInput(playerId, input);
  room.runSimulationTickIfDue(Date.now());

  return new Response(JSON.stringify({ ok: true, ...result }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
