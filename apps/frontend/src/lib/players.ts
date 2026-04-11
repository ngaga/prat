import { getBackendBaseUrl } from "@/lib/backendBaseUrl";

/** Parse JSON only when the body is non-empty (Nest may send an empty body for `return null`). */
async function parseResponseJsonOrNull<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

export interface Player {
  id: string;
  name: string;
  exp: number;
  level: number;
  kills_octopus: number;
  kills_stingray: number;
  prats_captured?: number;
  is_ghost?: boolean;
  ghost_prats_captured?: number;
}

export async function getPlayerByName(name: string): Promise<Player | null> {
  try {
    const base = getBackendBaseUrl();
    if (!base) {
      return null;
    }
    const response = await fetch(`${base}/api/players/${encodeURIComponent(name.trim())}`);
    if (!response.ok) {
      return null;
    }
    return await parseResponseJsonOrNull<Player>(response);
  } catch (error) {
    console.error("getPlayerByName error:", error);
    return null;
  }
}

export async function upsertPlayer(player: {
  name: string;
  exp: number;
  level: number;
  kills_octopus?: number;
  kills_stingray?: number;
  prats_captured?: number;
  is_ghost?: boolean;
  ghost_prats_captured?: number;
}): Promise<boolean> {
  try {
    const base = getBackendBaseUrl();
    if (!base) {
      return false;
    }
    const response = await fetch(`${base}/api/players`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: player.name.trim(),
        exp: player.exp,
        level: player.level,
        kills_octopus: player.kills_octopus ?? 0,
        kills_stingray: player.kills_stingray ?? 0,
        prats_captured: player.prats_captured ?? 0,
        is_ghost: player.is_ghost ?? false,
        ghost_prats_captured: player.ghost_prats_captured ?? 0,
      }),
    });
    const result = await parseResponseJsonOrNull<{ success: boolean; error?: string }>(response);
    if (!result) {
      return false;
    }
    return result.success === true;
  } catch (error) {
    console.error("upsertPlayer error:", error);
    return false;
  }
}
