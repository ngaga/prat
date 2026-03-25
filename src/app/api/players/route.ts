import { getLevelFromExperience } from "@/lib/gameBalance";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("SUPABASE_SERVICE_ROLE_KEY is not set");
    return NextResponse.json(
      { success: false, error: "SUPABASE_SERVICE_ROLE_KEY not configured" },
      { status: 500 }
    );
  }
  try {
    const raw = await request.text();
    if (!raw.trim()) {
      return NextResponse.json(
        { success: false, error: "Request body is required" },
        { status: 400 }
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON body" },
        { status: 400 }
      );
    }
    const body = parsed as {
      name: string;
      exp: number;
      level?: number;
      kills_octopus?: number;
      kills_stingray?: number;
      is_ghost?: boolean;
      ghost_prats_captured?: number;
    };
    const supabase = createAdminClient();
    const trimmedName = body.name.trim();
    if (!trimmedName) {
      return NextResponse.json({ success: false, error: "name is required" }, { status: 400 });
    }

    const exp = Number.isFinite(Number(body.exp)) ? Number(body.exp) : 0;
    const level = getLevelFromExperience(exp);

    const { error } = await supabase.from("players").upsert(
      {
        name: trimmedName,
        exp,
        level,
        kills_octopus: body.kills_octopus ?? 0,
        kills_stingray: body.kills_stingray ?? 0,
        is_ghost: body.is_ghost ?? false,
        ghost_prats_captured: body.ghost_prats_captured ?? 0,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "name" }
    );

    if (error) {
      console.error("upsertPlayer error:", error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("POST /api/players error:", err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
