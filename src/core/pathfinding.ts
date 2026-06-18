/**
 * A* pathfinding over a {@link TileGrid}.
 *
 * Pure logic: no Phaser, no DOM. Returns a path of {@link GridCoord}s from start
 * to goal (inclusive of both) along 4-connected walkable tiles, or `null` if no
 * path exists. Uniform step cost with a Manhattan-distance heuristic — admissible
 * for orthogonal movement, so A* returns a shortest path.
 */

import { tileKey, type GridCoord } from "./iso";
import type { TileGrid } from "./grid";

/** Manhattan distance — the admissible heuristic for 4-connected movement. */
function manhattan(a: GridCoord, b: GridCoord): number {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

/**
 * Find a shortest walkable path from `start` to `goal`.
 *
 * @returns the path including both endpoints (`[start, ..., goal]`), or `null`
 *   if either endpoint is unwalkable or no route connects them. When
 *   `start === goal` (and walkable) the path is a single tile.
 */
export function findPath(
  grid: TileGrid,
  start: GridCoord,
  goal: GridCoord,
): GridCoord[] | null {
  if (!grid.isWalkable(start) || !grid.isWalkable(goal)) {
    return null;
  }
  if (start.col === goal.col && start.row === goal.row) {
    return [start];
  }

  const startKey = tileKey(start);
  const openSet = new Map<string, GridCoord>([[startKey, start]]);
  const cameFrom = new Map<string, GridCoord>();
  const gScore = new Map<string, number>([[startKey, 0]]);
  const fScore = new Map<string, number>([[startKey, manhattan(start, goal)]]);

  while (openSet.size > 0) {
    // Pick the open tile with the lowest fScore (linear scan — grids here are
    // small; a binary heap is a later optimisation if maps grow).
    let currentKey: string | undefined;
    let current: GridCoord | undefined;
    let best = Infinity;
    for (const [k, coord] of openSet) {
      const f = fScore.get(k) ?? Infinity;
      if (f < best) {
        best = f;
        currentKey = k;
        current = coord;
      }
    }
    if (!current || currentKey === undefined) break;

    if (current.col === goal.col && current.row === goal.row) {
      return reconstruct(cameFrom, current);
    }

    openSet.delete(currentKey);
    const currentG = gScore.get(currentKey) ?? Infinity;

    for (const neighbor of grid.walkableNeighbors(current)) {
      const neighborKey = tileKey(neighbor);
      const tentativeG = currentG + 1;
      if (tentativeG < (gScore.get(neighborKey) ?? Infinity)) {
        cameFrom.set(neighborKey, current);
        gScore.set(neighborKey, tentativeG);
        fScore.set(neighborKey, tentativeG + manhattan(neighbor, goal));
        if (!openSet.has(neighborKey)) {
          openSet.set(neighborKey, neighbor);
        }
      }
    }
  }

  return null;
}

/** Walk the cameFrom chain back to the start to build the ordered path. */
function reconstruct(
  cameFrom: Map<string, GridCoord>,
  goal: GridCoord,
): GridCoord[] {
  const path: GridCoord[] = [goal];
  let current = goal;
  let prev = cameFrom.get(tileKey(current));
  while (prev) {
    path.unshift(prev);
    current = prev;
    prev = cameFrom.get(tileKey(current));
  }
  return path;
}
