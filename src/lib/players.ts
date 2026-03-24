export interface Player {
  id: string;
  name: string;
  exp: number;
  level: number;
  kills_octopus: number;
  kills_stingray: number;
  is_ghost?: boolean;
  ghost_prats_captured?: number;
}

export async function getPlayerByName(name: string): Promise<Player | null> {
  try {
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
    const response = await fetch(`${baseUrl}/api/players/${encodeURIComponent(name.trim())}`);
    const data = (await response.json()) as Player | null;
    return data;
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
  is_ghost?: boolean;
  ghost_prats_captured?: number;
}): Promise<boolean> {
  try {
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
    const response = await fetch(`${baseUrl}/api/players`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: player.name.trim(),
        exp: player.exp,
        level: player.level,
        kills_octopus: player.kills_octopus ?? 0,
        kills_stingray: player.kills_stingray ?? 0,
        is_ghost: player.is_ghost ?? false,
        ghost_prats_captured: player.ghost_prats_captured ?? 0,
      }),
    });
    const result = (await response.json()) as { success: boolean; error?: string };
    return result.success;
  } catch (error) {
    console.error("upsertPlayer error:", error);
    return false;
  }
}
