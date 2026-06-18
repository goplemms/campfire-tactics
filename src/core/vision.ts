/**
 * Vision seam (D18) — the in-battle fog-of-war layer, laid thin in M3.
 *
 * Computes a per-side visible tile set from each unit's `sightRadius` and exposes
 * `canSee(side, tile)` for targeting/AI to consult. Line-of-sight is **stubbed**
 * in M3 (radius only); the full Hidden → Pinged → Seen ladder, ghosts and
 * ambush arrive in a later milestone. The point now is the layer, not the rules.
 *
 * Pure logic: no Phaser, no DOM.
 */

import type { Unit, Side } from "./units";
import { tileKey, chebyshev, type GridCoord } from "./iso";

/**
 * The set of tiles a side can currently see: the union of each living unit's
 * sight radius (LoS stubbed in M3). Keys are {@link tileKey} strings.
 */
export function computeVisibleTiles(
  units: readonly Unit[],
  side: Side,
): Set<string> {
  const visible = new Set<string>();
  for (const u of units) {
    if (!u.alive || u.side !== side) continue;
    const r = u.sightRadius;
    for (let dc = -r; dc <= r; dc++) {
      for (let dr = -r; dr <= r; dr++) {
        const tile = { col: u.pos.col + dc, row: u.pos.row + dr };
        if (chebyshev(u.pos, tile) <= r) visible.add(tileKey(tile));
      }
    }
  }
  return visible;
}

/** Whether a side can see a tile right now. */
export function canSee(
  units: readonly Unit[],
  side: Side,
  tile: GridCoord,
): boolean {
  for (const u of units) {
    if (!u.alive || u.side !== side) continue;
    if (chebyshev(u.pos, tile) <= u.sightRadius) return true;
  }
  return false;
}
