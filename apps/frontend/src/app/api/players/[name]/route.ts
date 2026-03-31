import { getLevelFromExperience } from "@/lib/gameBalance";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(null);
  }
  try {
    const { name } = await params;
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("players")
      .select(
        "id, name, exp, level, kills_octopus, kills_stingray, prats_captured, is_ghost, ghost_prats_captured"
      )
      .eq("name", name.trim())
      .maybeSingle();

    if (error) {
      console.error("getPlayerByName error:", error);
      return NextResponse.json(null);
    }
    if (!data) {
      return NextResponse.json(null);
    }
    const exp = Number.isFinite(Number(data.exp)) ? Number(data.exp) : 0;
    return NextResponse.json({
      ...data,
      level: getLevelFromExperience(exp),
    });
  } catch {
    return NextResponse.json(null);
  }
}
