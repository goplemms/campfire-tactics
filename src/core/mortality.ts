/**
 * Mortality & difficulty consequence policy (D9) — data-driven and swappable.
 *
 * A roguelike needs stakes, but the philosophy is **punish choices, not
 * execution**: units leave the run via two vectors — **falling in combat**
 * (HP→0) and being **captured-and-unrescued** — and *how harsh each is* is a
 * **difficulty dial**, not a fixed rule. Each difficulty is a
 * {@link DifficultyPolicy}: a plain data object the core consults to resolve a
 * downed or captured unit. Policies are swappable and headlessly testable (the
 * same data-driven approach as jobs).
 *
 * The universal time unit is **a night**. This module owns the *consequence*
 * resolution; the **Rest-Point recovery** half of D9 lives in {@link "./upkeep"}.
 *
 * Pure logic: no Phaser, no DOM.
 */

import type { Unit } from "./units";

/** How a downed (HP→0) unit resolves under a difficulty. */
export type DownedResolution =
  | "full-heal" // Easy — back up next rest, no cost
  | "half-redeploy" // Normal — redeploys at ½ HP, no permadeath
  | "dying-timer" // Hard — pay the cleric within N nights or permadeath
  | "permadeath"; // Hardest — gone at 0, flat

/** How a captured-and-unrescued unit resolves (a rescue follow-up, D9/D21). */
export type CaptureResolution =
  | "rescue-guaranteed" // Easy — take the quest, no timer
  | "rescue-earned" // Normal — a real fight, no timer
  | "rescue-narrow" // Hard — narrow window + reduced Deployment
  | "rescue-tight"; // Hardest — tight window + heavily reduced Deployment

/** One difficulty's consequence policy — pure data (D9). */
export interface DifficultyPolicy {
  id: string;
  name: string;
  /** What happens to a unit downed in combat. */
  downed: DownedResolution;
  /** Nights on the cleric clock for `dying-timer` before permadeath. */
  dyingNights: number;
  /** What happens to a captured-and-unrescued unit. */
  capture: CaptureResolution;
  /** Rescue-quest night window (0 = no timer). */
  rescueNights: number;
  /** Deployment penalty (fewer safe tiles) on the rescue follow-up (D9/D12). */
  rescueDeploymentPenalty: number;
  /** D9 recovery dial — RP needed per healing chunk (difficulty scales *only* this). */
  rpPerChunk: number;
}

/** The difficulty registry — swap a policy to change the whole gradient. */
export const DIFFICULTIES: Record<string, DifficultyPolicy> = {
  easy: {
    id: "easy",
    name: "Easy",
    downed: "full-heal",
    dyingNights: 0,
    capture: "rescue-guaranteed",
    rescueNights: 0,
    rescueDeploymentPenalty: 0,
    rpPerChunk: 10,
  },
  normal: {
    id: "normal",
    name: "Normal",
    downed: "half-redeploy",
    dyingNights: 0,
    capture: "rescue-earned",
    rescueNights: 0,
    rescueDeploymentPenalty: 1,
    rpPerChunk: 14,
  },
  hard: {
    id: "hard",
    name: "Hard",
    downed: "dying-timer",
    dyingNights: 3,
    capture: "rescue-narrow",
    rescueNights: 3,
    rescueDeploymentPenalty: 2,
    rpPerChunk: 18,
  },
  hardest: {
    id: "hardest",
    name: "Hardest",
    downed: "permadeath",
    dyingNights: 0,
    capture: "rescue-tight",
    rescueNights: 2,
    rescueDeploymentPenalty: 3,
    rpPerChunk: 20,
  },
};

/** Look up a difficulty policy by id (defaults to Normal). */
export function getDifficulty(id: string | undefined): DifficultyPolicy {
  return (id && DIFFICULTIES[id]) || DIFFICULTIES.normal;
}

/** Per-unit "dying" clock counter key (D9 Hard mode). */
export const DYING_COUNTER = "dyingNights";

/** Mortality tuning — the knobs the downed-unit resolutions read. */
export const MORTALITY = {
  /** `half-redeploy`: fraction of max HP a revived unit returns at. */
  redeployHpFraction: 0.5,
  /** Floor HP a revived unit can't drop below (never revive at 0). */
  redeployHpFloor: 1,
} as const;

/** The outcome of resolving a downed unit. */
export interface DownedOutcome {
  unitId: string;
  resolution: DownedResolution;
  /** True if the unit stays in the roster (revived, redeploying, or dying). */
  survived: boolean;
  /** True if the unit must be removed from the roster now (permadeath). */
  permadeath: boolean;
  /** HP the unit comes back at (when it survives outright). */
  hp?: number;
  /** Nights left on the cleric clock (dying-timer only). */
  dyingNights?: number;
}

/**
 * Resolve a unit downed in combat (HP reached 0) under a difficulty policy.
 * Mutates the unit to its post-rest state and reports what happened (D9):
 *
 * - **full-heal** → revived at full HP.
 * - **half-redeploy** → revived at ½ HP.
 * - **dying-timer** → stays down, a cleric clock starts (see {@link "./upkeep"}
 *   `clericRevive`); expiry is permadeath.
 * - **permadeath** → removed from the roster.
 */
export function resolveDowned(policy: DifficultyPolicy, unit: Unit): DownedOutcome {
  switch (policy.downed) {
    case "full-heal":
      unit.alive = true;
      unit.hp = unit.maxHp;
      return { unitId: unit.id, resolution: policy.downed, survived: true, permadeath: false, hp: unit.hp };
    case "half-redeploy":
      unit.alive = true;
      unit.hp = Math.max(MORTALITY.redeployHpFloor, Math.floor(unit.maxHp * MORTALITY.redeployHpFraction));
      return { unitId: unit.id, resolution: policy.downed, survived: true, permadeath: false, hp: unit.hp };
    case "dying-timer":
      // Stays down (alive=false) with a night clock; the cleric is the save.
      unit.counters[DYING_COUNTER] = policy.dyingNights;
      return {
        unitId: unit.id,
        resolution: policy.downed,
        survived: true,
        permadeath: false,
        dyingNights: policy.dyingNights,
      };
    case "permadeath":
      return { unitId: unit.id, resolution: policy.downed, survived: false, permadeath: true };
  }
}

/** True if a unit is on the Hard-mode dying clock. */
export function isDying(unit: Unit): boolean {
  return (unit.counters[DYING_COUNTER] ?? 0) > 0 && !unit.alive;
}

/**
 * Tick every dying unit's cleric clock by one night. Returns the units whose
 * clock ran out (permadeath) — the caller removes them from the roster.
 */
export function advanceDyingClocksOneNight(units: readonly Unit[]): Unit[] {
  const lost: Unit[] = [];
  for (const u of units) {
    if (!isDying(u)) continue;
    u.counters[DYING_COUNTER] -= 1;
    if (u.counters[DYING_COUNTER] <= 0) lost.push(u);
  }
  return lost;
}

/** A rescue follow-up quest produced by a captured-and-unrescued unit (D9). */
export interface RescueQuest {
  unitId: string;
  /**
   * The unit's **name** at the moment it was abandoned (D120). The record's stated purpose is
   * that an abandonment is never silently lost, and until now the name was recovered by looking
   * `unitId` up in `run.party` — which works for a roster member and **not** for an on-board
   * captive, who is never in the roster and is precisely the unit most likely to be left in a
   * cell. Carrying the name makes the record self-describing, which is also what a later promotion
   * to the guild tier needs (the run whose roster held them is gone by then). Optional so old
   * repro dumps (D-repro) still restore; the single producer always fills it.
   */
  unitName?: string;
  resolution: CaptureResolution;
  /** Night window (0 = no timer). */
  nights: number;
  /** Deployment penalty on the rescue battle ("ambush-in-reverse", D9/D12). */
  deploymentPenalty: number;
}

/**
 * Resolve a captured-and-unrescued unit into a **rescue follow-up quest** under
 * a policy (D9) — *not* an instant death. Per D21 a win auto-rescues **when it held the
 * field**, so this fires on a non-win/abandon outcome *and* on the D120 extraction win that
 * flew rather than held (whoever was not on a mouth stays in the prison). The unit stays
 * captured (a rescuable sub-objective) until the quest is run or its window lapses.
 *
 * Covers both populations (D120): a roster member marked captured by the "Go now" call, and an
 * **on-board captive** who never made it out — the latter has no roster entry at all, which is
 * why the record carries {@link RescueQuest.unitName} rather than relying on a party lookup.
 */
export function resolveCaptured(policy: DifficultyPolicy, unit: Unit): RescueQuest {
  return {
    unitId: unit.id,
    unitName: unit.name,
    resolution: policy.capture,
    nights: policy.rescueNights,
    deploymentPenalty: policy.rescueDeploymentPenalty,
  };
}
