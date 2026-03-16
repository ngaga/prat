import { createAdminClient } from "@/lib/supabaseAdmin";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
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
      return NextResponse.json({ success: false }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
