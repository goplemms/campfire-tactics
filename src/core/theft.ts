/**
 * Theft (M10, D30) — the active gold sink that gives the Banker teeth.
 *
 * The economy needs a *risk* side, not just sinks the player chooses. Theft is it:
 * gold can be **taken** from the carried **purse** (never the treasury — that's a
 * pure vault, D34), and getting it back follows the D13/D21 control principle —
 * **kill the thief → it drops what it stole; a thief that escapes off-map keeps
 * it** (a "chase the thief" tension, not a flat loss).
 *
 * Two vectors, one resolver:
 * - **A thief ENEMY** ({@link "./generation".ENEMY_TEMPLATES} `thief`) skims the
 *   purse mid-battle and bolts for the edge. The render arms the skim on a steal,
 *   then resolves it on the thief's death ({@link recoverStolen}) or escape
 *   ({@link thiefEscapes}).
 * - **A thief EVENT node** ({@link "./overworld".NodeKind} `event`) skims the purse
 *   on the overworld ({@link thiefEventSkim}).
 *
 * Both are **blunted by the Banker's theft protection**
 * ({@link "./overworld-actions".OverworldEconomy.protection}, a [0,1) fraction):
 * the skim is reduced by that fraction.
 *
 * **Determinism (D22):** every skim is rolled from a seed label (`run.seed` + the
 * node id, or a caller-supplied battle label) — no live RNG, no `Math.random`.
 *
 * Pure logic: no Phaser, no DOM.
 */

import type { RunState } from "./run";
import type { MapNode } from "./overworld";
import { streamFor } from "./rng";
import { clamp, clamp01 } from "./num";
import { earn, spend } from "./purse-journal";

/** Theft tuning — data, a numbers pass later (D30). */
export const THEFT = {
  /** A skim takes a random fraction of the purse in this band (before protection). */
  minFraction: 0.2,
  maxFraction: 0.45,
  /** A skim never lifts less than this (when the purse can cover it). */
  floor: 5,
} as const;

/** A live theft — gold lifted off the purse, awaiting recovery or escape. */
export interface TheftAttempt {
  /** Gold lifted off the purse (already deducted; "held by the thief"). */
  stolen: number;
  /** The purse balance immediately after the skim. */
  purseAfter: number;
  /** Theft protection that was in effect (the Banker's blunt, [0,1)). */
  protection: number;
  /** True once resolved — recovered (thief killed) or written off (escaped). */
  resolved: boolean;
}

/**
 * Roll how much a thief skims from a purse (M10, D30) — deterministic from
 * `(seed, label)`. Takes a random fraction of `purse` in the {@link THEFT} band,
 * floored, capped at the purse, then **reduced by `protection`** (the Banker's
 * blunt, a [0,1) fraction). A pure function — it mutates nothing.
 */
export function rollSkim(
  seed: string | number,
  label: string,
  purse: number,
  protection = 0,
): number {
  if (purse <= 0) return 0;
  const rng = streamFor(seed, label);
  const frac = rng.float(THEFT.minFraction, THEFT.maxFraction);
  let skim = Math.max(Math.min(THEFT.floor, purse), Math.round(purse * frac));
  // The Banker's protection blunts the skim (D30).
  const guard = clamp01(protection);
  skim = Math.round(skim * (1 - guard));
  return clamp(skim, 0, purse);
}

/**
 * Deduct a rolled skim from the run **purse** and return the live {@link
 * TheftAttempt}. `label` keys the deterministic roll (the battle's thief id, or a
 * node id); `protection` defaults to the Banker's engaged level
 * ({@link "./overworld-actions".OverworldEconomy.protection}). The gold is now
 * "held by the thief" — recover it ({@link recoverStolen}) or lose it
 * ({@link thiefEscapes}).
 */
export function thiefSteal(
  run: RunState,
  label: string,
  protection = run.overworld.protection,
): TheftAttempt {
  const stolen = rollSkim(run.seed, label, run.camp.gold, protection);
  spend(run.camp, stolen, "theft", "Purse skimmed by thief", { nodeId: run.mapNodeId, night: run.night });
  return { stolen, purseAfter: run.camp.gold, protection, resolved: false };
}

/**
 * The purse-skim of a thief **event node** (M10, D30) — keyed by the node id so
 * it's stable for a seed. Same blunt-by-protection rule as the battle thief.
 */
export function thiefEventSkim(
  run: RunState,
  node: MapNode,
  protection = run.overworld.protection,
): TheftAttempt {
  return thiefSteal(run, `theft:${node.id}`, protection);
}

/**
 * **Kill-to-recover** (D13/D21): the thief was put down before it left the map, so
 * the stolen gold drops back into the purse. Returns the gold recovered (idempotent
 * once resolved).
 */
export function recoverStolen(run: RunState, attempt: TheftAttempt): number {
  if (attempt.resolved) return 0;
  earn(run.camp, attempt.stolen, "recovery", "Recovered stolen gold", { nodeId: run.mapNodeId, night: run.night });
  attempt.resolved = true;
  return attempt.stolen;
}

/**
 * **Escaped off-map** (D13/D21): the thief reached the edge and is gone — the gold
 * stays lost (the purse is **not** credited back). Returns the gold written off.
 */
export function thiefEscapes(attempt: TheftAttempt): number {
  if (attempt.resolved) return 0;
  attempt.resolved = true;
  return attempt.stolen;
}
