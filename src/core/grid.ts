/**
 * Tile-grid model.
 *
 * Pure logic: no Phaser, no DOM. A rectangular grid of tiles, each either
 * walkable or blocking. The render layer in `game/` paints it; pathfinding in
 * `pathfinding.ts` walks it. Coordinates reuse {@link GridCoord} from `iso.ts`
 * so the same address that projects to a screen point also indexes a tile.
 */

import { orthoNeighbors, type GridCoord } from "./iso";

/**
 * A rectangular tile grid. Tiles are stored row-major; `blocked[row][col]` is
 * `true` for an impassable tile. The grid is immutable after construction —
 * walkability is fixed for the lifetime of the model (M2 has no terrain edits).
 */
export class TileGrid {
  readonly cols: number;
  readonly rows: number;
  private readonly blocked: boolean[][];

  /**
   * @param cols   number of columns (x / horizontal extent)
   * @param rows   number of rows (y / vertical extent)
   * @param blocked optional list of impassable tiles
   */
  constructor(cols: number, rows: number, blocked: readonly GridCoord[] = []) {
    if (cols <= 0 || rows <= 0) {
      throw new Error(`TileGrid needs positive dimensions, got ${cols}x${rows}`);
    }
    this.cols = cols;
    this.rows = rows;
    this.blocked = Array.from({ length: rows }, () =>
      new Array<boolean>(cols).fill(false),
    );
    for (const { col, row } of blocked) {
      if (this.inBounds({ col, row })) {
        this.blocked[row][col] = true;
      }
    }
  }

  /** True if the coordinate lies on the grid. */
  inBounds({ col, row }: GridCoord): boolean {
    return col >= 0 && col < this.cols && row >= 0 && row < this.rows;
  }

  /** True if the tile is on the grid and not blocking. */
  isWalkable(coord: GridCoord): boolean {
    return this.inBounds(coord) && !this.blocked[coord.row][coord.col];
  }

  /**
   * Set a tile's walkability at runtime (D103) — the seam a **gate** toggles: a locked gate blocks
   * its tile, opening it clears the block. In-bounds only; a no-op off the grid. (Movement is
   * derived from {@link isWalkable}, so pathing/reach pick the change up for free.)
   */
  setWalkable(coord: GridCoord, walkable: boolean): void {
    if (this.inBounds(coord)) this.blocked[coord.row][coord.col] = !walkable;
  }

  /**
   * The 4-connected walkable neighbours of a tile (no diagonals — tactics
   * movement is orthogonal in M2). Returns them in a stable order so paths are
   * deterministic.
   */
  walkableNeighbors(coord: GridCoord): GridCoord[] {
    return orthoNeighbors(coord).filter((c) => this.isWalkable(c));
  }
}
