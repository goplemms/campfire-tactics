/**
 * Pure deployment-phase flow decisions (D63 — the headless half of the
 * BattleScene's deploy controller, Phase B of the deploy↔combat unification). The
 * scene owns rendering, animation, and input; these functions own the *decisions*
 * it used to tangle with Phaser, so they're unit-tested in the fast core suite.
 *
 * The heavy deploy mechanics already live in {@link "./deployment"} (the CT clock,
 * capture odds, front resolution, safe-ground test) and are covered there; this
 * module captures the thin "what happens next / what can I do" choices that were
 * still stranded in the render layer.
 *
 * Pure logic: no Phaser, no DOM.
 */

import type { TileGrid } from "./grid";
import type { DeploySource, FrontTurnOutcome } from "./deployment";
import { safeGroundRemains } from "./deployment";

/** What the deploy phase does once the net's turn resolves (D63). */
export type FrontTurnStage =
  /** A unit was netted → bind it, raise the alarm, start the battle. */
  | { kind: "capture" }
  /** No catch, but the net swallowed the last safe tile → start the battle anyway. */
  | { kind: "overrun" }
  /** Safe ground remains → rest the clock on the player until the next Advance. */
  | { kind: "continue" };

/**
 * Classify the net's turn (D63), the decision behind `BattleScene.runFrontTurn`: a
 * catch raises the alarm; otherwise, if no safe ground remains the net has overrun
 * the camp; otherwise the deploy phase continues. The scene renders each branch
 * (drop the net + delay → battle / overrun message → idle) but no longer decides it.
 */
export function frontTurnStage(
  out: FrontTurnOutcome,
  grid: TileGrid,
  camp: DeploySource,
  front: DeploySource,
): FrontTurnStage {
  if (out.captured) return { kind: "capture" };
  if (!safeGroundRemains(grid, camp, front)) return { kind: "overrun" };
  return { kind: "continue" };
}

/** The deploy action-row verbs (drive the buttons + the keyboard). */
export type DeployActionId = "undo" | "digIn" | "placeTrap" | "startBattle";

/** The state the deploy action row is decided from. */
export interface DeployActionContext {
  /** A unit currently has the turn (vs. resting between turns). */
  hasActor: boolean;
  /** The active unit is captured (a netted unit can do nothing). */
  captured: boolean;
  /** The unit has spent its one act (dig-in / trap) this turn. */
  acted: boolean;
  /** There is something on this turn's log to take back. */
  canUndo: boolean;
  /** The active unit carries a Set-Trap deployment skill. */
  canTrap: boolean;
}

/**
 * The ordered action ids the deploy row should surface — the pure decision behind
 * `BattleScene.refreshDeployButtons`. **Undo** leads when there's something to take
 * back; then the one-act verbs (**Dig In**, and **Place Trap** for a trapper) until
 * the act is spent; then **Start Battle** always (commit early at any point). The
 * scene maps each id to a button (label + handler) and a key.
 */
export function deployActions(ctx: DeployActionContext): DeployActionId[] {
  const ids: DeployActionId[] = [];
  const active = ctx.hasActor && !ctx.captured;
  if (active && ctx.canUndo) ids.push("undo");
  if (active && !ctx.acted) {
    ids.push("digIn");
    if (ctx.canTrap) ids.push("placeTrap");
  }
  ids.push("startBattle");
  return ids;
}
