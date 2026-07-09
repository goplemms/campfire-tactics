/**
 * Field-effect resolvers (D19/D40/D66) — the roster-aware skill bodies.
 *
 * Split out of `turn.ts` (R3, #121): the three skill effects that need the **whole
 * roster / grid** (so they can't resolve through the unit-pair {@link "./skills".resolveSkill}) —
 * the Knight's {@link resolveShove} (D19 forced movement), the Soldier's
 * {@link resolveGuardAllies} (D66 brace-the-line), and the Knight's {@link execCleave}
 * (D40 directional AoE) — as free functions over their explicit inputs. `Battle` keeps
 * thin delegate methods that pass its grid / units / bus / move + damage-scale hooks.
 * Pure code motion: behaviour unchanged.
 *
 * Pure logic: no Phaser, no DOM.
 */

import { isActive, type Unit } from "./units";
import type { GridCoord } from "./iso";
import type { TileGrid } from "./grid";
import type { EventBus } from "./events";
import { resolveAttack, isAdjacent } from "./combat";
import { applyStatus, guarded, GUARDED } from "./status";
import type { SkillDef, SkillOutcome } from "./skills";
import { cleaveArc, shoveLanding } from "./ability-forecast";

/**
 * Push `target` away from `caster` (D19 forced movement, the Knight's Shove):
 * step it `tiles` tiles along the orthogonal away-vector, **stopping at a
 * blocker** (a wall or an occupied tile); forced entry onto an entity tile
 * fires it (via the `moveUnit` hook's `forced` flag). An optional `bonusAttack`
 * deals a shove hit. Returns how far it actually moved + any damage.
 */
export function resolveShove(
  caster: Unit,
  target: Unit,
  tiles: number,
  bonusAttack: number,
  grid: TileGrid,
  units: Unit[],
  bus: EventBus,
  moveUnit: (unit: Unit, path: readonly GridCoord[], forced: boolean) => void,
): SkillOutcome {
  // Walk the shove one tile at a time toward the landing the pure `shoveLanding`
  // core computes (D64 single-source-of-truth: the telegraph reads the *same*
  // geometry the resolver does, so the push arrow and into-trap read can't
  // drift). Each step goes through `moveUnit` so entities (traps) fire en route.
  const dc = Math.sign(target.pos.col - caster.pos.col);
  const dr = Math.sign(target.pos.row - caster.pos.row);
  const { moved } = shoveLanding(
    caster.pos,
    target.pos,
    tiles,
    (c) => grid.isWalkable(c),
    (c) => units.some((u) => u.alive && u !== target && u.pos.col === c.col && u.pos.row === c.row),
  );
  for (let i = 0; i < moved; i++) {
    moveUnit(target, [{ col: target.pos.col + dc, row: target.pos.row + dr }], true);
  }
  const out: SkillOutcome = {};
  if (bonusAttack !== 0 && target.alive) {
    out.damage = resolveAttack(caster, target, bus, caster.attack + bonusAttack, units);
  }
  void moved;
  return out;
}

/**
 * The Soldier's **Turtle Formation** (D66): brace the line — apply Guarded to
 * every ally orthogonally adjacent to the caster (an "AoE Defend"; per-ally,
 * lasting to that ally's next turn, like Defend). Needs the roster, so it resolves
 * here rather than via the unit-pair {@link "./skills".resolveSkill}. Returns the
 * Guarded id when it braced anyone.
 */
export function resolveGuardAllies(caster: Unit, amount: number, duration: number, units: Unit[]): SkillOutcome {
  let braced = 0;
  for (const u of units) {
    if (isActive(u) && u.side === caster.side && u !== caster && isAdjacent(u.pos, caster.pos)) {
      applyStatus(u, guarded(duration, amount));
      braced += 1;
    }
  }
  return braced > 0 ? { status: GUARDED } : {};
}

/** The raw arc resolution (the cleave-action body) — hit every foe in the 90° arc. */
export function execCleave(
  caster: Unit,
  skill: SkillDef,
  dir: GridCoord,
  units: Unit[],
  bus: EventBus,
  damageScale: (attacker: Unit, defender: Unit) => number,
): { hits: number; damage: number } {
  const bonus = skill.effect.kind === "cleave" ? skill.effect.bonusAttack : 0;
  // The arc geometry comes from the shared `cleaveArc` core (D64) so the
  // telegraph washes exactly the tiles this resolver sweeps — one source of truth.
  const arc: GridCoord[] = cleaveArc(caster.pos, dir);
  const key = (g: GridCoord) => `${g.col},${g.row}`;
  const arcKeys = new Set(arc.map(key));
  let hits = 0;
  let damage = 0;
  for (const u of units) {
    if (u.alive && u.side !== caster.side && arcKeys.has(key(u.pos))) {
      damage += resolveAttack(caster, u, bus, caster.attack + bonus, units, damageScale(caster, u));
      hits += 1;
    }
  }
  return { hits, damage };
}
