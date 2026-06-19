/**
 * Isometric coordinate math.
 *
 * Pure logic: no Phaser, no DOM. Everything here is a plain function over plain
 * data so it can be unit-tested headlessly and reused unchanged inside any
 * platform shell (web now; Tauri/Electron/Capacitor later). The render layer in
 * `game/` is the only thing that turns these numbers into pixels.
 */

/** A tile address on the logical grid. */
export interface GridCoord {
  readonly col: number;
  readonly row: number;
}

/** Stable string key for a tile, for use in `Map`/`Set` keys. */
export function tileKey(c: GridCoord): string {
  return `${c.col},${c.row}`;
}

/** Chebyshev (king-move) distance between two tiles — a square radius metric. */
export function chebyshev(a: GridCoord, b: GridCoord): number {
  return Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
}

/**
 * The four orthogonal (4-connected) neighbour offsets, in the canonical
 * **up / right / down / left** order the grid relies on for deterministic paths.
 */
export const ORTHO_OFFSETS: readonly GridCoord[] = [
  { col: 0, row: -1 }, // up
  { col: 1, row: 0 }, // right
  { col: 0, row: 1 }, // down
  { col: -1, row: 0 }, // left
];

/**
 * The four orthogonal neighbours of a tile (no diagonals, **no** walkability
 * filter), in the canonical order. {@link "./grid".TileGrid.walkableNeighbors}
 * filters this to the passable ones; aura/ring code that ignores blocking (the
 * tarpit ring) maps it straight into a key set.
 */
export function orthoNeighbors(c: GridCoord): GridCoord[] {
  return ORTHO_OFFSETS.map((d) => ({ col: c.col + d.col, row: c.row + d.row }));
}

/** A point in screen/world space, in pixels. */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** Default isometric tile footprint (2:1 diamond). */
export const TILE_WIDTH = 64;
export const TILE_HEIGHT = 32;

/**
 * Project a grid coordinate to an isometric screen point.
 *
 * Standard 2:1 diamond projection: moving one column pushes right+down, moving
 * one row pushes left+down, so the grid reads as a diamond rather than a square.
 */
export function gridToScreen(
  coord: GridCoord,
  tileWidth: number = TILE_WIDTH,
  tileHeight: number = TILE_HEIGHT,
): ScreenPoint {
  const halfW = tileWidth / 2;
  const halfH = tileHeight / 2;
  return {
    x: (coord.col - coord.row) * halfW,
    y: (coord.col + coord.row) * halfH,
  };
}

/**
 * Inverse of {@link gridToScreen}: recover the (fractional) grid coordinate that
 * a screen point falls on. Callers round to land on a specific tile.
 */
export function screenToGrid(
  point: ScreenPoint,
  tileWidth: number = TILE_WIDTH,
  tileHeight: number = TILE_HEIGHT,
): GridCoord {
  const halfW = tileWidth / 2;
  const halfH = tileHeight / 2;
  const col = (point.x / halfW + point.y / halfH) / 2;
  const row = (point.y / halfH - point.x / halfW) / 2;
  return { col, row };
}
