/**
 * Pure battle-phase flow decisions (D60/D55 — the headless half of the
 * BattleScene's combat controller, Phase B of the deploy↔combat unification). Twin
 * of {@link "./deploy-flow"}: the scene owns rendering, animation, and input; these
 * own the turn-flow *decisions* it used to tangle with Phaser.
 *
 * The heavy combat mechanics already live in core and are covered there — the CT
 * clock + `nextActor` ({@link "./turn"}), the enemy AI ({@link "./ai"}), the
 * resolution gates ({@link "./staging"}). This module captures the thin "whose turn
 * is it / can this unit do anything" choices that were stranded in the render layer.
 *
 * Pure logic: no Phaser, no DOM.
 */

import type { Unit } from "./units";
import type { TileGrid } from "./grid";
import type { EntityRegistry, ConcealedTrap } from "./entities";
import { isConcealedTrap } from "./entities";
import { chebyshev } from "./iso";
import { isAdjacent, moveBudget } from "./combat";
import { reachableTiles } from "./ai";
import { forecastAttack } from "./planning";
import { unlockedSkills } from "./leveling";
import { hiddenTraps, canDisarm } from "./traps";

/** What advancing the clock does with the next actor (the `onAdvance` branch). */
export type AdvanceOutcome =
  /** The encounter is decided (or the clock is empty) → resolve the battle. */
  | { kind: "finish" }
  /** A hidden ambusher just passes until the party scouts it into view (D42/D44). */
  | { kind: "ambushPass"; actor: Unit }
  /** An enemy acts (its turn runs through the AI planner). */
  | { kind: "enemyTurn"; actor: Unit }
  /** Open a player unit's free-move turn (D60). */
  | { kind: "playerTurn"; actor: Unit };

/**
 * Classify a clock advance (D60), the decision behind `BattleScene.onAdvance`. The
 * caller steps the clock (`battle.nextActor`) and re-polls whether the encounter is
 * decided — a clock tick can close a gate (D50) — then this turns the next actor +
 * that flag into the branch the scene renders (resolve / pass / enemy / player).
 */
export function advanceOutcome(actor: Unit | null, decided: boolean): AdvanceOutcome {
  if (decided || !actor) return { kind: "finish" };
  if (actor.hidden) return { kind: "ambushPass", actor };
  return actor.side === "enemy" ? { kind: "enemyTurn", actor } : { kind: "playerTurn", actor };
}

/** The nearest revealed, un-sprung trap a unit could reach to disarm (within 1 tile). */
export function adjacentRevealedTrap(actor: Unit, entities: EntityRegistry): ConcealedTrap | undefined {
  return entities.all().filter(isConcealedTrap).find((t) => t.revealed && !t.sprung && chebyshev(t.pos, actor.pos) <= 1);
}

/** Everything the no-action backstop reads about the board. */
export interface ActionScanContext {
  actor: Unit;
  units: readonly Unit[];
  grid: TileGrid;
  entities: EntityRegistry;
  /** A guild is present, so Bribe is on the table while any enemy lives. */
  hasGuild: boolean;
}

/**
 * The D55 no-action backstop: `true` when the unit has *nothing* it can do this turn
 * — no move, no strike, no rescue of a bound ally, no skill, no Search, no disarm,
 * no bribe — so the scene auto-passes it and the clock can never stall. The decision
 * behind `BattleScene.noActionsAvailable`.
 */
export function noActionsAvailable(ctx: ActionScanContext): boolean {
  const { actor, units, grid, entities, hasGuild } = ctx;
  const budget = moveBudget(actor);
  if (reachableTiles(actor, units, grid, budget).some((r) => r.tile.col !== actor.pos.col || r.tile.row !== actor.pos.row)) return false;
  if (units.some((u) => u.alive && !u.captured && u.side !== actor.side && forecastAttack(actor, u, units, grid))) return false;
  if (units.some((u) => u.captured && u.side === actor.side && u !== actor && isAdjacent(actor.pos, u.pos))) return false;
  if (unlockedSkills(actor, "battle").length > 0) return false;
  if (hiddenTraps(entities).length > 0) return false; // Search is available
  if (adjacentRevealedTrap(actor, entities) && canDisarm(actor)) return false;
  if (hasGuild && units.some((u) => u.side === "enemy" && u.alive)) return false; // Bribe
  return true;
}
