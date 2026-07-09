/**
 * The economy verbs (M10, D30/D34) — one distinct verb per economy class.
 *
 * Gold must stay **scarce** or Upkeep stops biting, so each economy class gets
 * **one** verb and every faucet is paired with a sink (D30). These are the
 * resolvers; the cost numbers are data ({@link ECONOMY}). All three are **field /
 * purse-scoped** — none of them touch the guild **treasury** (D34), except the
 * Noble's Influence, which is its own walled-off currency ({@link "./economy"}).
 *
 * - **Merchant — ACCESS** ({@link merchantBuy}): spend **run-gold** (the purse) to
 *   buy supplies into caravan storage. Price is **node-tier-gated** — a `rest`
 *   ("town") node offers better access than out in the wild (D30).
 * - **Banker — TIME-SHIFT + SECURE** ({@link bankerEngageInterest}/{@link
 *   bankerBorrow}/{@link bankerProtect}): purse **interest** that accrues as the
 *   caravan advances; **buy-on-debt** that lets you overspend now and auto-repays
 *   from incoming run gold ({@link "./economy".gainRunGold}); and **theft
 *   protection** that blunts a skim ({@link "./theft"}). **Purse only — never the
 *   treasury** (D34).
 * - **Noble — INFLUENCE** ({@link accrueDeclaredFaucets}/{@link patronize}/{@link
 *   bribeEnemy}): **Influence** — a separate, **per-expedition** currency that can never
 *   pay Upkeep — accrues passively from a Noble's presence and from the **Patronize**
 *   verb (gold → standing), and is spent on a **bribe** that sways an enemy (reading the
 *   D24 preview) into a temporary turncoat (generic) or a permanent recruit (authored, D33).
 *
 * **Determinism (D22):** income/bribe rolls derive from the guild seed; theft from
 * node/run seeds — no live RNG, no `Math.random`. Pure logic: no Phaser, no DOM.
 */

import type { RunState } from "./run";
import { fieldedUnits, fieldsJob, primaryJobOf, healUnit, type Unit } from "./units";
import { getJob, unitHasCapability, type JobLookup } from "./jobs";
import { PASSIVE } from "./combat";
import { getNode, effectiveMarketTier, type MarketTier } from "./overworld";
import { isPrimed, consumeFlag } from "./overworld-state";
import { checkOverworldCost, validateOverworldCost, type OverworldCost } from "./overworld-cost";
import { DEAL_PRIMED_FLAG, type ActionOutcome } from "./overworld-actions";
import { earn } from "./purse-journal";
import type { NodePreview } from "./intel";
import { nonNegInt } from "./num";
import { addItem, canAdd, countOf, removeItem, getMaterial, saleValueOf, type MaterialDef } from "./inventory";
import { streamFor } from "./rng";
import { Labels } from "./rng-labels";
import { addInfluence, spendInfluence, gainRunGold, influenceTier, type InfluenceTier } from "./economy";
import { grantAbilityUseXp } from "./leveling";
import { recruitClassify, type RecruitOutcome } from "./recruitment";

/** Economy-verb tuning — data, a numbers pass later (D30). */
export const ECONOMY = {
  merchant: {
    /**
     * Buy price (D61) to purchase one supply, by the node's **effective market
     * tier**: a better market is cheaper access. `none` = no market (buy refused);
     * `poor` (impromptu / Merchant-floor) is dear; a real `basic` town cheaper;
     * `premium` cheapest. Data, a numbers pass later.
     */
    buyPrice: { none: 0, poor: 16, basic: 10, premium: 8 } as Record<MarketTier, number>,
    /**
     * Sell rate (D61): fraction of a material's saleValue paid per unit, by the
     * node's effective market tier. `none` = can't sell; `poor` (an impromptu /
     * Merchant-floor market) pays a haircut; a real `basic` town more; `premium`
     * pays full face. Data, a numbers pass later.
     */
    sellRate: { none: 0, poor: 0.5, basic: 0.8, premium: 1 } as Record<MarketTier, number>,
    /** Savvy Barter (D70): the next buy costs this fraction of price (½ off). Numbers pass. */
    savvyBuyFactor: 0.5,
    /** Savvy Barter (D70): the next sale fetches this multiple of price (+25%). Numbers pass. */
    savvySellFactor: 1.25,
  },
  banker: {
    /** Flat purse-interest rate per node-step, applied to the purse at engage. */
    interestRate: 0.1,
    /** Theft-protection level the Banker buys (a [0,1) skim reduction). */
    protectionLevel: 0.5,
    /** Purse cost to buy theft protection. */
    protectionCost: 25,
  },
  noble: {
    /** Influence accrued **per node-step** by a Noble's presence — the passive faucet (D62). */
    incomePerStep: 1,
    /** Patronize (D62): purse gold spent to court patrons... */
    patronizeCost: 12,
    /** ...for this much Influence in return (gold → standing, once per node). */
    patronizeYield: 3,
    /** Base Influence cost to bribe an enemy (discounted by what intel reveals + standing). */
    bribeBase: 4,
    /** Bribe **cost discount** by the briber's standing band (D62) — better standing, cheaper sway. */
    bribeDiscount: { unknown: 0, known: 0, respected: 1, favored: 2, renowned: 2 } as Record<InfluenceTier, number>,
    /** Bribe **success chance** by the briber's standing band (D62) — better standing, likelier sway. */
    bribeChance: { unknown: 0.4, known: 0.55, respected: 0.7, favored: 0.85, renowned: 1 } as Record<InfluenceTier, number>,
  },
} as const;

// --- Merchant — ACCESS (purse-funded, market-tier-gated) --------------------

/** The Merchant's price to buy one supply at a market of the given tier (D61). */
export function merchantPrice(tier: MarketTier): number {
  // A better market is cheaper access; `none` returns 0 (buy is refused upstream).
  return ECONOMY.merchant.buyPrice[tier];
}

/**
 * Merchant Buy's cost (D61): always **gold-priced**. The concrete per-cast price is
 * computed per call (the caller's market tier × a primed Savvy Barter discount), so
 * the registry entry declares the axis with a provider — the price a buy would gate
 * on at the current node's effective market; {@link merchantBuy} overlays the exact
 * per-cast price onto this entry before the gate.
 */
export const MERCHANT_BUY_COST: OverworldCost = {
  gold: (run) => merchantPrice(effectiveMarketTier(getNode(run.map, run.mapNodeId), run.party, run.overworld)),
};

/** What a Merchant buy produced. */
export interface MerchantBuyResult extends ActionOutcome {
  /** Purse gold spent. */
  spent?: number;
  /** The market-tier price paid. */
  price?: number;
}

/**
 * **Merchant ACCESS** (D30/D61): spend **run-gold** (the purse, `camp.gold`) to buy
 * one of a supply into caravan **storage**, at a **market-tier price** (`tier` is the
 * node's {@link "./overworld".effectiveMarketTier}, so a better market — or a Merchant
 * raising the floor — buys cheaper). Refuses (without spending) when there's **no
 * market** (`none`), the purse can't cover it, or storage is full (the provisioning
 * cap, D6). Never touches the treasury (D34).
 */
export function merchantBuy(run: RunState, materialId: string, tier: MarketTier): MerchantBuyResult {
  if (tier === "none") {
    return { applied: false, reason: `No market here to buy ${materialId}.` };
  }
  // Savvy Barter (D70): a primed deal halves the next buy. Peek now (don't consume on a
  // refused buy); the flag is cashed only once the purchase actually goes through.
  const primed = isPrimed(run.overworld, DEAL_PRIMED_FLAG);
  const price = primed ? Math.ceil(merchantPrice(tier) * ECONOMY.merchant.savvyBuyFactor) : merchantPrice(tier);
  // The purse price rides the **shared gate** as a gold knob (D61) — the same
  // check/spend path as Patronize and every overworld action, so "what paying
  // gold means" lives in one place ({@link checkOverworldCost}), not per verb.
  // The registry row declares the axis; the exact per-cast price overlays it.
  const cost: OverworldCost = { ...VERB_COSTS["merchant-buy"], gold: price };
  const check = checkOverworldCost(run, "merchant-buy", cost, `buy ${materialId}`);
  if (!check.ok) return { applied: false, reason: check.reason, price };
  if (!canAdd(run.inventory, materialId)) {
    return { applied: false, reason: `No storage room for ${materialId}.`, price };
  }
  check.commit();
  addItem(run.inventory, materialId);
  if (primed) consumeFlag(run.overworld, DEAL_PRIMED_FLAG); // cash the bargain only on success
  return { applied: true, detail: `Bought ${materialId} for ${price}g${primed ? " (savvy barter)" : ""} (${tier} market).`, spent: price, price };
}

// --- Merchant — SELL (goods -> gold, gated by market access, D61) ------------

/** Gold one unit of `material` fetches at a `tier` market (0 = can't sell here). */
export function sellPrice(material: MaterialDef, tier: MarketTier): number {
  return Math.floor(saleValueOf(material) * ECONOMY.merchant.sellRate[tier]);
}

/** What a Merchant sell produced. */
export interface MerchantSellResult extends ActionOutcome {
  /** Gold credited to the purse (after any Banker-debt auto-repay). */
  earned?: number;
  /** The unit price paid at this market. */
  price?: number;
  /** Character levels the brokering Merchant gained from the sale (D32/D53). */
  levels?: number;
}

/**
 * Merchant Sell's cost (D61/#112): **selfLimited** — the verb is bounded by a finite
 * consumable (you can only sell goods you carry), the escape hatch the two-axis menu
 * declares for exactly this shape. What was an informal justification in a comment is
 * now data the load-time invariant validates, routed through the same check/commit
 * gate as every other verb (no numbers change; the gate never refuses a selfLimited
 * cost — the carried stock is the limiter).
 */
export const MERCHANT_SELL_COST: OverworldCost = { selfLimited: true };

/**
 * **Merchant SELL** (D61): convert one unit of a carried good into **purse gold** at
 * the **current node's effective market tier** ({@link "./overworld".effectiveMarketTier}
 * — the node's own market raised by a Merchant in the party). This is the Merchant's
 * honest gold faucet (goods -> gold), replacing the retired money-printer: you can't
 * sell what you don't carry, nor at a `none` market. Refuses (spending/removing
 * nothing) if the item isn't carried, isn't sellable, or there's no market here.
 * Gold routes to the purse via {@link "./economy".gainRunGold} (auto-repays debt, D30).
 */
export function merchantSell(run: RunState, materialId: string): MerchantSellResult {
  const material = getMaterial(materialId);
  if (!material) return { applied: false, reason: `Unknown material "${materialId}".` };
  if (countOf(run.inventory, materialId) <= 0) {
    return { applied: false, reason: `No ${material.name} to sell.` };
  }
  const tier = effectiveMarketTier(getNode(run.map, run.mapNodeId), run.party, run.overworld);
  const base = sellPrice(material, tier);
  if (base <= 0) {
    const why = saleValueOf(material) <= 0 ? `${material.name} can't be sold.` : `No market here to sell ${material.name}.`;
    return { applied: false, reason: why, price: base };
  }
  // Savvy Barter (D70): a primed deal fetches +25% on the next sale (consumed on success).
  const primed = isPrimed(run.overworld, DEAL_PRIMED_FLAG);
  const price = primed ? Math.floor(base * ECONOMY.merchant.savvySellFactor) : base;
  // The shared gate (D61/#112): selfLimited — never refuses (the carried stock is the
  // limiter), but the verb rides the same check/commit rails as every gated verb.
  const check = checkOverworldCost(run, "merchant-sell", VERB_COSTS["merchant-sell"], `sell ${material.name}`);
  if (!check.ok) return { applied: false, reason: check.reason, price };
  removeItem(run.inventory, materialId, 1);
  const { credited } = gainRunGold(run, price, "sale", `Sold ${material.name}`);
  check.commit(); // a no-op spend (selfLimited declares no knobs) — the shared rail, kept honest
  if (primed) consumeFlag(run.overworld, DEAL_PRIMED_FLAG);
  // The Merchant grows from its signature work (D32/D53) — replacing the use-XP the
  // retired Trade camp skill used to grant. Only a live Merchant brokers (and levels).
  const broker = fieldedUnits(run.party).find((u) => primaryJobOf(u) === "merchant");
  const levels = broker ? grantAbilityUseXp(broker) : 0;
  return { applied: true, earned: credited, price, levels, detail: `Sold ${material.name} for ${price}g${primed ? " (savvy barter)" : ""} (${tier} market).` };
}

// --- Banker — TIME-SHIFT + SECURE (purse only, never the treasury) ----------

/**
 * True if the party fields a **Banker** — the {@link "./jobs".BANKER} job (D30), the
 * financier whose verbs (Invest / Borrow / Guard the Purse) work the carried purse.
 * The third economy class's twin of {@link hasNoble} / {@link "./overworld".merchantFloor}:
 * a class in the party unlocks that class's economy. No Banker present ⇒ no purse-finance.
 */
export function hasBanker(party: readonly Unit[]): boolean {
  return fieldsJob(party, "banker");
}

/**
 * Engage Interest's cost (D61/#112 step 1): **once per node** — a toggle, re-armed each
 * node-step. An illustrative structure-proving default (the house D80-brief rule), not a
 * balance call: the point is that the verb is no longer unpaced AND unpriced.
 */
export const BANKER_INTEREST_COST: OverworldCost = { usesPerNode: 1 };

/** What engaging purse interest produced. */
export interface BankerInterestResult extends ActionOutcome {
  /** The per-node-step credit now engaged. */
  perStep?: number;
}

/**
 * **Banker TIME-SHIFT** (D30): engage flat purse **interest**. Sets a per-node-step
 * credit of `ceil(purse × rate)` (at least 1 when the purse is non-empty), accrued
 * by {@link "./overworld-actions".accruePurseInterest} as the caravan advances.
 * Purse-only — it never touches the treasury (D34). Job-gated (the Banker's verb) and
 * paced through the shared D61 gate (**once per node** — re-arming waits for Break
 * Camp, #112): refuses without a Banker, when already engaged this node, or with an
 * empty purse (nothing to earn on — the use isn't burned).
 */
export function bankerEngageInterest(run: RunState): BankerInterestResult {
  if (!hasBanker(run.party)) return { applied: false, reason: "No Banker in the party to engage interest." };
  // The shared two-axis gate (D61/#112): a toggle, once per node.
  const check = checkOverworldCost(run, "banker-interest", VERB_COSTS["banker-interest"], "Engage Interest");
  if (!check.ok) return { applied: false, reason: check.reason };
  if (run.camp.gold <= 0) return { applied: false, reason: "No purse to earn interest on." };
  const perStep = Math.max(1, Math.ceil(run.camp.gold * ECONOMY.banker.interestRate));
  run.overworld.interestPerStep = perStep;
  check.commit();
  return { applied: true, perStep, detail: `Purse interest engaged — +${perStep}g per node-step.` };
}

/** What a buy-on-debt drew. */
export interface BankerBorrowResult extends ActionOutcome {
  /** Gold advanced to the purse. */
  borrowed?: number;
  /** The new outstanding debt balance. */
  debt?: number;
}

/**
 * Borrow's cost (D61/#112 step 1): **one loan arrangement per node**. An illustrative
 * structure-proving default (the house D80-brief rule) — the natural future price axis
 * is a **debt ceiling** (cap outstanding principal against expected loot), a knob for
 * the decision record, not this pass.
 */
export const BANKER_BORROW_COST: OverworldCost = { usesPerNode: 1 };

/**
 * **Banker BUY-ON-DEBT** (D30): advance gold to the purse **now**, recorded as debt
 * that **auto-repays from incoming run gold** ({@link "./economy".gainRunGold}).
 * Lets a caravan overspend on a key buy/bribe and settle it from later loot. Purse
 * + debt only — the treasury is never involved (D34). Paced through the shared D61
 * gate (**one loan arrangement per node**, #112) — no longer an unbounded advance.
 */
export function bankerBorrow(run: RunState, amount: number): BankerBorrowResult {
  if (!hasBanker(run.party)) return { applied: false, reason: "No Banker in the party to advance a loan." };
  const borrowed = nonNegInt(amount);
  if (borrowed <= 0) return { applied: false, reason: "Nothing to borrow." };
  // The shared two-axis gate (D61/#112): one loan arrangement per node.
  const check = checkOverworldCost(run, "banker-borrow", VERB_COSTS["banker-borrow"], "Borrow");
  if (!check.ok) return { applied: false, reason: check.reason };
  earn(run.camp, borrowed, "banker", "Banker loan", { nodeId: run.mapNodeId, night: run.night });
  run.overworld.debt += borrowed;
  check.commit();
  return { applied: true, borrowed, debt: run.overworld.debt, detail: `Borrowed ${borrowed}g against future loot.` };
}

/** What buying theft protection produced. */
export interface BankerProtectResult extends ActionOutcome {
  /** Purse gold spent. */
  spent?: number;
  /** The protection level now in effect (a [0,1) skim reduction). */
  protection?: number;
}

/**
 * **Banker SECURE** (D30): buy **theft protection** — a [0,1) skim reduction that
 * blunts both the mid-battle thief and the thief event node ({@link "./theft"}).
 * Spends from the purse; refuses if it can't be covered. Purse only — never the
 * treasury (D34).
 */
/** Banker theft-protection cost (D61) — gold-priced; hoisted so the D61 guard test can validate it. */
export const BANKER_PROTECT_COST: OverworldCost = { gold: ECONOMY.banker.protectionCost };

export function bankerProtect(run: RunState): BankerProtectResult {
  if (!hasBanker(run.party)) return { applied: false, reason: "No Banker in the party to guard the purse." };
  // Gold-priced through the shared gate (D61) — same path as Patronize / the Merchant buy.
  const check = checkOverworldCost(run, "banker-protect", VERB_COSTS["banker-protect"], "theft protection");
  if (!check.ok) return { applied: false, reason: check.reason };
  check.commit();
  run.overworld.protection = Math.max(run.overworld.protection, ECONOMY.banker.protectionLevel);
  return { applied: true, spent: ECONOMY.banker.protectionCost, protection: run.overworld.protection, detail: `Theft protection engaged.` };
}

// --- Noble — INFLUENCE (a walled-off, per-expedition currency, D62) ----------

/**
 * True if the party fields a **Thief** — the {@link "./jobs".THIEF_JOB} prestige (D68), the
 * unseen hand whose **Deft Hands** skims coin off busy nodes. Mirrors {@link hasBanker} /
 * {@link hasNoble}: a class in the party unlocks that class's economy.
 */
export function hasThief(party: readonly Unit[]): boolean {
  return fieldsJob(party, "thief");
}

/** Deft Hands tuning (D68) — the per-node skim chance + take. Tunable; modest vs the scarce economy. */
export const DEFT_HANDS = { chance: 0.5, gold: 25 } as const;

/**
 * **Deft Hands** (D68) — the Thief's passive node skim: leaving a busy node (a **combat**
 * or **event** node — never a quiet rest), the thief has a seeded {@link DEFT_HANDS.chance}
 * to pocket {@link DEFT_HANDS.gold} into the purse. Deterministic per node-step
 * (`streamFor(seed, "deft:<node>:<night>")`) — no live RNG. A no-op (0) with no Thief
 * present, on a rest node, or on a missed roll. Fired by {@link "./run".breakCamp}.
 */
export function deftHandsSkim(run: RunState): number {
  if (!hasThief(run.party)) return 0;
  const kind = getNode(run.map, run.mapNodeId).kind;
  if (kind !== "combat" && kind !== "event") return 0;
  const rng = streamFor(run.seed, Labels.deft(run.mapNodeId, run.night));
  if (!rng.chance(DEFT_HANDS.chance)) return 0;
  earn(run.camp, DEFT_HANDS.gold, "deft-hands", "Deft Hands skim", { nodeId: run.mapNodeId, night: run.night });
  return DEFT_HANDS.gold;
}

/**
 * True if the party fields a **Noble** — the {@link "./jobs".NOBLE} job (D62), the
 * standing-bearer whose presence accrues Influence, works the Patronize verb, and
 * backs the mid-battle bribe ({@link bribeEnemy}). Mirrors {@link
 * "./overworld".merchantFloor}: a class in the party unlocks that class's economy.
 * This is the real-job gate that **replaced the interim Intelligence-≥-3 proxy** —
 * "a Noble is present" is now job-specific, not a stat threshold any member can clear.
 */
export function hasNoble(party: readonly Unit[]): boolean {
  return fieldsJob(party, "noble");
}

/**
 * Influence a party accrues per node-step from declared {@link "./jobs".JobFaucet}s (D72) —
 * **Renown as data**: each fielded member's `faucet.influencePerStep`, summed. The **Noble**
 * (D71) is the first declarer (`influencePerStep: 1`); `lookup` injectable for fixtures.
 */
export function declaredFaucetInfluence(party: readonly Unit[], lookup: JobLookup = getJob): number {
  let inf = 0;
  for (const u of fieldedUnits(party)) {
    inf += lookup(primaryJobOf(u))?.faucet?.influencePerStep ?? 0;
  }
  return inf;
}

/**
 * Accrue declared per-step **Influence faucets** one node-step (D72) — the Noble's **Renown**
 * (D71), declared on its {@link "./jobs".JobDef} rather than a hardcoded fn (this **retired**
 * the old `accrueNobleInfluence`). Credited to the run's per-expedition standing (never the
 * guild); called from {@link "./run".breakCamp}. Returns the Influence gained.
 */
export function accrueDeclaredFaucets(run: RunState, lookup: JobLookup = getJob): number {
  const gain = declaredFaucetInfluence(run.party, lookup);
  if (gain > 0) addInfluence(run.overworld, gain);
  return gain;
}

/** What a Patronize produced. */
export interface PatronizeResult extends ActionOutcome {
  /** Purse gold spent. */
  spent?: number;
  /** Influence gained. */
  gained?: number;
}

/** Patronize's two-axis cost (D61/D62): once per node (pacing) × purse gold (price). */
export const PATRONIZE_COST: OverworldCost = { usesPerNode: 1, gold: ECONOMY.noble.patronizeCost };

/**
 * **Noble PATRONIZE** (D62): spend purse gold to court patrons — an *active* Influence
 * faucet (gold → standing) layered on the passive presence accrual. Routed through the
 * shared two-axis limiter ({@link "./overworld-actions".checkOverworldCost}): **once per
 * node** and **gold-priced**, so it can't be spammed (the D61 fold reaching the economy
 * verbs). Requires a Noble in the party. Influence is per-expedition — never the guild.
 */
export function patronize(run: RunState): PatronizeResult {
  if (!hasNoble(run.party)) {
    return { applied: false, reason: "No Noble in the party to court patrons." };
  }
  const check = checkOverworldCost(run, "patronize", VERB_COSTS["patronize"], "Patronize");
  if (!check.ok) return { applied: false, reason: check.reason };
  const yield_ = ECONOMY.noble.patronizeYield;
  addInfluence(run.overworld, yield_);
  check.commit();
  return {
    applied: true,
    spent: ECONOMY.noble.patronizeCost,
    gained: yield_,
    detail: `Patronized for ${yield_} Influence (${ECONOMY.noble.patronizeCost}g).`,
  };
}

/** What a bribe attempt produced. */
export interface BribeResult extends ActionOutcome {
  /** Influence spent (on a success **or** a failed roll — the gamble). */
  cost?: number;
  /**
   * True when the Influence was spent but the enemy **resisted** the sway (the roll
   * failed) — distinct from `applied: false` with no `failed` (couldn't even afford it).
   */
  failed?: boolean;
  /** How the swayed unit resolves after the battle (temp generic / perm authored). */
  outcome?: RecruitOutcome;
}

/**
 * The Influence cost to bribe an enemy (D30/D62): cheaper the more the **D24 preview**
 * reveals (knowing the field is leverage) *and* the higher the briber's **standing**
 * (`tier` — a renowned Noble sways cheaply). Never below 1.
 */
export function bribeCost(preview?: NodePreview, tier: InfluenceTier = "unknown"): number {
  const intel = preview?.intel?.tier ?? 0;
  return Math.max(1, ECONOMY.noble.bribeBase - intel - ECONOMY.noble.bribeDiscount[tier]);
}

/** The chance a bribe **succeeds** at the briber's standing band (D62) — rises with standing. */
export function bribeChance(tier: InfluenceTier): number {
  return ECONOMY.noble.bribeChance[tier];
}

/**
 * **Noble BRIBE** (D30/D33/D62): sway an enemy by spending **Influence**. Price and
 * odds both read the briber's **standing** (and the D24 `preview`): a higher band sways
 * cheaper *and* likelier. The sway is a **roll** — it can **fail**, and a failed roll
 * still **spends the Influence** (the gamble). The roll is **deterministic per target +
 * node** ({@link "./rng".streamFor}), so it can't be save-scummed — raise your standing
 * to shift the odds, you can't reroll the same foe. On success the caller flips the unit
 * for the fight; how it resolves *after* is the temp↔permanent vector (D33): a **generic**
 * is temporary, an **authored** one a permanent recruit. Refuses (spending nothing) only
 * when the run can't afford the cost. Spends the run's per-expedition standing, not the guild.
 *
 * **Deliberately off-gate (#112):** the bribe spends Influence directly via
 * {@link "./economy".spendInfluence} (its price is computed per target from intel +
 * standing), so it has no {@link VERB_COSTS} row — the noted **D112-step-2 (R4)
 * migration target** onto the gate's reserved `influence` knob, not a silent exemption.
 * The guard test in `overworld-actions.test.ts` carries the same note.
 */
export function bribeEnemy(run: RunState, enemy: Pick<Unit, "id" | "authored" | "name">, preview?: NodePreview): BribeResult {
  // Job-gated like Patronize (D62): the bribe is the Noble's verb — without a Noble in
  // the party there is no standing-bearer to broker the sway (refuses, spending nothing).
  if (!hasNoble(run.party)) {
    return { applied: false, reason: "No Noble in the party to broker a bribe." };
  }
  const tier = influenceTier(run.overworld.influence);
  const cost = bribeCost(preview, tier);
  if (!spendInfluence(run.overworld, cost)) {
    return { applied: false, reason: `Not enough Influence to bribe ${enemy.name} (${cost}).`, cost };
  }
  // The sway roll — likelier at higher standing, fixed per target+node (no save-scum).
  const roll = streamFor(run.seed, Labels.bribe(run.mapNodeId, enemy.id));
  if (!roll.chance(bribeChance(tier))) {
    return { applied: false, failed: true, cost, detail: `${enemy.name} spurns the offer — ${cost} Influence spent for nothing.` };
  }
  const outcome = recruitClassify(enemy);
  const detail = outcome.permanent
    ? `${enemy.name} is swayed — joins permanently after the battle.`
    : `${enemy.name} turns coat for the rest of the battle.`;
  return { applied: true, cost, outcome, detail };
}

// --- Triage — the healer's fatigue-fuelled camp heal (the audit pass) --------

/** Triage tuning — the healer's between-nodes heal, all data. */
export const TRIAGE = {
  /**
   * Fatigue the healer spends per Triage — a **demanding** cost (D73): over-triaging pushes the
   * healer through Weary into Exhausted, where their own rest-heal costs more RP and they field
   * **Slowed** next fight. That mounting consequence — not a hard lock — is the limiter (pure
   * fatigue — no RP, the Rest's currency).
   */
  fatigue: 2,
  /** Flat HP floor a Triage restores before the Triage-scaling on missing HP. */
  base: 6,
} as const;

/**
 * Triage's two-axis cost (D61) — the **demanding** fatigue price the shared gate validates +
 * spends. Triage is a **standalone** verb, outside the `JobDef.skills` load-time validator,
 * so this object is its row in the {@link VERB_COSTS} registry (#112). Defined beside its
 * verb (its home), and the registry entry is this same object, so there is exactly one source
 * of truth.
 */
export const TRIAGE_COST: OverworldCost = { fatigue: TRIAGE.fatigue };

/**
 * True if `unit` is a **healing class** — a job stamped with the Medic's Triage
 * passive ({@link "./combat".PASSIVE.triage}). The capability gate for {@link triage},
 * now the `healer` entry of the shared {@link "./jobs".unitHasCapability} taxonomy
 * (D72) — own the capability, not a hard-coded job id, so it **auto-extends to any
 * future healer**. Reads the **job def** (not `unit.passives`, which is only stamped at
 * battle setup), so it's valid in camp. Kept as a named alias for the many call sites.
 */
export function isHealer(unit: Unit): boolean {
  return unitHasCapability(unit, "healer");
}

/** What a camp {@link triage} produced. */
export interface TriageResult extends ActionOutcome {
  /** HP restored to the treated fighter. */
  healed?: number;
  /** The treated unit's id. */
  targetId?: string;
  /** Fatigue spent on the healer (base + any over-extension surcharge). */
  fatigueSpent?: number;
}

/**
 * **Triage** (the audit pass) — the **healer's** camp heal, distinct from the universal
 * Rest ({@link "./upkeep".restHeal}, RP/rations): a healing class spends **their own
 * fatigue** (worn out) to mend the party's **most-wounded** fighter for *more* than a
 * Rest — scaling with the Medic's Triage (heal harder the worse the wound). Job-gated to
 * a {@link isHealer} (only a healer can triage); the fatigue rides the shared
 * {@link "./overworld-cost".checkOverworldCost} gate. Over-triaging is **not** locked (D73) — it accrues fatigue
 * toward the Exhausted consequences (pricier rest-heal, the combat Slow), the consequence-based
 * limiter. Pure fatigue — no RP. Refuses (spending nothing) without a healer or with no one wounded.
 */
export function triage(run: RunState, healer: Unit): TriageResult {
  if (!isHealer(healer)) {
    return { applied: false, reason: `${healer.name} can't triage — only a healer can.` };
  }
  // Triage treats the worst first: the most-wounded fielded ally.
  const wounded = fieldedUnits(run.party)
    .filter((u) => u.hp < u.maxHp)
    .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
  if (!wounded) return { applied: false, reason: "No wounded fighter to triage." };

  const cost = TRIAGE_COST;
  const check = checkOverworldCost(run, "triage", cost, "Triage", healer);
  if (!check.ok) return { applied: false, reason: check.reason };

  // Heal scales with the healer's Triage (read from the job def — camp units aren't
  // stamped) and the wound's depth: more missing HP → more healing.
  const triageVal = getJob(primaryJobOf(healer))?.passives?.[PASSIVE.triage] ?? 0;
  const amount = TRIAGE.base + Math.floor(triageVal * (wounded.maxHp - wounded.hp));
  const healed = healUnit(wounded, amount);
  check.commit();
  return {
    applied: true,
    healed,
    targetId: wounded.id,
    fatigueSpent: check.prices.fatigue,
    detail: `Triaged ${wounded.name}: +${healed} HP (${healer.name} worn out).`,
  };
}

// --- The standalone-verb cost registry (D61/#112 step 1) ---------------------

/**
 * The **standalone-verb cost registry** — the two-axis invariant's second home,
 * making it **total**. The load-time walk over `JOBS[*].skills`
 * ({@link "./overworld-cost"}) covers every verb that lives on a job; every
 * economy verb that is a **free function** (this module's, plus Triage) registers
 * its {@link OverworldCost} here, and the walk below validates each at import —
 * an unpaced, unpriced standalone verb **fails at module load**, exactly like a
 * bad skill record. The hoisted per-verb consts ARE the entries (one source of
 * truth — the verbs read their costs from these rows); the guard test in
 * `overworld-actions.test.ts` asserts every exported verb resolver has a row, so
 * a NEW standalone verb without a registration fails the suite by name.
 *
 * **Deliberately off-gate:** {@link bribeEnemy} spends Influence via
 * {@link "./economy".spendInfluence} (a per-target computed price) — the noted
 * D112-step-2 (R4) migration target onto the gate's reserved `influence` knob,
 * not a silent exemption.
 */
export const VERB_COSTS: Readonly<Record<string, OverworldCost>> = {
  "merchant-buy": MERCHANT_BUY_COST,
  "merchant-sell": MERCHANT_SELL_COST,
  "banker-interest": BANKER_INTEREST_COST,
  "banker-borrow": BANKER_BORROW_COST,
  "banker-protect": BANKER_PROTECT_COST,
  patronize: PATRONIZE_COST,
  triage: TRIAGE_COST,
};

// Enforce the D61 two-axis invariant over the standalone verbs at module load (#112)
// — the twin of overworld-actions' JOBS[*].skills walk. With both homes validated at
// import, "free and unlimited" is unrepresentable wherever a verb lives.
for (const [id, cost] of Object.entries(VERB_COSTS)) validateOverworldCost(id, cost);
