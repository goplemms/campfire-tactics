/**
 * Fatigue (D29/D35 · redesigned D73 · unified D80) — the one **effort meter** of the
 * overworld. Everything a unit does out of combat is an **effort skill** (Survey, Train,
 * Cook… from a heavy skill down to a negligible ~0), or **Rest**. Effort accrues Fatigue;
 * rest sheds it. There is no assignment board and no "arduous" category — one number, in
 * and out (D80).
 *
 * Fatigue rides on the {@link "./units".Unit} like awareness does. Its two jobs:
 *
 * 1. **Gate recovery (its main job, D80).** A **Clearing**'s Deep Rest grants a **big heal**
 *    — but only to a unit at **Tier 0 when the rest resolves** ({@link isFatigueTier0}). So
 *    over-extending (or spending heavy effort *at* the Clearing) forfeits the heal without
 *    ever locking a verb — the allocation puzzle falls out of unit state, no board.
 * 2. **Bite in combat at the deep end (D73).** Only at **Exhausted**, and only as **tempo**
 *    (a CT/Slow, {@link exhaustionSlowSpeed}), never a flat power debuff. Combat **reads**
 *    fatigue (to Slow) but never **writes** it.
 *
 * **Narrowing bands (D80).** Fatigue tiers are banded with **tightening widths** — each tier
 * costs less effort to reach than the last ({@link FATIGUE_TIER_FLOORS}), so stacking heavy
 * skills without a rest tips a unit deeper, faster. A single heavy skill (Survey ≈ 4) lands in
 * the first non-Rested tier and is wiped by a single night; only **stacking** lingers.
 *
 * **Two rests shed it (D80):**
 * - **Nightly rest** (every node, free) — steps Fatigue **down one tier**, to the floor of the
 *   tier below ({@link nightlyFatigue}); a small HP chip rides alongside (`RECOVERY.nightlyChipHp`).
 * - **Deep Rest** (a Clearing provides it) — wipes Fatigue to **Rested** ({@link restoreFatigue})
 *   for everyone, plus the Tier-0-gated big heal (resolved in `RunLoop.restNode`).
 *
 * Pure logic: no Phaser, no DOM.
 */

import { bandFor } from "./num";

/** Fatigue tuning — the deep-end consequence thresholds (D73), all data (D4). */
export const FATIGUE = {
  /** A fresh character's fatigue — the default a {@link "./units".Unit} starts at (Tier 0). */
  rested: 0,
  /**
   * The **Exhausted** threshold (the Tier-3 floor): at or above this the bite hardens — the
   * heaviest rest-heal cost **and** the combat Slow (see {@link exhaustionSlowSpeed}). Kept as a
   * named constant so combat / arrivals scoring can read the deep-end line without the band table.
   */
  exhausted: 9,
  /** A hard ceiling so the value can't run away unboundedly. */
  ceiling: 18,
  /** Rest-heal **RP-cost multiplier** while **Weary** (overtaxed → recovers poorly). */
  wearyRestMult: 1.5,
  /** Rest-heal **RP-cost multiplier** while **Exhausted**. */
  exhaustedRestMult: 2,
  /**
   * Exhausted **combat Slow**: effective speed is capped to this fraction of the unit's base
   * Speed (a gentle, CT-only tempo debuff — never a power debuff). Tunable.
   */
  slowKeepFraction: 0.7,
  /** Exhausted Slow duration in turns — large enough to last the whole encounter. */
  slowDuration: 99,
} as const;

/**
 * The **narrowing band floors** (D80) — the lower edge (inclusive) of each numeric fatigue tier.
 * Widths tighten as you climb (4 → 3 → 2 → 1 …), so each further tier is cheaper to reach than
 * the last: stacking effort without a rest tips a unit deeper, faster. A raw fatigue value sits
 * in the highest tier whose floor it meets ({@link fatigueTierIndex}). *(Illustrative — the
 * **structure** is canon, the exact edges tune in playtest.)*
 */
export const FATIGUE_TIER_FLOORS: readonly number[] = [0, 4, 7, 9, 10, 11, 12];

/** Banded fatigue tier (D35) — a legible label for a raw fatigue value. */
export type FatigueTier = "Rested" | "Worn" | "Weary" | "Exhausted";

/**
 * {@link FATIGUE_TIER_FLOORS} as the shared `min`-floor band shape, highest-first —
 * the table {@link "./num".bandFor} scans (each entry carries its tier index).
 */
const FATIGUE_BANDS: readonly { min: number; tier: number }[] = FATIGUE_TIER_FLOORS
  .map((min, tier) => ({ min, tier }))
  .reverse();

/**
 * The **numeric tier index** of a raw fatigue value (D80) — the highest band whose floor it
 * meets ({@link "./num".bandFor} over {@link FATIGUE_TIER_FLOORS}). Tier 0 is the fresh/Rested
 * band; each step up is a narrowing band. This is the spine of both the recovery gate
 * (Tier 0 ⇒ big heal) and the one-tier-per-night step-down.
 */
export function fatigueTierIndex(fatigue: number): number {
  return bandFor(fatigue, FATIGUE_BANDS, FATIGUE_BANDS[FATIGUE_BANDS.length - 1]).tier;
}

/**
 * Band a raw fatigue value into its named tier. **Rested** (Tier 0) is the safe, big-heal-eligible
 * band; **Worn** (Tier 1) is the first step out — no consequence, cleared in a single night;
 * **Weary** (Tier 2) carries the pricier rest-heal + takes a couple of nights to shed; **Exhausted**
 * (Tier 3+) is the deep over-extension (heaviest heal **and** the combat Slow). Most play never
 * leaves Rested/Worn — the first bands are the widest.
 */
export function fatigueTier(fatigue: number): FatigueTier {
  const idx = fatigueTierIndex(fatigue);
  if (idx <= 0) return "Rested";
  if (idx === 1) return "Worn";
  if (idx === 2) return "Weary";
  return "Exhausted";
}

/**
 * Whether a unit is at **Tier 0** — the gate for a Clearing's **big heal** (D80). Folds in both
 * *how worn you arrived* and *what you did here*: a unit that over-extended (or spent heavy effort
 * at the Clearing) is out of Tier 0 and takes the wipe only. A light (~0-effort) action stays
 * within Tier 0 and still cashes the heal — the whole point of negligible effort.
 */
export function isFatigueTier0(fatigue: number): boolean {
  return fatigueTierIndex(fatigue) <= 0;
}

/**
 * Spend `cost` fatigue on a character's current magnitude, returning the new value (clamped at the
 * {@link FATIGUE.ceiling}). A skill spends only its **base** effort — there is no over-extension
 * surcharge (D73); the bite is the deferred recovery/combat consequence, not a pricier cast.
 */
export function spendFatigue(fatigue: number, cost: number): number {
  return Math.min(FATIGUE.ceiling, Math.max(0, fatigue + Math.max(0, cost)));
}

/**
 * Restore a character to **Rested** — what a **Deep Rest** (a Clearing / rest node) does for
 * everyone (D80/D47). A full reset, not a trickle: you fall into fatigue by spending, and a real
 * rest wipes it clean.
 */
export function restoreFatigue(_fatigue: number): number {
  return FATIGUE.rested;
}

/**
 * The fatigue a unit **wakes with** after a night (D80). A **Deep Rest** (a Clearing) wipes
 * everything to Rested; an **ordinary night** (combat camp, in-place rest, event) **steps down one
 * tier** — to the **floor of the tier below** its current band. One heavy skill (→ Tier 1) is wiped
 * by a single night; only **stacking** (→ Tier 2+) lingers, one tier shed per night, so deep
 * over-extension follows the unit until it routes to a Clearing.
 */
export function nightlyFatigue(fatigue: number, improved: boolean): number {
  if (improved) return FATIGUE.rested;
  const idx = fatigueTierIndex(fatigue);
  if (idx <= 0) return FATIGUE.rested;
  return FATIGUE_TIER_FLOORS[idx - 1];
}

/**
 * The **rest-heal RP-cost multiplier** for a fatigue fatigue (D73): an overtaxed unit recovers
 * poorly, so its heal chunks cost more of the shared RP pool. 1× within Rested/Worn; rises while
 * Weary, rises further while Exhausted. (A Deep Rest wipes fatigue *before* healing, so it always
 * heals at 1× — the penalty is an ordinary-night cost.)
 */
export function restCostMultiplier(fatigue: number): number {
  const tier = fatigueTier(fatigue);
  if (tier === "Exhausted") return FATIGUE.exhaustedRestMult;
  if (tier === "Weary") return FATIGUE.wearyRestMult;
  return 1;
}

/** True once a unit is deeply **Exhausted** (≥ {@link FATIGUE.exhausted}) — the band that reaches combat. */
export function isExhausted(fatigue: number): boolean {
  return fatigue >= FATIGUE.exhausted;
}

/**
 * The capped effective speed an **Exhausted** unit's combat **Slow** holds it to (D73) — a gentle,
 * per-unit, CT-only tempo debuff (≈ {@link FATIGUE.slowKeepFraction} of base, at least 1). Only
 * meaningful when {@link isExhausted}; the caller stamps the `slowed` status at battle setup.
 */
export function exhaustionSlowSpeed(baseSpeed: number): number {
  return Math.max(1, Math.floor(baseSpeed * FATIGUE.slowKeepFraction));
}

/** Current fatigue as a 0..1 fraction of the way to deep exhaustion (for a meter). */
export function fatigueRisk(fatigue: number): number {
  return Math.min(1, Math.max(0, fatigue) / FATIGUE.exhausted);
}
