const PLAYER_COLORS = [0xff6b6b, 0x4ecdc4, 0xffe66d, 0x95e1d3, 0xdda0dd, 0x98d8c8];

/** Stable boat tint from a player id (same algorithm as multiplayer client). */
export function playerIdToColor(playerId: string): number {
  let hash = 0;
  for (let index = 0; index < playerId.length; index++) {
    hash = playerId.charCodeAt(index) + ((hash << 5) - hash);
  }
  return PLAYER_COLORS[Math.abs(hash) % PLAYER_COLORS.length];
}
