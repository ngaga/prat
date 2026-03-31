/**
 * Legacy helper (unused elsewhere). Prefer simulationSpace + simulationToDisplay for coordinates.
 * Kept as a neutral 1:1 pass-through; do not mix with display pixel assumptions.
 */
export interface Vector2D {
  x: number;
  y: number;
}

export class WorldSpace {
  static readonly TILE_SIZE = 1;

  static worldToScreen(worldPosition: Vector2D): Vector2D {
    return {
      x: worldPosition.x * this.TILE_SIZE,
      y: worldPosition.y * this.TILE_SIZE,
    };
  }

  static screenToWorld(screenPosition: Vector2D): Vector2D {
    return {
      x: screenPosition.x / this.TILE_SIZE,
      y: screenPosition.y / this.TILE_SIZE,
    };
  }
}
