/**
 * Fatigue (D29/D35 · redesigned D73) — the per-character **clearing currency** of the
 * overworld action economy.
 *
 * Fatigue is **not** the spine of that economy — per-ability **cooldowns / per-node caps**
 * are (see {@link "./overworld-actions"}). It is the one **per-character** cost, reserved for
 * slow, gold-free, repeatable **clearing verbs** (Forage, Train, Triage): invisible in normal
 * play, biting only when a single unit over-extends. The bite is **consequence-based, not a
 * lock** (D73) and lands across three bands:
 *
 * - **Rested / Worn** (≤ {@link FATIGUE.floor}) — the safe allowance; wiped by **any** night.
 * - **Weary** (floor…exhausted) — this unit's nightly **rest-heal costs more RP** ({@link
 *   restCostMultiplier}), and it **carries the excess over the floor into the next day** ({@link
 *   nightlyFatigue}); only an *improved rest* (a clearing / rest node) clears the carryover.
 * - **Exhausted** (≥ {@link FATIGUE.exhausted}) — the heaviest heal cost, full carryover, **and**
 *   a **combat tempo debuff**: the unit fields **Slowed** that fight ({@link exhaustionSlowSpeed}).
 *
 * **D73 revises D29's "never a combat stat."** Fatigue now *does* reach combat — but **only at
 * Exhausted, and only as tempo** (a CT/Slow), never a flat power debuff (no −attack/−defense),
 * preserving "punish choices, not execution." Worn/Weary stay overworld-only. The value rides on
 * {@link "./units".Unit} like awareness does; combat **reads** it (to Slow) but never **writes** it.
 *
 * Fatigue accrues from 0 (**Rested**): each clearing verb *adds* to it; rest resets it. You fall
 * *into* exhaustion by spending, and a real rest (a clearing) wipes it clean.
 *
 * Pure logic: no Phaser, no DOM.
 */

/** Fatigue tuning — the shallow asymmetric floor (D35) + the band consequences (D73), all data. */
export const FATIGUE = {
  /** A fresh character's fatigue — the default a {@link "./units".Unit} starts at. */
  rested: 0,
  /**
   * The **generous allowance**: fatigue at or below this carries **no consequence** and is
   * **wiped by any night**. Crossing it is the "greedily over-extended" signal.
   */
  floor: 6,
  /**
   * The deep-exhaustion threshold: at or above this the bite hardens — the heaviest rest-heal
   * cost, full carryover, **and** the combat Slow (see {@link exhaustionSlowSpeed}).
   */
  exhausted: 12,
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

/** Banded fatigue tier (D35) — a legible label for a raw fatigue value. */
export type FatigueTier = "Rested" | "Worn" | "Weary" | "Exhausted";

/**
 * Band a raw fatigue value into its tier. **Rested** and **Worn** sit within the allowance
 * (no consequence, wiped overnight); **Weary** is over the floor (pricier heal + carryover);
 * **Exhausted** is the deep over-extension (heaviest heal + the combat Slow). Most play never
 * leaves Rested/Worn — the floor is shallow and asymmetric.
 */
export function fatigueTier(level: number): FatigueTier {
  if (level <= 0) return "Rested";
  if (level <= FATIGUE.floor) return "Worn";
  if (level < FATIGUE.exhausted) return "Weary";
  return "Exhausted";
}

/**
 * Spend `cost` fatigue on a character's current `level`, returning the new level (clamped at the
 * {@link FATIGUE.ceiling}). A clearing verb spends only its **base** cost — there is no
 * over-extension surcharge (D73); the bite is the deferred recovery/combat consequence, not a
 * pricier cast.
 */
export function spendFatigue(level: number, cost: number): number {
  return Math.min(FATIGUE.ceiling, Math.max(0, level + Math.max(0, cost)));
}

/**
 * Restore a character to **Rested** — what an **improved rest** (a clearing / rest node) does
 * (D73/D47). A full reset, not a trickle: the asymmetry is the whole point — you fall into
 * fatigue by spending, and a real rest wipes it clean.
 */
export function restoreFatigue(_level: number): number {
  return FATIGUE.rested;
}

/**
 * The fatigue a unit **wakes with** after a night (D73). An **improved rest** (a clearing / rest
 * node) wipes everything to Rested; an **ordinary night** (combat camp, in-place rest, event)
 * wipes the safe **Worn** band but **carries the excess over the floor** — so over-extension
 * follows the unit until it reaches a clearing.
 */
export function nightlyFatigue(level: number, improved: boolean): number {
  if (improved) return FATIGUE.rested;
  return level <= FATIGUE.floor ? FATIGUE.rested : Math.min(FATIGUE.ceiling, level - FATIGUE.floor);
}

/**
 * The **rest-heal RP-cost multiplier** for a fatigue level (D73): an overtaxed unit recovers
 * poorly, so its heal chunks cost more of the shared RP pool. 1× within the safe bands; rises
 * while Weary, rises further while Exhausted. (An improved rest wipes fatigue *before* healing,
 * so it always heals at 1× — the penalty is an ordinary-night cost.)
 */
export function restCostMultiplier(level: number): number {
  const tier = fatigueTier(level);
  if (tier === "Exhausted") return FATIGUE.exhaustedRestMult;
  if (tier === "Weary") return FATIGUE.wearyRestMult;
  return 1;
}

/** True once a unit is deeply **Exhausted** (≥ {@link FATIGUE.exhausted}) — the band that reaches combat. */
export function isExhausted(level: number): boolean {
  return level >= FATIGUE.exhausted;
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
export function fatigueRisk(level: number): number {
  return Math.min(1, Math.max(0, level) / FATIGUE.exhausted);
}
