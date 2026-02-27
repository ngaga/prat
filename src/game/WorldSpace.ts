/**
 * World coordinate system.
 * 1 unit = 1 pixel (TILE_SIZE=1). Can be changed for tile-based logic.
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
