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
 * A rectangular tile grid. Tiles are stored row-major in **two layers**: an immutable
 * `wall` layer (permanent authored terrain, fixed at construction) and a runtime-mutable
 * `blocked` **overlay** (the D103 gate layer). A tile is walkable only when *neither* layer
 * blocks it, so the base wall always wins — opening a gate that happens to sit on a wall tile
 * clears the overlay but leaves the wall standing (it never punches a hole in the terrain).
 */
export class TileGrid {
  readonly cols: number;
  readonly rows: number;
  /** Permanent authored walls (immutable) — a `true` here blocks the tile forever. */
  private readonly wall: boolean[][];
  /** Runtime gate overlay (D103) — {@link setWalkable} toggles this; it never touches {@link wall}. */
  private readonly blocked: boolean[][];

  /**
   * @param cols   number of columns (x / horizontal extent)
   * @param rows   number of rows (y / vertical extent)
   * @param blocked optional list of permanently-impassable (wall) tiles
   */
  constructor(cols: number, rows: number, blocked: readonly GridCoord[] = []) {
    if (cols <= 0 || rows <= 0) {
      throw new Error(`TileGrid needs positive dimensions, got ${cols}x${rows}`);
    }
    this.cols = cols;
    this.rows = rows;
    this.wall = Array.from({ length: rows }, () =>
      new Array<boolean>(cols).fill(false),
    );
    this.blocked = Array.from({ length: rows }, () =>
      new Array<boolean>(cols).fill(false),
    );
    for (const { col, row } of blocked) {
      if (this.inBounds({ col, row })) {
        this.wall[row][col] = true;
      }
    }
  }

  /** True if the coordinate lies on the grid. */
  inBounds({ col, row }: GridCoord): boolean {
    return col >= 0 && col < this.cols && row >= 0 && row < this.rows;
  }

  /** True if the tile is on the grid and blocked by neither the wall layer nor the gate overlay. */
  isWalkable(coord: GridCoord): boolean {
    return (
      this.inBounds(coord) &&
      !this.wall[coord.row][coord.col] &&
      !this.blocked[coord.row][coord.col]
    );
  }

  /**
   * Set a tile's **overlay** walkability at runtime (D103) — the seam a **gate** toggles: a locked
   * gate blocks its tile, opening it clears the block. This only touches the gate overlay, **never**
   * the permanent wall layer: `setWalkable(wallTile, true)` is inert (the wall still blocks), so a
   * gate opening on a wall tile can't dissolve the terrain. In-bounds only; a no-op off the grid.
   * (Movement is derived from {@link isWalkable}, so pathing/reach pick the change up for free.)
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
