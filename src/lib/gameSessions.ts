export interface EndGameSessionPayload {
  actionsCount: number;
  expGained: number;
  killsOctopus: number;
  killsStingray: number;
  ghostPratsCaptured: number;
  disconnectedUnexpectedly: boolean;
}

export async function startGameSession(playerId: string): Promise<string | null> {
  try {
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
    const response = await fetch(`${baseUrl}/api/game-sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    const data = (await response.json()) as { sessionId?: string; error?: string };
    if (!response.ok) {
      console.error("startGameSession error:", data.error);
      return null;
    }
    return data.sessionId ?? null;
  } catch (error) {
    console.error("startGameSession error:", error);
    return null;
  }
}

/**
 * Persists session end; uses keepalive so the request can finish during tab close.
 */
export function endGameSession(sessionId: string, payload: EndGameSessionPayload): void {
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const body = JSON.stringify(payload);
  try {
    void fetch(`${baseUrl}/api/game-sessions/${encodeURIComponent(sessionId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Ignore (e.g. worker context)
  }
}
