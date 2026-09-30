/**
 * **Party placement** — where the party stands when a battle opens. The one decision
 * ({@link placeStartingParty}) picks among the three policies: an explicit spawn override, the
 * authored **primary spawn zone** (D119), the level's fixed spawn tiles, or the procedural **auto
 * home edge**.
 *
 * Pure logic: no Phaser, no DOM, no `Math.random`.
 */

import type { GridCoord } from "./iso";
import type { Unit } from "./units";
import type { TileGrid } from "./grid";
import { primaryZone, type SpawnZone } from "./deployment";
import type { EncounterLayout } from "./encounter-layout";

/** Place the party at fixed spawn tiles (extras stack on the last). */
export function placeParty(party: readonly Unit[], spawns: readonly GridCoord[]): void {
  party.forEach((u, i) => {
    const s = spawns[Math.min(i, spawns.length - 1)] ?? { col: 0, row: 0 };
    u.pos = { col: s.col, row: s.row };
  });
}

/**
 * Place the whole party in the **primary** zone (D119) — the default that replaces
 * {@link placeParty}'s roster-order index-map for a zoned encounter.
 *
 * This is the fix, not a tidy-up: index-mapping `party[i] → spawns[i]` meant the finale's
 * first authored spawn (the side door) went to whoever happened to be first in the roster —
 * a Soldier, who cannot pick the cells — while the Thief started at the far mouth. Everyone
 * defaults to the primary zone with the other zones **EMPTY**; sending someone to the side
 * door is then a deliberate act (the entrance verb), and "I scouted but I'm still going in
 * the front" stays a legal play. Extras stack on the last tile, as `placeParty` always has.
 */
export function placeInZone(party: readonly Unit[], zone: SpawnZone): void {
  placeParty(party, zone.tiles);
}

/**
 * Place player combatants on the home (left) edge, auto-filling walkable tiles —
 * the procedural placement policy (extracted from the old `RunLoop.placePlayers`).
 * `deploymentPenalty` pushes the home edge inward (fewer setup columns).
 */
export function placePlayersAutoEdge(
  players: readonly Unit[],
  grid: TileGrid,
  blocked: readonly GridCoord[],
  rows: number,
  deploymentPenalty = 0,
): void {
  const homeCols = Math.max(1, 2 - Math.min(1, deploymentPenalty));
  const taken = new Set<string>();
  for (const b of blocked) taken.add(`${b.col},${b.row}`);
  players.forEach((u, i) => {
    let pos: GridCoord = { col: i % homeCols, row: i % rows };
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < homeCols; col++) {
        const key = `${col},${row}`;
        if (!taken.has(key) && grid.isWalkable({ col, row })) {
          pos = { col, row };
          taken.add(key);
          row = rows;
          break;
        }
      }
    }
    taken.add(`${pos.col},${pos.row}`);
    u.pos = pos;
  });
}

/** How a caller can steer the opening placement. */
export interface PlacementOptions {
  /** Explicit spawn tiles — override every other policy (the scenario / level harnesses). */
  playerSpawns?: readonly GridCoord[];
  /** The D9 rescue "ambush-in-reverse": fewer home columns on the auto edge. Fixed spawns ignore it. */
  deploymentPenalty?: number;
}

/**
 * Put the party on the board for the layout's opening: an explicit override wins; else a zoned
 * level starts everyone in its primary zone; else the level's fixed spawns; else the auto home edge.
 */
export function placeStartingParty(players: readonly Unit[], layout: EncounterLayout, grid: TileGrid, opts: PlacementOptions = {}): void {
  if (opts.playerSpawns) return placeParty(players, opts.playerSpawns);
  const primary = primaryZone(layout.spawnZones);
  if (primary) return placeInZone(players, primary);
  if (layout.playerSpawns) return placeParty(players, layout.playerSpawns);
  placePlayersAutoEdge(players, grid, layout.blocked, layout.rows, opts.deploymentPenalty);
}
