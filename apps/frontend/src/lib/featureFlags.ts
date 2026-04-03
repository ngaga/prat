import { getBackendBaseUrl } from "@/lib/backendBaseUrl";

/** Menu passes strict booleans; unknown shapes default to on (same as missing API). */
export function coerceClientFeatureFlag(value: unknown): boolean {
  if (value === false) {
    return false;
  }
  if (value === true) {
    return true;
  }
  return true;
}

/** Nest returns `{ enabled: boolean }`; malformed body → off (safe default when API shape is wrong). */
function parseEnabledFromResponseBody(body: unknown): boolean {
  if (typeof body !== "object" || body === null || !("enabled" in body)) {
    return false;
  }
  const raw = (body as { enabled: unknown }).enabled;
  if (raw === true) {
    return true;
  }
  if (raw === false) {
    return false;
  }
  return false;
}

export async function isOctopusesEnabled(): Promise<boolean> {
  try {
    const base = getBackendBaseUrl();
    if (!base) {
      return true;
    }
    const response = await fetch(`${base}/api/feature-flags/octopuses`, { cache: "no-store" });
    if (!response.ok) {
      return false;
    }
    const body: unknown = await response.json();
    return parseEnabledFromResponseBody(body);
  } catch {
    return true;
  }
}

export async function isStingraysEnabled(): Promise<boolean> {
  try {
    const base = getBackendBaseUrl();
    if (!base) {
      return true;
    }
    const response = await fetch(`${base}/api/feature-flags/stingrays`, { cache: "no-store" });
    if (!response.ok) {
      return false;
    }
    const body: unknown = await response.json();
    return parseEnabledFromResponseBody(body);
  } catch {
    return true;
  }
}
