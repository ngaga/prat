import { createClient } from "@/lib/supabase";

const OCTOPUSES_ENABLED_KEY = "octopuses_enabled";

export async function isOctopusesEnabled(): Promise<boolean> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("feature_flags")
      .select("value")
      .eq("key", OCTOPUSES_ENABLED_KEY)
      .single();

    if (error || data == null) return true;
    return data.value === true;
  } catch {
    return true;
  }
}
