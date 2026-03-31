import { createAdminClient } from "@/lib/supabaseAdmin";

let octopusesSpawnOnServer = true;
let stingraysSpawnOnServer = true;
let refreshLoopStarted = false;

export function getOctopusesSpawnOnServer(): boolean {
  return octopusesSpawnOnServer;
}

export function getStingraysSpawnOnServer(): boolean {
  return stingraysSpawnOnServer;
}

export async function refreshServerGameFeatureFlagsFromDatabase(): Promise<void> {
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("feature_flags")
      .select("key, value")
      .in("key", ["octopuses_enabled", "stingrays_enabled"]);
    for (const row of data ?? []) {
      if (row.key === "octopuses_enabled") {
        octopusesSpawnOnServer = row.value === true;
      }
      if (row.key === "stingrays_enabled") {
        stingraysSpawnOnServer = row.value === true;
      }
    }
  } catch {
    // Keep previous values if Supabase is unavailable
  }
}

/** Call once from the game engine so server spawns match database feature flags. */
export function startServerFeatureFlagsRefreshLoop(): void {
  if (refreshLoopStarted) return;
  refreshLoopStarted = true;
  void refreshServerGameFeatureFlagsFromDatabase();
  setInterval(() => {
    void refreshServerGameFeatureFlagsFromDatabase();
  }, 30_000);
}
