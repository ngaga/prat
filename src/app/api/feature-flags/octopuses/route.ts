import { createAdminClient } from "@/lib/supabaseAdmin";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("feature_flags")
      .select("value")
      .eq("key", "octopuses_enabled")
      .single();

    if (error || data == null) {
      return NextResponse.json({ enabled: true });
    }
    return NextResponse.json({ enabled: data.value === true });
  } catch {
    return NextResponse.json({ enabled: true });
  }
}
