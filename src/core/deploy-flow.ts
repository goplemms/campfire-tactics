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
  /** No catch, but the net reached the protected core (or swallowed the last safe tile) → start the battle, nobody taken. */
  | { kind: "overrun" }
  /** Safe ground remains → rest the clock on the player until the next Advance. */
  | { kind: "continue" };

/**
 * Classify the net's turn (D63), the decision behind the scene's capture wave
 * (`resolveFrontWave`, the `frontTurn` listener): a
 * catch raises the alarm; otherwise, if the net has reached the protected core
 * ({@link FrontTurnOutcome.breached}) or no safe ground remains, the net has overrun
 * the camp (combat starts, nobody taken); otherwise the deploy phase continues. The
 * scene renders each branch but no longer decides it.
 */
export function frontTurnStage(
  out: FrontTurnOutcome,
  grid: TileGrid,
  camp: DeploySource,
  front: DeploySource,
): FrontTurnStage {
  if (out.captured) return { kind: "capture" };
  if (out.breached || !safeGroundRemains(grid, camp, front)) return { kind: "overrun" };
  return { kind: "continue" };
}

/** The deploy action-row **meta-controls** (D67) — the phase-commit + log controls; the
 *  per-unit *abilities* (Dig In / Set Trap / dual-context skills) surface from
 *  `availableSkills(unit, "pre-combat")`, the same projection as combat. */
export type DeployActionId = "undo" | "startBattle";

/** The state the deploy meta-controls are decided from. */
export interface DeployActionContext {
  /** A unit currently has the turn (vs. resting between turns). */
  hasActor: boolean;
  /** The active unit is captured (a netted unit can do nothing). */
  captured: boolean;
  /** There is something on this turn's log to take back. */
  canUndo: boolean;
}

/**
 * The ordered meta-control ids the deploy row should surface — the pure decision behind
 * `BattleScene.refreshDeployButtons`. **Undo** leads when there's something to take back;
 * **Start Battle** always closes (commit early at any point). The scene slots the ability
 * buttons (from `availableSkills`) between them.
 */
export function deployActions(ctx: DeployActionContext): DeployActionId[] {
  const ids: DeployActionId[] = [];
  if (ctx.hasActor && !ctx.captured && ctx.canUndo) ids.push("undo");
  ids.push("startBattle");
  return ids;
}
