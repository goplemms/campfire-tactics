/**
 * The scoring combat AI (D42) — a light "enumerate, score, pick" planner.
 *
 * On its turn a unit enumerates the `(destination, action)` plans it can reach,
 * scores each by a heuristic, and takes the best. Every behavior falls out of
 * the **weights** ({@link AI}): ranged attacks (hit from `attackRange` without
 * closing), **flank exploit + avoid** (gang an isolated foe; don't get isolated),
 * **tarpit-cost pathing** (route around the Heavy Knight's ring), **target
 * priority** (squishy / wounded / Exposed over literally-nearest), plus the
 * in-scope optional layers: **enemy ability use** (apply a debuff), **fog-
 * respecting** play (act only on `canSee`n foes; advance/search toward unseen),
 * and **charge-interrupt** awareness (via `opts.isCharging`).
 *
 * Pure logic: no Phaser, no DOM. {@link planEnemyTurn} returns a *plan* without
 * mutating the board (it temporarily probes positions and restores them); the
 * {@link "./turn".Battle} executes it. "Enemy" just means the opposite side, so
 * the same planner can fast-forward either side headlessly.
 */

import type { Unit, Side } from "./units";
import type { GridCoord } from "./iso";
import type { SkillDef } from "./skills";
import { TileGrid } from "./grid";
import { findPath } from "./pathfinding";
import {
  manhattan,
  computeDamage,
  adjacentBodies,
  PASSIVE,
} from "./combat";
import { isImmobilized, isDebuffed, hasStatus, EXPOSED } from "./status";
import { tileKey, canSee } from "./vision";
import { unitSkills } from "./jobs";

/** Scoring weights — all tunable data, a numbers pass later (D42). */
export const AI = {
  /** Any landed action dominates pure positioning. */
  actionBase: 1000,
  /** Value per point of damage an attack would deal. */
  perDamage: 4,
  /** Bonus for an attack that would kill (focus the finish). */
  lethalBonus: 400,
  /** Target priority: prefer a frailer max-HP body. */
  squishyWeight: 1,
  /** Target priority: prefer an already-wounded body. */
  lowHpWeight: 2,
  /** Target priority: an Exposed/debuffed target is worth finishing. */
  debuffedBonus: 30,
  /** Value of landing a debuff ability (the snare). */
  debuffValue: 600,
  /** Charge-interrupt: bonus for hitting a committed (charging) caster. */
  chargeInterrupt: 200,
  /** Flank-avoid: penalty for ending isolated next to the foe (per adjacent foe). */
  isolationPenalty: 50,
  /** Movement cost to step onto a Heavy Knight's tarpit ring tile (vs 1 normal). */
  ringCost: 4,
  /** Tiny per-move-cost penalty so equal plans prefer the shorter walk. */
  movePenalty: 1,
  /** Weight on closing distance when no action is available (advance/search). */
  approachWeight: 4,
} as const;

/** A turn the AI intends to take. */
export interface AIPlan {
  unit: Unit;
  /** Tiles to step through this turn (excludes the start tile). May be empty. */
  path: GridCoord[];
  /** Where the unit ends up (its current tile if it doesn't move). */
  destination: GridCoord;
  /** The foe to act on from the destination, or null if none in reach. */
  target: Unit | null;
  /** An ability to use on `target` instead of a basic attack (D42 enemy abilities). */
  ability?: SkillDef;
}

/** Optional planner inputs the {@link "./turn".Battle} can supply (D42). */
export interface AIOptions {
  /** True if `unit` is committed to an in-flight charge/channel (interrupt bonus). */
  isCharging?: (u: Unit) => boolean;
}

/**
 * A copy of `grid` with every unit's tile blocked, except those in `allow`.
 * Lets A* route between units without walking through them (the render still uses
 * it for player movement / rescue / approach).
 */
export function occupiedGrid(
  grid: TileGrid,
  units: readonly Unit[],
  allow: readonly Unit[] = [],
): TileGrid {
  const blocked: GridCoord[] = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      if (!grid.isWalkable({ col, row })) blocked.push({ col, row });
    }
  }
  for (const u of units) {
    if (u.alive && !allow.includes(u)) blocked.push({ col: u.pos.col, row: u.pos.row });
  }
  return new TileGrid(grid.cols, grid.rows, blocked);
}

/** A reachable destination with its movement cost and the path to it. */
export interface Reach {
  tile: GridCoord;
  cost: number;
  path: GridCoord[];
}

/** Tiles that cost extra to enter — a foe's Heavy Knight tarpit ring (D42). */
function ringTilesAgainst(unit: Unit, units: readonly Unit[]): Set<string> {
  const ring = new Set<string>();
  for (const u of units) {
    if (!u.alive || u.captured || u.side === unit.side || !u.passives[PASSIVE.tarpit]) continue;
    for (const nb of [
      { col: u.pos.col + 1, row: u.pos.row },
      { col: u.pos.col - 1, row: u.pos.row },
      { col: u.pos.col, row: u.pos.row + 1 },
      { col: u.pos.col, row: u.pos.row - 1 },
    ]) {
      ring.add(tileKey(nb));
    }
  }
  return ring;
}

/**
 * Cost-limited flood (Dijkstra) of the tiles `unit` can reach this turn within
 * its move budget, treating tarpit-ring tiles as high-cost. Includes the start
 * tile (cost 0). Other living units block tiles. The render layer reuses this to
 * tint the move-range preview (pass `budget = effectiveMove(unit)` so the preview
 * accounts for a Swift buff; the AI uses the default base `moveRange`).
 */
export function reachableTiles(
  unit: Unit,
  units: readonly Unit[],
  grid: TileGrid,
  budget: number = isImmobilized(unit) ? 0 : unit.moveRange,
): Reach[] {
  const occupied = new Set(
    units.filter((u) => u.alive && u !== unit).map((u) => tileKey(u.pos)),
  );
  const ring = ringTilesAgainst(unit, units);
  const best = new Map<string, Reach>();
  const start: Reach = { tile: unit.pos, cost: 0, path: [] };
  best.set(tileKey(unit.pos), start);
  const frontier: Reach[] = [start];
  while (frontier.length > 0) {
    frontier.sort((a, b) => a.cost - b.cost);
    const cur = frontier.shift()!;
    if (cur.cost > (best.get(tileKey(cur.tile))?.cost ?? Infinity)) continue;
    for (const nb of grid.walkableNeighbors(cur.tile)) {
      const k = tileKey(nb);
      if (occupied.has(k)) continue;
      const next = cur.cost + (ring.has(k) ? AI.ringCost : 1);
      if (next > budget) continue;
      if (next < (best.get(k)?.cost ?? Infinity)) {
        const r: Reach = { tile: nb, cost: next, path: [...cur.path, nb] };
        best.set(k, r);
        frontier.push(r);
      }
    }
  }
  return [...best.values()];
}

/** Damage `unit` would deal to `foe` **if it stood at `from`** (flank-aware). */
function damageFrom(unit: Unit, from: GridCoord, foe: Unit, units: readonly Unit[]): number {
  const saved = unit.pos;
  unit.pos = from;
  const dmg = computeDamage(unit, foe, unit.attack, units);
  unit.pos = saved;
  return dmg;
}

/** Target-priority bonus: frailer + more wounded + already-debuffed bodies. */
function priority(foe: Unit): number {
  let p = AI.squishyWeight * Math.max(0, 40 - foe.maxHp);
  p += AI.lowHpWeight * Math.max(0, 30 - foe.hp);
  if (hasStatus(foe, EXPOSED) || isDebuffed(foe)) p += AI.debuffedBonus;
  return p;
}

/** Flank-avoid penalty for ending at `from`: isolated next to the foe (D42). */
function isolationPenalty(unit: Unit, from: GridCoord, units: readonly Unit[]): number {
  const saved = unit.pos;
  unit.pos = from;
  const foesAdjacent = adjacentBodies(unit, units, unit.side === "player" ? "enemy" : "player");
  const alliesAdjacent = adjacentBodies(unit, units, unit.side);
  unit.pos = saved;
  return alliesAdjacent === 0 ? AI.isolationPenalty * foesAdjacent : 0;
}

/** A debuff ability the unit can use on a foe (a status-debuff battle skill). */
function debuffAbility(unit: Unit): SkillDef | undefined {
  return unitSkills(unit, "battle").find(
    (s) =>
      s.target === "enemy" &&
      s.effect.kind === "status" &&
      s.effect.status.kind === "debuff",
  );
}

/**
 * Plan a turn for `unit`: enumerate reachable destinations, score the best action
 * (ranged/melee attack, a debuff ability, or pure advance) at each, and pick the
 * highest. Fog-respecting — attacks only **seen** foes; with none seen it
 * advances toward the nearest (the search fallback).
 */
export function planEnemyTurn(
  unit: Unit,
  units: readonly Unit[],
  grid: TileGrid,
  opts: AIOptions = {},
): AIPlan {
  const side = unit.side;
  const foes = units.filter((u) => u.alive && !u.captured && u.side !== side);
  const stay: AIPlan = { unit, path: [], destination: unit.pos, target: null };
  if (foes.length === 0) return stay;

  const seen = foes.filter((f) => canSee(units, side, f.pos));
  const ability = debuffAbility(unit);
  const dests = reachableTiles(unit, units, grid);

  let bestPlan: AIPlan = stay;
  let bestScore = -Infinity;

  for (const d of dests) {
    const movePart = -d.cost * AI.movePenalty - isolationPenalty(unit, d.tile, units);
    let actionScore = -Infinity;
    let actTarget: Unit | null = null;
    let actAbility: SkillDef | undefined;

    for (const foe of seen) {
      const dist = manhattan(d.tile, foe.pos);
      // A basic attack from this destination (ranged honors attackRange).
      if (dist <= unit.attackRange) {
        const dmg = damageFrom(unit, d.tile, foe, units);
        let s = AI.actionBase + dmg * AI.perDamage + priority(foe);
        if (dmg >= foe.hp) s += AI.lethalBonus;
        if (opts.isCharging?.(foe)) s += AI.chargeInterrupt;
        if (s > actionScore) {
          actionScore = s;
          actTarget = foe;
          actAbility = undefined;
        }
      }
      // A debuff ability (the snare) on a foe in its range — value undebuffed prey.
      if (ability && dist <= ability.range && !isDebuffed(foe)) {
        let s = AI.actionBase + AI.debuffValue + priority(foe);
        if (opts.isCharging?.(foe)) s += AI.chargeInterrupt;
        if (s > actionScore) {
          actionScore = s;
          actTarget = foe;
          actAbility = ability;
        }
      }
    }

    let score: number;
    if (actTarget) {
      score = actionScore + movePart;
    } else {
      // No action: advance toward the nearest foe (seen, else search any).
      const toward = seen.length > 0 ? seen : foes;
      const nearest = Math.min(...toward.map((f) => manhattan(d.tile, f.pos)));
      score = -nearest * AI.approachWeight + movePart;
    }

    if (score > bestScore) {
      bestScore = score;
      bestPlan = { unit, path: d.path, destination: d.tile, target: actTarget, ability: actAbility };
    }
  }

  // Safety net: if the planner somehow stalled but a path to a seen foe exists,
  // fall back to a simple approach (keeps the AI from freezing on odd maps).
  if (bestPlan.target === null && bestPlan.path.length === 0 && !isImmobilized(unit) && seen.length > 0) {
    const nearest = [...seen].sort((a, b) => manhattan(unit.pos, a.pos) - manhattan(unit.pos, b.pos))[0];
    const nav = occupiedGrid(grid, units, [unit, nearest]);
    const path = findPath(nav, unit.pos, nearest.pos);
    if (path && path.length >= 2) {
      const approach = path.slice(1, -1).slice(0, unit.moveRange);
      if (approach.length > 0) {
        const destination = approach[approach.length - 1];
        const target = manhattan(destination, nearest.pos) <= unit.attackRange ? nearest : null;
        return { unit, path: approach, destination, target };
      }
    }
  }

  return bestPlan;
}

/** What an enemy intends to do to a player next turn (telegraphing). */
export interface EnemyIntent {
  /** The enemy whose turn this forecasts. */
  unit: Unit;
  /** Where it would move to act from (its current tile if it strikes in place). */
  destination: GridCoord;
  /** The foe it would act on. */
  target: Unit;
  /** A non-basic ability it would use instead of a strike (e.g. a snare). */
  ability?: SkillDef;
  /** Damage it would deal from `destination` — 0 for a non-damaging ability. */
  damage: number;
  /** True if that strike would drop the target. */
  lethal: boolean;
}

/**
 * **Telegraph** an enemy's next turn: run its planner (read-only) and, when it
 * would act on a foe, report who, from where, and how hard — so the player can
 * read incoming threats before committing their own turn. Fog-respecting (the
 * planner only targets *seen* foes). Returns `null` when the enemy would merely
 * advance / has no target. Pure: the underlying planner restores any scratch
 * state it touches.
 */
export function forecastEnemyAction(unit: Unit, units: readonly Unit[], grid: TileGrid, opts: AIOptions = {}): EnemyIntent | null {
  const plan = planEnemyTurn(unit, units, grid, opts);
  if (!plan.target) return null;
  const damage = plan.ability ? 0 : damageFrom(unit, plan.destination, plan.target, units);
  return { unit, destination: plan.destination, target: plan.target, ability: plan.ability, damage, lethal: damage >= plan.target.hp };
}

/**
 * The **danger zone** for `victimSide`: every tile a unit of that side could be
 * attacked on this turn — the union, over all living enemies, of the tiles each
 * can strike from any tile it can reach (its move reach grown by its attack
 * range). Stand outside this set and no enemy can hit you this turn. Pure; used
 * by the render's threat-range overlay.
 */
export function threatenedTiles(units: readonly Unit[], grid: TileGrid, victimSide: Side): GridCoord[] {
  const enemies = units.filter((u) => u.alive && !u.captured && u.side !== victimSide);
  const seen = new Set<string>();
  const out: GridCoord[] = [];
  for (const e of enemies) {
    for (const d of reachableTiles(e, units, grid)) {
      for (let dc = -e.attackRange; dc <= e.attackRange; dc++) {
        const rr = e.attackRange - Math.abs(dc);
        for (let dr = -rr; dr <= rr; dr++) {
          const t = { col: d.tile.col + dc, row: d.tile.row + dr };
          const key = `${t.col},${t.row}`;
          if (grid.inBounds(t) && !seen.has(key)) {
            seen.add(key);
            out.push(t);
          }
        }
      }
    }
  }
  return out;
}
