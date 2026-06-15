import type { Unit } from "./units";
import type { GridCoord } from "./iso";
import type { TileGrid } from "./grid";
import { occupiedGrid, reachableTiles } from "./ai";
import { findPath } from "./pathfinding";
import { inAttackRange, effectiveMove, manhattan, computeDamage, computeFlankBonus } from "./combat";
import { isImmobilized } from "./status";

/** A planned player action: a path to walk and, optionally, a foe to strike on arrival. */
export interface MovePlan {
  /** Tiles to step through after the start tile (may be empty — strike in place). */
  path: GridCoord[];
  /** The foe to attack on arrival, or `null` for a pure move. */
  attackTarget: Unit | null;
}

/**
 * Plan a player **move** to `tile`: the walkable path (excluding the start tile),
 * clamped to the unit's effective move this turn. Returns `null` when the tile is
 * unreachable. Pure — the scene commits the result; this is the planning half the
 * demo and mission scenes share.
 */
export function planMove(actor: Unit, tile: GridCoord, units: readonly Unit[], grid: TileGrid): GridCoord[] | null {
  const nav = occupiedGrid(grid, units, [actor]);
  const path = findPath(nav, actor.pos, tile);
  if (!path || path.length < 2) return null;
  return path.slice(1).slice(0, effectiveMove(actor));
}

/**
 * Plan a player **attack** on `foe`: if already in attack range, strike in place;
 * otherwise close along the path — stopping one tile short of the foe, clamped to
 * the move budget — and strike iff the destination lands within attack range.
 * Returns `null` when there's no path to the foe.
 */
export function planAttack(actor: Unit, foe: Unit, units: readonly Unit[], grid: TileGrid): MovePlan | null {
  if (inAttackRange(actor, foe)) return { path: [], attackTarget: foe };
  const nav = occupiedGrid(grid, units, [actor, foe]);
  const path = findPath(nav, actor.pos, foe.pos);
  if (!path || path.length < 2) return null;
  const approach = path.slice(1, -1).slice(0, effectiveMove(actor));
  const dest = approach.length > 0 ? approach[approach.length - 1] : actor.pos;
  return { path: approach, attackTarget: manhattan(dest, foe.pos) <= actor.attackRange ? foe : null };
}

/** The best-case outcome of `actor`'s basic attack on `foe` this turn (telegraphing). */
export interface AttackForecast {
  /** Highest damage `actor` could deal `foe` from any tile it can strike from this turn. */
  damage: number;
  /** True if that best strike would drop the foe (`damage >= foe.hp`). */
  lethal: boolean;
  /** True if the best strike earns a melee flank bonus (D36). */
  flank: boolean;
}

/**
 * **Forecast** `actor`'s basic attack on `foe` this turn — the *information* a
 * player needs before committing: how hard the hit would land, whether it kills,
 * and whether a flank is on the table. Scans every tile the actor could strike
 * from (in place, or any reachable tile within attack range) and keeps the best
 * damage, so it answers "what's the most I can do to that foe right now?". Returns
 * `null` when the foe can't be reached and struck this turn.
 *
 * Pure: to reuse the canonical damage/flank maths (which read `actor.pos`) it
 * relocates the actor to each candidate tile and restores the original position
 * before returning — no observable mutation.
 */
export function forecastAttack(actor: Unit, foe: Unit, units: readonly Unit[], grid: TileGrid): AttackForecast | null {
  const candidates: GridCoord[] = [actor.pos]; // strike in place
  if (!isImmobilized(actor)) {
    for (const r of reachableTiles(actor, units, grid, effectiveMove(actor))) candidates.push(r.tile);
  }
  const origin = actor.pos;
  let best: AttackForecast | null = null;
  for (const tile of candidates) {
    if (manhattan(tile, foe.pos) > actor.attackRange) continue;
    actor.pos = tile;
    const damage = computeDamage(actor, foe, actor.attack, units);
    if (!best || damage > best.damage) best = { damage, lethal: damage >= foe.hp, flank: computeFlankBonus(actor, foe, units) > 0 };
  }
  actor.pos = origin;
  return best;
}

/**
 * The tiles `actor` could move to this turn (its own included) **from which it
 * would earn a melee flank** on some adjacent foe — the spatial half of the flank
 * telegraph: stand here to gang the target. Empty for a ranged unit (can't flank)
 * or when no reachable tile sets up a flank. Pure (relocates + restores the actor).
 */
export function flankTiles(actor: Unit, units: readonly Unit[], grid: TileGrid): GridCoord[] {
  if (actor.attackRange > 1 || isImmobilized(actor)) return [];
  const foes = units.filter((u) => u.alive && !u.captured && u.side !== actor.side);
  if (foes.length === 0) return [];
  const tiles = [actor.pos, ...reachableTiles(actor, units, grid, effectiveMove(actor)).map((r) => r.tile)];
  const origin = actor.pos;
  const out: GridCoord[] = [];
  for (const tile of tiles) {
    actor.pos = tile;
    if (foes.some((f) => manhattan(tile, f.pos) === 1 && computeFlankBonus(actor, f, units) > 0)) out.push(tile);
  }
  actor.pos = origin;
  return out;
}
