/**
 * Nest API base URL (Supabase-backed routes).
 * In dev, `scripts/dev.sh` sets NEXT_PUBLIC_NEST_PORT from PORT (e.g. Cursor preview = 10000)
 * then unsets PORT so Next keeps port 3000 while the browser still targets Nest.
 */
export function getBackendBaseUrl(): string {
  const serverOnlyOverride = process.env.BACKEND_URL?.trim();
  if (serverOnlyOverride) {
    return serverOnlyOverride.replace(/\/$/, "");
  }
  const publicUrl = process.env.NEXT_PUBLIC_BACKEND_URL?.trim();
  if (publicUrl) {
    return publicUrl.replace(/\/$/, "");
  }
  if (process.env.NODE_ENV === "development") {
    const nestPort = process.env.NEXT_PUBLIC_NEST_PORT?.trim();
    if (nestPort && /^\d+$/.test(nestPort)) {
      return `http://127.0.0.1:${nestPort}`;
    }
    return "http://127.0.0.1:3001";
  }
  return "";
}
