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
    const body = (await request.json()) as {
      name: string;
      exp: number;
      level: number;
      kills_octopus?: number;
      kills_stingray?: number;
    };
    const supabase = createAdminClient();
    const { error } = await supabase.from("players").upsert(
      {
        name: body.name.trim(),
        exp: body.exp,
        level: body.level,
        kills_octopus: body.kills_octopus ?? 0,
        kills_stingray: body.kills_stingray ?? 0,
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
