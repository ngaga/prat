import { getBackendBaseUrl } from "@/lib/backendBaseUrl";

const sessionStorageWarmupKey = "prat-backend-warmed";
let hasAttemptedWarmup = false;

/**
 * Warm up the backend service once per browser session.
 * This runs in background and never throws to avoid blocking UI flow.
 */
export async function warmupBackendOncePerSession(): Promise<void> {
  if (hasAttemptedWarmup) {
    return;
  }
  hasAttemptedWarmup = true;

  if (typeof window === "undefined") {
    return;
  }

  if (window.sessionStorage.getItem(sessionStorageWarmupKey) === "1") {
    return;
  }

  const baseUrl = getBackendBaseUrl();
  if (!baseUrl) {
    return;
  }

  try {
    await fetch(`${baseUrl}/api/feature-flags/octopuses`, { cache: "no-store" });
  } catch {
    // Ignore: the first request can fail during cold start.
  } finally {
    window.sessionStorage.setItem(sessionStorageWarmupKey, "1");
  }
}
