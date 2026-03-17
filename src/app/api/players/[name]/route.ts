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
      .select("id, name, exp, level, kills_octopus, kills_stingray")
      .eq("name", name.trim())
      .maybeSingle();

    if (error) {
      console.error("getPlayerByName error:", error);
      return NextResponse.json(null);
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(null);
  }
}
