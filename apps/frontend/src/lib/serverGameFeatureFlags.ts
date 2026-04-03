import { getBackendBaseUrl } from "@/lib/backendBaseUrl";

let octopusesSpawnOnServer = true;
let stingraysSpawnOnServer = true;
let refreshLoopStarted = false;

export function getOctopusesSpawnOnServer(): boolean {
  return octopusesSpawnOnServer;
}

export function getStingraysSpawnOnServer(): boolean {
  return stingraysSpawnOnServer;
}

function parseBundledFlag(value: unknown): boolean | undefined {
  if (value === true) {
    return true;
  }
  if (value === false) {
    return false;
  }
  return undefined;
}

export async function refreshServerGameFeatureFlagsFromDatabase(): Promise<void> {
  const base = getBackendBaseUrl();
  if (!base) {
    return;
  }
  try {
    const response = await fetch(`${base}/api/feature-flags/server`, { cache: "no-store" });
    if (!response.ok) {
      octopusesSpawnOnServer = false;
      stingraysSpawnOnServer = false;
      return;
    }
    const data: unknown = await response.json();
    if (typeof data !== "object" || data === null) {
      return;
    }
    const record = data as Record<string, unknown>;
    const nextOctopuses = parseBundledFlag(record.octopusesEnabled);
    const nextStingrays = parseBundledFlag(record.stingraysEnabled);
    if (nextOctopuses !== undefined) {
      octopusesSpawnOnServer = nextOctopuses;
    }
    if (nextStingrays !== undefined) {
      stingraysSpawnOnServer = nextStingrays;
    }
  } catch {
    // Keep previous values if the API is unavailable
  }
}

/** Call after the first successful refresh (see ensureServerGameFeatureFlagsLoaded). */
export function startServerFeatureFlagsRefreshLoop(): void {
  if (refreshLoopStarted) return;
  refreshLoopStarted = true;
  setInterval(() => {
    void refreshServerGameFeatureFlagsFromDatabase();
  }, 30_000);
}
