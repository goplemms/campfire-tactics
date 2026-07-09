/**
 * Camp state — the Meta-phase economy + morale the non-combat jobs act on (M5).
 *
 * The signature jobs hook *different* phases (D3): the **Merchant** works the
 * economy (trading goods for gold at a market, {@link "./economy-actions"}), the
 * **Cook** raises **morale** (D8) and banks a between-battle **party heal**. The
 * Cook acts here, in camp, then its effect carries into the following battle. This
 * module is the small state object + the pure functions that apply those effects.
 *
 * Pure logic: no Phaser, no DOM.
 */

import { healUnit, type Unit } from "./units";
import type { EventBus } from "./events";
import type { SkillDef } from "./skills";
import { grantAbilityUseXp } from "./leveling";
import { bandFor } from "./num";
import { openingPurseLog, type PurseEntry } from "./purse-journal";

/** Mutable camp / meta state. */
export interface Camp {
  /**
   * The run **purse** (D34): loot and the Merchant's *sales* fill it
   * ({@link "./economy-actions".merchantSell}); Upkeep, buys, and bribes drain it.
   * (D61 retired the Merchant's old gold-*mint* — it trades, it doesn't print.)
   */
  gold: number;
  /**
   * **Vestigial** (D61): the live storage cap is `run.inventory.storageCap`, set by
   * the **caravan/vessel** ({@link "./caravan".Caravan.storageCap}) — not the camp,
   * and no longer raised by the Merchant. Nothing reads this field; kept only so
   * existing {@link createCamp} callers/snapshots don't break. Remove in a cleanup pass.
   */
  storageCap: number;
  /** Party morale, a banded value (D8); higher is better. */
  morale: number;
  /** HP the Cook has banked to heal each unit at the next battle's start. */
  pendingHeal: number;
  /**
   * The player's **voluntary** Upkeep-skip selection (D45) — the line ids the
   * player deliberately unticked on the ledger to free their gold for a riskier
   * play. Read by {@link "./upkeep".payUpkeep} (which lines to skip, vs deriving
   * `underfunded` purely from affordability) and the {@link "./ledger".nightEndGate}
   * (intent: a deliberate skip never nags, a can't-afford breach does). The
   * voluntary-skip seam's new state — the only state the ledger *adds* (D45).
   */
  skippedUpkeep: ("food" | "repairs")[];
  /**
   * Accumulated **worn-gear debt** (D45/D47) — a *compounding* combat-condition
   * debt from each skipped/breached **Repairs** line, paid later on the field. The
   * **rest node** clears it in one swipe (the premium tier, D47); in-place rest does
   * not. (Hunger from skipped Food is an *immediate, recoverable* morale hit, not
   * tracked here — only Repairs compounds, D45.)
   */
  gearWear: number;
  /**
   * Upkeep lines **prepaid by an effect this night** (D72) — e.g. Cook Stew's
   * {@link "./skills".ProvisionMealEffect} satisfying Food. {@link "./upkeep".payUpkeep}
   * skips billing these (and applies **no** morale/gear consequence — they're provisioned,
   * not breached or skipped) **before** the affordability pass, then clears the list so the
   * next night bills normally. Set via {@link "./upkeep".satisfyUpkeepLine}. The anti-exploit
   * (a satisfied line can't *also* be voluntarily skipped for the gold) lives in that ordering.
   */
  satisfiedUpkeep: ("food" | "repairs")[];
  /**
   * The **purse journal** (`camp.gold`'s transaction log) — every gold movement,
   * tagged by {@link "./purse-journal".PurseSource}, in order. Mutated only through
   * the {@link "./purse-journal".earn}/{@link "./purse-journal".spend} chokepoint, so
   * `sum(deltas) === gold` by construction. Seeded with the carried-purse opening
   * entry by {@link createCamp}. Read by future reporting (the ledger fold, sim trace).
   */
  purseLog: PurseEntry[];
}

/** A fresh camp with sensible starting values (the purse log seeded with the opening gold). */
export function createCamp(init: Partial<Camp> = {}): Camp {
  const gold = init.gold ?? 0;
  return {
    gold,
    storageCap: init.storageCap ?? 6,
    morale: init.morale ?? 0,
    pendingHeal: init.pendingHeal ?? 0,
    skippedUpkeep: init.skippedUpkeep ?? [],
    satisfiedUpkeep: init.satisfiedUpkeep ?? [],
    gearWear: init.gearWear ?? 0,
    purseLog: init.purseLog ?? openingPurseLog(gold),
  };
}

/**
 * Nudge party morale by a delta (D8) — **the one write funnel for `camp.morale`**
 * (the #112 rider's scalar chokepoint). A plain, unclamped `+=`, exactly what every
 * mutation site did (morale is unbounded raw; {@link moraleTier} bands it on read) —
 * the funnel exists so future provenance/clamping work has a single seam.
 */
export function nudgeMorale(camp: Camp, delta: number): void {
  camp.morale += delta;
}

/** Morale tiers (D8 banding): a legible label for the current morale value. */
export type MoraleTier = "Low" | "Neutral" | "High" | "Inspired";

/**
 * The D8 morale band floors, highest-first — the {@link "./num".bandFor} table
 * behind {@link moraleTier}. Asymmetric (the floor is shallow): anything below 0
 * is Low (the fallback), 0 is Neutral, the first positive step is already High.
 * Morale moves in whole points, so High's floor is 1.
 */
const MORALE_BANDS: readonly { min: number; tier: MoraleTier }[] = [
  { min: 3, tier: "Inspired" },
  { min: 1, tier: "High" },
  { min: 0, tier: "Neutral" },
];

/** The below-every-floor fallback band — negative morale reads Low. */
const MORALE_LOW: { min: number; tier: MoraleTier } = { min: -Infinity, tier: "Low" };

/** Band a raw morale value into its tier (asymmetric — the floor is shallow). */
export function moraleTier(morale: number): MoraleTier {
  return bandFor(morale, MORALE_BANDS, MORALE_LOW).tier;
}

/** The morale tiers low→high (D8) — the ordinal spine {@link moraleTierIndex} reads. */
export const MORALE_TIERS: readonly MoraleTier[] = ["Low", "Neutral", "High", "Inspired"];

/**
 * The numeric **tier index** of a raw morale value (Low = 0 … Inspired = 3) — the
 * ordinal twin of {@link "./fatigue".fatigueTierIndex}. A consumer that needs "how
 * high is morale, as a number" (the arrivals score) reads the ladder here instead
 * of re-keying its own string table that a renamed tier label would silently `NaN`.
 */
export function moraleTierIndex(morale: number): number {
  return MORALE_TIERS.indexOf(moraleTier(morale));
}

/** What a camp skill changed, for the render layer to report. */
export interface CampOutcome {
  morale?: number;
  bankedHeal?: number;
}

/**
 * Apply a Meta-phase skill's effect to the camp. Handles the Cook's `morale`
 * effect; other effect kinds are not camp effects and throw. (The Merchant's old
 * `economy` mint was retired in D61 — see {@link "./economy-actions".merchantSell}.)
 */
export function applyCampSkill(skill: SkillDef, camp: Camp): CampOutcome {
  const effect = skill.effect;
  switch (effect.kind) {
    case "morale":
      nudgeMorale(camp, effect.morale);
      camp.pendingHeal += effect.partyHeal;
      return { morale: effect.morale, bankedHeal: effect.partyHeal };
  }
  throw new Error(`applyCampSkill: "${effect.kind}" is not a camp effect`);
}

/**
 * Use a camp job skill **as its owner** (D32/D53): apply the effect *and* grant
 * the actor ability-use XP, so a job levels from its own signature work — the
 * Cook from cooking, the Merchant from trading. (Previously camp actions applied
 * their effect but granted no XP, so a non-combat job only levelled by overworld
 * scouting — its identity disconnected from its growth.) Returns the camp outcome
 * plus the character levels the use granted.
 */
export function useCampJobSkill(unit: Unit, skill: SkillDef, camp: Camp): CampOutcome & { levels: number } {
  const outcome = applyCampSkill(skill, camp);
  const levels = grantAbilityUseXp(unit);
  return { ...outcome, levels };
}

/**
 * Apply the camp's banked buffs to a battle's units at battle start: heal each
 * living unit by `pendingHeal` (capped at maxHp, emitting `unitHealed`), then
 * clear the bank. Returns the total HP restored.
 */
export function applyCampToParty(
  camp: Camp,
  units: readonly Unit[],
  bus?: EventBus,
): number {
  if (camp.pendingHeal <= 0) return 0;
  let total = 0;
  for (const u of units) {
    if (!u.alive || u.side !== "player") continue;
    total += healUnit(u, camp.pendingHeal, bus);
  }
  camp.pendingHeal = 0;
  return total;
}
