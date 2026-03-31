import { createAdminClient } from "@/lib/supabaseAdmin";
import { NextResponse } from "next/server";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY not configured" },
      { status: 500 }
    );
  }
  try {
    const raw = await request.text();
    if (!raw.trim()) {
      return NextResponse.json({ error: "Request body is required" }, { status: 400 });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const body = parsed as { playerId?: string };
    const playerId = typeof body.playerId === "string" ? body.playerId.trim() : "";
    if (!playerId || !uuidPattern.test(playerId)) {
      return NextResponse.json({ error: "playerId must be a valid UUID" }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("game_sessions")
      .insert({
        player_id: playerId,
      })
      .select("id")
      .single();

    if (error) {
      console.error("game_sessions insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const row = data as { id: string } | null;
    if (!row?.id) {
      return NextResponse.json({ error: "No session id returned" }, { status: 500 });
    }
    return NextResponse.json({ sessionId: row.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("POST /api/game-sessions error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
