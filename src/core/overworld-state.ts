/**
 * The overworld economy's per-run **state** (D35) — the sub-state + its accessors.
 *
 * Split out of `overworld-actions.ts` (R3, #129): the {@link OverworldState}
 * record (cooldowns, scouted tiers, per-node camp-use counts + flags, the Banker's
 * purse sub-state, Influence, the rest streak), its clone, and the flags / cooldowns
 * / interest API. Pure state plumbing — no cost gate, no interpreter. Pure code
 * motion: behaviour unchanged.
 *
 * Pure logic: no Phaser, no DOM.
 */

import type { SkillDef } from "./skills";
import type { Camp } from "./camp";
import { earn } from "./purse-journal";
import { decayCounters } from "./num";

// --- The per-run economy sub-state ------------------------------------------

/**
 * The overworld economy's per-run state (D35): per-ability cooldowns (node-steps
 * remaining; absent/0 ⇒ ready) and the per-node intel tier bumps Scout buys
 * (read back by {@link "./intel".previewNode}'s `extraTier`).
 */
export interface OverworldState {
  /** Node-steps remaining on each ability's cooldown, keyed by ability id. */
  cooldowns: Record<string, number>;
  /** Extra intel tiers bought per node id (Scout), fed to `previewNode`. */
  scouted: Record<string, number>;
  /**
   * Times each **camp job skill** has been used **at the current node**, keyed by
   * skill id — the limiter for costless signature actions (D35; Cook stew, Merchant
   * trade). Compared against {@link "./skills".SkillDef.usesPerNode} and **reset to
   * empty each node-step** ({@link tickCooldowns}), so the allowance is per-node, not
   * per-run.
   */
  campUses: Record<string, number>;
  /**
   * **Per-node ability flags** (D72) — a general boolean bag for signature actions that
   * mark a transient fact about *this* node (the Find-Trade "impromptu market opened
   * here" flag, folded into {@link "./overworld".effectiveMarketTier}). **Reset to empty
   * each node-step** ({@link tickCooldowns}), exactly like {@link campUses}, so the mark
   * never leaks to the next node. Set/read via {@link setNodeFlag}/{@link hasNodeFlag}.
   */
  nodeFlags: Record<string, boolean>;
  /**
   * **One-shot primed flags** (D72) — a general boolean bag for "the *next* X goes a
   * certain way" treats (the Savvy-Barter "next deal primed" flag, consumed by the next
   * trade). **Consumed on read** ({@link consumeFlag}) and **persists across node-steps**
   * until then (unlike {@link nodeFlags}) — a primed treat you haven't cashed waits. Set
   * via {@link primeFlag}; peek without consuming via {@link isPrimed}.
   */
  primedFlags: Record<string, boolean>;
  /**
   * The **Banker's** purse-scoped sub-state (M10, D30/D34) — **never** touches the
   * guild treasury. All three are off (0) until a Banker verb engages them
   * ({@link "./economy-actions"}).
   */
  /** Flat purse interest credited per node-step once the Banker engages it (0 = off). */
  interestPerStep: number;
  /** Outstanding buy-on-debt principal — auto-repaid from incoming run gold. */
  debt: number;
  /** Theft-protection level (0 = none) — blunts a thief's skim ({@link "./theft"}). */
  protection: number;
  /**
   * The Noble's **per-expedition Influence** standing (D62) — a walled-off currency
   * (never pays Upkeep/gear, {@link "./economy".addInfluence}) that accrues passively
   * from a Noble's presence + the Patronize verb, and is spent on bribes. Run-scoped
   * (rebuilt each expedition, like the purse) — it does **not** bank to the guild.
   */
  influence: number;
  /**
   * **Consecutive in-place-rest nights** at the current node (D80) — the party lingering to heal.
   * Increments each {@link "./runloop".RunLoop.inPlaceRest}; resets to 0 the moment the caravan
   * moves on ({@link "./run".chooseNode}). A hook for a soft cap ({@link "./upkeep".RECOVERY}) and
   * for streak-triggered events later.
   */
  restStreak: number;
}

/** A fresh, fully-ready economy (every ability off cooldown, nothing scouted, no flags set). */
export function createOverworldEconomy(): OverworldState {
  return { cooldowns: {}, scouted: {}, campUses: {}, nodeFlags: {}, primedFlags: {}, interestPerStep: 0, debt: 0, protection: 0, influence: 0, restStreak: 0 };
}

/** A deep copy of the economy (for snapshots / round-trips). */
export function cloneOverworldEconomy(eco: OverworldState): OverworldState {
  return {
    cooldowns: { ...eco.cooldowns },
    scouted: { ...eco.scouted },
    campUses: { ...eco.campUses },
    nodeFlags: { ...eco.nodeFlags },
    primedFlags: { ...eco.primedFlags },
    interestPerStep: eco.interestPerStep,
    debt: eco.debt,
    protection: eco.protection,
    influence: eco.influence,
    restStreak: eco.restStreak,
  };
}

// --- General ability-flag bag (D72) -----------------------------------------

/** Set a **per-node** ability flag (cleared each node-step) — the Find-Trade "market opened here" shape. */
export function setNodeFlag(eco: OverworldState, flag: string): void {
  eco.nodeFlags[flag] = true;
}

/** True if a **per-node** ability flag is currently set (a non-consuming read). */
export function hasNodeFlag(eco: OverworldState, flag: string): boolean {
  return eco.nodeFlags[flag] === true;
}

/** **Prime** a one-shot ability flag (persists across node-steps until consumed) — the Savvy-Barter shape. */
export function primeFlag(eco: OverworldState, flag: string): void {
  eco.primedFlags[flag] = true;
}

/**
 * Read **and consume** a one-shot primed flag (D72): returns true at most once per
 * prime, clearing it — the consume-on-next-use helper a follow-up action reads (the
 * Savvy-Barter "next deal" reading its primed discount). Returns false if never primed.
 */
export function consumeFlag(eco: OverworldState, flag: string): boolean {
  if (eco.primedFlags[flag]) {
    delete eco.primedFlags[flag];
    return true;
  }
  return false;
}

/** Peek at a one-shot primed flag **without consuming** it (for render surfacing). */
export function isPrimed(eco: OverworldState, flag: string): boolean {
  return eco.primedFlags[flag] === true;
}

/** Node-steps remaining on an ability's cooldown (0 = ready). */
export function cooldownRemaining(eco: OverworldState, abilityId: string): number {
  return eco.cooldowns[abilityId] ?? 0;
}

/** Times a camp job skill has already been used at the current node (0 = unused). */
export function campSkillUses(eco: OverworldState, skillId: string): number {
  return eco.campUses[skillId] ?? 0;
}

/**
 * Uses **left** for a camp job skill at the current node. `usesPerNode` undefined ⇒
 * uncapped (the skill is gated by its own per-cast cost), reported as `Infinity`.
 */
export function campSkillUsesLeft(eco: OverworldState, skill: SkillDef): number {
  if (skill.usesPerNode === undefined) return Infinity;
  return Math.max(0, skill.usesPerNode - campSkillUses(eco, skill.id));
}

/** The extra intel tier bought for a node so far (the Scout bump). */
export function scoutedTier(eco: OverworldState, nodeId: string): number {
  return eco.scouted[nodeId] ?? 0;
}

/**
 * Advance the overworld clock **one node-step**: decrement every cooldown by 1
 * (floored at 0) and **clear the per-node camp-use counts** so the next node opens
 * with a fresh action allowance (D35). Called once per node played from
 * {@link "./run".breakCamp}, so both combat and rest nodes tick the spine.
 */
export function tickCooldowns(eco: OverworldState): void {
  decayCounters(eco.cooldowns, 1);
  // Per-node allowance + per-node flags reset at the node boundary (D35/D72) — a new
  // camp, fresh uses, and any "opened here" mark cleared. (Primed one-shots persist.)
  eco.campUses = {};
  eco.nodeFlags = {};
}

/**
 * Accrue the **Banker's** flat purse interest one node-step (M10, D30/D34): credit
 * `interestPerStep` to the carried purse (`camp.gold`). Called once per node played
 * from {@link "./run".recordNight}, right alongside {@link tickCooldowns}. A pure
 * **purse** faucet — it **never** touches the guild treasury (D34). Returns the
 * gold credited (0 when no Banker interest is engaged).
 */
export function accruePurseInterest(eco: OverworldState, camp: Camp): number {
  if (eco.interestPerStep <= 0) return 0;
  earn(camp, eco.interestPerStep, "interest", "Banker interest");
  return eco.interestPerStep;
}
