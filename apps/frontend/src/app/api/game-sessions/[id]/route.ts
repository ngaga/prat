import { createAdminClient } from "@/lib/supabaseAdmin";
import { NextResponse } from "next/server";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY not configured" },
      { status: 500 }
    );
  }
  try {
    const { id: sessionId } = await params;
    if (!sessionId || !uuidPattern.test(sessionId)) {
      return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
    }

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
    const body = parsed as {
      actionsCount?: number;
      expGained?: number;
      killsOctopus?: number;
      killsStingray?: number;
      ghostPratsCaptured?: number;
      disconnectedUnexpectedly?: boolean;
    };

    const actionsCount = Math.max(0, Math.floor(Number(body.actionsCount) || 0));
    const expGained = Math.max(0, Math.floor(Number(body.expGained) || 0));
    const killsOctopus = Math.max(0, Math.floor(Number(body.killsOctopus) || 0));
    const killsStingray = Math.max(0, Math.floor(Number(body.killsStingray) || 0));
    const ghostPratsCaptured = Math.max(0, Math.floor(Number(body.ghostPratsCaptured) || 0));
    const disconnectedUnexpectedly = Boolean(body.disconnectedUnexpectedly);

    const supabase = createAdminClient();
    const { error } = await supabase
      .from("game_sessions")
      .update({
        ended_at: new Date().toISOString(),
        actions_count: actionsCount,
        exp_gained: expGained,
        kills_octopus: killsOctopus,
        kills_stingray: killsStingray,
        ghost_prats_captured: ghostPratsCaptured,
        disconnected_unexpectedly: disconnectedUnexpectedly,
      })
      .eq("id", sessionId);

    if (error) {
      console.error("game_sessions update error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("PATCH /api/game-sessions/[id] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
