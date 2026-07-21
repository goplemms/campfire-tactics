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
import { checkOverworldCost, overworldCostOf, type OverworldCost } from "./overworld-cost";
import { MERCHANT_SELL, BANKER_INTEREST, BANKER_BORROW, BANKER_GUARD, NOBLE_PATRONIZE, UNIVERSAL_BUY } from "./jobs-data/support";
import { MEDIC_TRIAGE } from "./jobs-data/combat";
import { getDifficulty } from "./mortality";
import { DEAL_PRIMED_FLAG, type ActionOutcome } from "./overworld-actions";
import { earn } from "./purse-journal";
import type { NodePreview } from "./intel";
import { nonNegInt } from "./num";
import { addItem, canAdd, countOf, removeItem, getMaterial, saleValueOf, type MaterialDef } from "./inventory";
import { streamFor } from "./rng";
import { Labels } from "./rng-labels";
import { addInfluence, gainRunGold, influenceTier, type InfluenceTier } from "./economy";
import { grantAbilityUseXp } from "./leveling";
import { chunkHp } from "./upkeep";
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
 * The Merchant Buy **gold price** at the run's current node — the market-tier base price (D61).
 * The provider body the universal Buy skill's `overworldCost.gold` calls (R4/A, #112), and the
 * base {@link merchantBuy} overlays a primed Savvy-Barter discount onto before the gate. A hoisted
 * function (not a const) so jobs-data can reference it in a lazy cost provider with no init cycle.
 */
export function merchantBuyGold(run: RunState): number {
  return merchantPrice(effectiveMarketTier(getNode(run.map, run.mapNodeId), run.party, run.overworld));
}

/** What a Merchant buy produced. */
export interface MerchantBuyResult extends ActionOutcome {
  /** Purse gold spent. */
  spent?: number;
  /** The market-tier price paid. */
  price?: number;
}

/**
 * **Merchant ACCESS** (D30/D61): spend **run-gold** (the purse, `camp.purse`) to buy
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
  const price = buyPriceFor(tier, primed);
  // The purse price rides the **shared gate** as a gold knob (D61) — the same
  // check/spend path as Patronize and every overworld action, so "what paying
  // gold means" lives in one place ({@link checkOverworldCost}), not per verb.
  // The registry row declares the axis; the exact per-cast price overlays it.
  const cost: OverworldCost = { ...overworldCostOf(UNIVERSAL_BUY), gold: price };
  const check = checkOverworldCost(run, "merchant-buy", cost, `buy ${materialId}`);
  if (!check.ok) return { applied: false, reason: check.reason, price };
  if (!canAdd(run.inventory, materialId)) {
    return { applied: false, reason: `No storage room for ${materialId}.`, price };
  }
  check.commit();
  applyBuyEffect(run, materialId, tier, price, primed); // add the item + cash the bargain
  return { applied: true, detail: `Bought ${materialId} for ${price}g${primed ? " (savvy barter)" : ""} (${tier} market).`, spent: price, price };
}

/** The per-cast buy price at `tier`, with the Savvy-Barter half-off overlay when a deal is `primed` (D70). */
export function buyPriceFor(tier: MarketTier, primed: boolean): number {
  return primed ? Math.ceil(merchantPrice(tier) * ECONOMY.merchant.savvyBuyFactor) : merchantPrice(tier);
}

/**
 * **Buy** one supply into caravan storage — the post-gate mutation shared by {@link merchantBuy}
 * (the legacy verb) and the `buy` overworld-effect handler (the universal skill, R4/A). Refuses
 * (mutating nothing) at a `none` market or a full stash, else adds the item and cashes any primed
 * Savvy-Barter bargain. Pure of the cost gate — the gold price rides {@link checkOverworldCost}
 * (the caller charges `price`); this only realizes the effect once payment is settled.
 */
export function applyBuyEffect(
  run: RunState,
  materialId: string,
  tier: MarketTier,
  price: number,
  primed: boolean,
): { ok: true; detail: string } | { ok: false; reason: string } {
  if (tier === "none") return { ok: false, reason: `No market here to buy ${materialId}.` };
  if (!canAdd(run.inventory, materialId)) return { ok: false, reason: `No storage room for ${materialId}.` };
  addItem(run.inventory, materialId);
  if (primed) consumeFlag(run.overworld, DEAL_PRIMED_FLAG); // cash the bargain only on success
  return { ok: true, detail: `Bought ${materialId} for ${price}g${primed ? " (savvy barter)" : ""} (${tier} market).` };
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
 * **Merchant SELL** (D61): convert one unit of a carried good into **purse gold** at
 * the **current node's effective market tier** ({@link "./overworld".effectiveMarketTier}
 * — the node's own market raised by a Merchant in the party). This is the Merchant's
 * honest gold faucet (goods -> gold), replacing the retired money-printer: you can't
 * sell what you don't carry, nor at a `none` market. Refuses (spending/removing
 * nothing) if the item isn't carried, isn't sellable, or there's no market here.
 * Gold routes to the purse via {@link "./economy".gainRunGold} (auto-repays debt, D30).
 */
export function merchantSell(run: RunState, materialId: string): MerchantSellResult {
  // The shared gate (D61/#112): selfLimited — never refuses (the carried stock is the
  // limiter), but the verb rides the same check/commit rails as every gated verb.
  const check = checkOverworldCost(run, "merchant-sell", overworldCostOf(MERCHANT_SELL), `sell ${materialId}`);
  if (!check.ok) return { applied: false, reason: check.reason };
  const core = applySellEffect(run, materialId);
  if (!core.ok) return { applied: false, reason: core.reason, price: core.price };
  check.commit(); // a no-op spend (selfLimited declares no knobs) — the shared rail, kept honest
  // The Merchant grows from its signature work (D32/D53) — replacing the use-XP the
  // retired Trade camp skill used to grant. Only a live Merchant brokers (and levels).
  const broker = fieldedUnits(run.party).find((u) => primaryJobOf(u) === "merchant");
  const levels = broker ? grantAbilityUseXp(broker) : 0;
  return { applied: true, earned: core.earned, price: core.price, levels, detail: core.detail };
}

/**
 * **Sell** one carried good into purse gold at the current node's effective market tier — the
 * post-gate mutation shared by {@link merchantSell} (the legacy verb) and the `sell`
 * overworld-effect handler (R4/A). Refuses (removing/crediting nothing) if the good isn't
 * carried, isn't sellable, or there's no market here; else removes one, credits the purse via
 * {@link "./economy".gainRunGold} (auto-repaying debt), and cashes any primed Savvy-Barter deal.
 * Pure of the cost gate + use-XP — the caller owns those (a selfLimited sell spends no knob).
 */
export function applySellEffect(
  run: RunState,
  materialId: string,
): { ok: true; detail: string; earned: number; price: number } | { ok: false; reason: string; price: number } {
  const material = getMaterial(materialId);
  if (!material) return { ok: false, reason: `Unknown material "${materialId}".`, price: 0 };
  if (countOf(run.inventory, materialId) <= 0) {
    return { ok: false, reason: `No ${material.name} to sell.`, price: 0 };
  }
  const tier = effectiveMarketTier(getNode(run.map, run.mapNodeId), run.party, run.overworld);
  const base = sellPrice(material, tier);
  if (base <= 0) {
    const why = saleValueOf(material) <= 0 ? `${material.name} can't be sold.` : `No market here to sell ${material.name}.`;
    return { ok: false, reason: why, price: base };
  }
  // Savvy Barter (D70): a primed deal fetches +25% on the next sale (consumed on success).
  const primed = isPrimed(run.overworld, DEAL_PRIMED_FLAG);
  const price = primed ? Math.floor(base * ECONOMY.merchant.savvySellFactor) : base;
  removeItem(run.inventory, materialId, 1);
  const { credited } = gainRunGold(run, price, "sale", `Sold ${material.name}`);
  if (primed) consumeFlag(run.overworld, DEAL_PRIMED_FLAG);
  return { ok: true, earned: credited, price, detail: `Sold ${material.name} for ${price}g${primed ? " (savvy barter)" : ""} (${tier} market).` };
}

// --- Banker — TIME-SHIFT + SECURE (purse only, never the treasury) ----------

/**
 * True if the party fields a **Banker** — the {@link "./jobs".BANKER_JOB} job (D30), the
 * financier whose verbs (Invest / Borrow / Guard the Purse) work the carried purse.
 * The third economy class's twin of {@link hasNoble} / {@link "./overworld".merchantFloor}:
 * a class in the party unlocks that class's economy. No Banker present ⇒ no purse-finance.
 */
export function hasBanker(party: readonly Unit[]): boolean {
  return fieldsJob(party, "banker");
}

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
  const check = checkOverworldCost(run, "banker-interest", overworldCostOf(BANKER_INTEREST), "Engage Interest");
  if (!check.ok) return { applied: false, reason: check.reason };
  const core = applyEngageInterestEffect(run);
  if (!core.ok) return { applied: false, reason: core.reason };
  check.commit();
  return { applied: true, perStep: core.perStep, detail: core.detail };
}

/**
 * **Engage purse interest** — the post-gate mutation shared by {@link bankerEngageInterest} and
 * the `engageInterest` overworld-effect handler (R4/A). Refuses on an empty purse (nothing to
 * earn on — the use isn't burned); else sets the per-node-step credit
 * ({@link "./overworld-actions".accruePurseInterest} accrues it). Pure of the cost gate.
 */
export function applyEngageInterestEffect(
  run: RunState,
): { ok: true; detail: string; perStep: number } | { ok: false; reason: string } {
  if (run.camp.purse <= 0) return { ok: false, reason: "No purse to earn interest on." };
  const perStep = Math.max(1, Math.ceil(run.camp.purse * ECONOMY.banker.interestRate));
  run.overworld.interestPerStep = perStep;
  return { ok: true, detail: `Purse interest engaged — +${perStep}g per node-step.`, perStep };
}

/** What a buy-on-debt drew. */
export interface BankerBorrowResult extends ActionOutcome {
  /** Gold advanced to the purse. */
  borrowed?: number;
  /** The new outstanding debt balance. */
  debt?: number;
}

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
  const check = checkOverworldCost(run, "banker-borrow", overworldCostOf(BANKER_BORROW), "Borrow");
  if (!check.ok) return { applied: false, reason: check.reason };
  const core = applyBorrowEffect(run, borrowed);
  check.commit();
  return { applied: true, borrowed: core.borrowed, debt: core.debt, detail: core.detail };
}

/**
 * **Borrow** against future loot — the post-gate mutation shared by {@link bankerBorrow} and the
 * `borrow` overworld-effect handler (R4/A): advance `amount` (sanitized) to the purse and record
 * the debt (auto-repaid from incoming run gold). Assumes a positive, sanitized amount (the caller
 * gates `amount <= 0`). Pure of the cost gate.
 */
export function applyBorrowEffect(run: RunState, amount: number): { ok: true; detail: string; borrowed: number; debt: number } {
  const borrowed = nonNegInt(amount);
  earn(run.camp, borrowed, "banker", "Banker loan", { nodeId: run.mapNodeId, night: run.night });
  run.overworld.debt += borrowed;
  // `ok: true` is the contract, not a check: this core cannot refuse (the caller gates) —
  // the literal type states it, matching the refusal-capable sibling cores (D114).
  return { ok: true, borrowed, debt: run.overworld.debt, detail: `Borrowed ${borrowed}g against future loot.` };
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
 * treasury (D34). Cost + effect now live on the {@link "./jobs-data/support".BANKER_GUARD}
 * SkillDef (R4/A, #112): the verb reads its gold price via `overworldCostOf`.
 */

export function bankerProtect(run: RunState): BankerProtectResult {
  if (!hasBanker(run.party)) return { applied: false, reason: "No Banker in the party to guard the purse." };
  // Gold-priced through the shared gate (D61) — same path as Patronize / the Merchant buy.
  const check = checkOverworldCost(run, "banker-protect", overworldCostOf(BANKER_GUARD), "theft protection");
  if (!check.ok) return { applied: false, reason: check.reason };
  check.commit();
  const core = applyGuardPurseEffect(run);
  return { applied: true, spent: ECONOMY.banker.protectionCost, protection: core.protection, detail: core.detail };
}

/**
 * **Guard the purse** — the post-gate mutation shared by {@link bankerProtect} and the
 * `guardPurse` overworld-effect handler (R4/A): engage theft protection ({@link "./theft"}) at
 * the Banker's level (never lowering an already-higher protection). Pure of the cost gate (the
 * gold price rides {@link checkOverworldCost}).
 */
export function applyGuardPurseEffect(run: RunState): { ok: true; detail: string; protection: number } {
  run.overworld.protection = Math.max(run.overworld.protection, ECONOMY.banker.protectionLevel);
  return { ok: true, protection: run.overworld.protection, detail: `Theft protection engaged.` };
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

/** Deft Hands tuning (D68) — the per-node skim chance + take. Tunable; modest vs the scarce economy. The Thief's {@link "./jobs".JobFaucet} `goldSkim` declaration mirrors these (a parity test pins it). */
export const DEFT_HANDS = { chance: 0.5, gold: 25 } as const;

/**
 * **Deft Hands** (D68/#114) — the Thief's passive node skim, now resolved off the **declared
 * {@link "./jobs".JobFaucet} `goldSkim`** (no longer a hardcoded `DEFT_HANDS` read): the first
 * fielded member whose job declares a `goldSkim` faucet skims a busy node — leaving a **combat** or
 * **event** node (never a quiet rest), a seeded `chance` to pocket `amount` gold into the purse.
 * Deterministic per node-step (`streamFor(seed, Labels.deft(node, night))` — the label moved here
 * **unchanged**, so the sim is byte-identical), fired **once** per step by the {@link
 * accrueDeclaredFaucets} walk (not per declarer). A no-op (0) with no declarer, on an off-kind node,
 * or on a missed roll. `lookup` injectable for fixtures.
 */
export function deftHandsSkim(run: RunState, lookup: JobLookup = getJob): number {
  for (const u of fieldedUnits(run.party)) {
    const skim = lookup(primaryJobOf(u))?.faucet?.goldSkim;
    if (!skim) continue;
    const kind = getNode(run.map, run.mapNodeId).kind;
    if (skim.nodeKinds && !skim.nodeKinds.includes(kind)) return 0;
    const rng = streamFor(run.seed, Labels.deft(run.mapNodeId, run.night));
    if (!rng.chance(skim.chance)) return 0;
    earn(run.camp, skim.amount, "deft-hands", "Deft Hands skim", { nodeId: run.mapNodeId, night: run.night });
    return skim.amount;
  }
  return 0;
}

/**
 * True if the party fields a **Noble** — the {@link "./jobs".NOBLE_JOB} job (D62), the
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
  // The gold skim (#114): the Thief's Deft Hands, now a declared `goldSkim` faucet resolved in the
  // same walk rather than a separate hardcoded breakCamp step. Influence first, then gold — the
  // pre-#114 order — so the seeded draw lands at the same point and the digest is byte-identical.
  deftHandsSkim(run, lookup);
  return gain;
}

/** What a Patronize produced. */
export interface PatronizeResult extends ActionOutcome {
  /** Purse gold spent. */
  spent?: number;
  /** Influence gained. */
  gained?: number;
}

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
  const check = checkOverworldCost(run, "patronize", overworldCostOf(NOBLE_PATRONIZE), "Patronize");
  if (!check.ok) return { applied: false, reason: check.reason };
  const core = applyPatronizeEffect(run);
  check.commit();
  return {
    applied: true,
    spent: ECONOMY.noble.patronizeCost,
    gained: core.gained,
    detail: core.detail,
  };
}

/**
 * **Patronize** — the post-gate mutation shared by {@link patronize} and the `patronize`
 * overworld-effect handler (R4/A): credit the run's per-expedition standing with the patronize
 * Influence yield (gold → standing). Pure of the cost gate (the gold price rides
 * {@link checkOverworldCost}).
 */
export function applyPatronizeEffect(run: RunState): { ok: true; detail: string; gained: number } {
  const yield_ = ECONOMY.noble.patronizeYield;
  addInfluence(run.overworld, yield_);
  return { ok: true, gained: yield_, detail: `Patronized for ${yield_} Influence (${ECONOMY.noble.patronizeCost}g).` };
}

/** What a bribe attempt produced. */
export interface BribeResult extends ActionOutcome {
  /**
   * The bribe's explicit tri-state (D115) — the gamble's three genuinely distinct ends,
   * previously hidden in a two-boolean combination (`applied` × `failed`):
   * - `"refused"` — couldn't attempt (no Noble / can't afford): **nothing spent**;
   * - `"resisted"` — the roll failed but the Influence and the Act are **spent** (D62's
   *   no-save-scum gamble);
   * - `"swayed"` — the enemy turns.
   * `applied` stays the {@link ActionOutcome} canon and is true exactly when
   * `status === "swayed"` (an invariant a test pins).
   */
  status: "refused" | "resisted" | "swayed";
  /** Influence spent (on a sway **or** a resisted roll — the gamble). */
  cost?: number;
  /** How the swayed unit resolves after the battle (temp generic / perm authored). */
  outcome?: RecruitOutcome;
}

/**
 * The Influence cost to bribe an enemy (D30/D62): cheaper the more the **D24 preview**
 * reveals (knowing the field is leverage) *and* the higher the briber's **standing**
 * (`tier` — a renowned Noble sways cheaply). Never below 1.
 */
export function bribePrice(preview?: NodePreview, tier: InfluenceTier = "unknown"): number {
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
 * **On-gate (#112, R4/A):** the Influence spend now rides the shared **influence knob** of
 * {@link "./overworld-cost".checkOverworldCost} — the price is still computed per target from
 * intel + standing ({@link bribePrice}), passed as the gate's inline `influence` cost, so the
 * refusal is **standard-shaped** and the spend rides the same check→commit closure as every
 * verb (the failed-roll gamble commits too). No {@link VERB_COSTS} row (its price is per-target,
 * not static); the D88 guard classifies it in GATED_ELSEWHERE with this where.
 */
export function bribeEnemy(run: RunState, enemy: Pick<Unit, "id" | "authored" | "name">, preview?: NodePreview): BribeResult {
  // Job-gated like Patronize (D62): the bribe is the Noble's verb — without a Noble in
  // the party there is no standing-bearer to broker the sway (refuses, spending nothing).
  if (!hasNoble(run.party)) {
    return { applied: false, status: "refused", reason: "No Noble in the party to broker a bribe." };
  }
  const tier = influenceTier(run.overworld.influence);
  const cost = bribePrice(preview, tier);
  // The Influence price rides the shared gate's reserved `influence` knob (R4/A): a pure check
  // (spends nothing) whose commit closure spends exactly `cost` — called on both branches below,
  // since a failed sway still spends the Influence (the gamble). Actorless (no fatigue).
  const check = checkOverworldCost(run, "bribe", { influence: cost }, `bribe ${enemy.name}`);
  if (!check.ok) return { applied: false, status: "refused", reason: check.reason, cost };
  // The sway roll — likelier at higher standing, fixed per target+node (no save-scum).
  const roll = streamFor(run.seed, Labels.bribe(run.mapNodeId, enemy.id));
  if (!roll.chance(bribeChance(tier))) {
    check.commit(); // the gamble: a resisted roll still spends the Influence
    return { applied: false, status: "resisted", cost, detail: `${enemy.name} spurns the offer — ${cost} Influence spent for nothing.` };
  }
  check.commit();
  const outcome = recruitClassify(enemy);
  const detail = outcome.permanent
    ? `${enemy.name} is swayed — joins permanently after the battle.`
    : `${enemy.name} turns coat for the rest of the battle.`;
  return { applied: true, status: "swayed", cost, outcome, detail };
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
  /**
   * **Universal fallback efficiency (R4, the ratified ruling) — TUNABLE.** A Medic-less party can
   * triage via {@link "./jobs-data/support".UNIVERSAL_OVERWORLD_SKILLS}: one rest-chunk funded by
   * Rest Points at this multiple of a normal rest's `rpPerChunk`. `2` = **half efficiency** (half
   * the chunks per RP) — the named behavior change, a dial beside D9's `rpPerChunk` (raise it to
   * make the Medic-less heal dearer, lower it toward parity). Only the fallback reads it; the full
   * Medic Triage is fatigue-fuelled and unchanged.
   */
  fallbackRpMultiplier: 2,
} as const;

/**
 * The universal Triage-fallback **RP price** at the run's current node (R4, the ratified ruling):
 * `fallbackRpMultiplier ×` the difficulty's `rpPerChunk` — funds **one rest-chunk** at half a
 * normal rest's efficiency. The provider body the fallback skill's `overworldCost.rp` calls;
 * a hoisted function so jobs-data can reference it in a lazy cost provider with no init cycle.
 */
export function triageFallbackRp(run: RunState): number {
  return TRIAGE.fallbackRpMultiplier * getDifficulty(run.difficultyId).rpPerChunk;
}

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
  /** Fatigue spent on the healer (the declared cost — no surcharge exists, D73). */
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
  const wounded = mostWoundedFielded(run);
  if (!wounded) return { applied: false, reason: "No wounded fighter to triage." };

  const check = checkOverworldCost(run, "triage", overworldCostOf(MEDIC_TRIAGE), "Triage", healer);
  if (!check.ok) return { applied: false, reason: check.reason };

  const healed = applyTriageEffect(healer, wounded, TRIAGE.base);
  check.commit();
  return {
    applied: true,
    healed,
    targetId: wounded.id,
    fatigueSpent: check.prices.fatigue,
    detail: `Triaged ${wounded.name}: +${healed} HP (${healer.name} worn out).`,
  };
}

/** The most-wounded fielded ally (lowest HP fraction), or undefined if none is hurt — Triage's target. */
export function mostWoundedFielded(run: RunState): Unit | undefined {
  return fieldedUnits(run.party)
    .filter((u) => u.hp < u.maxHp)
    .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
}

/**
 * **Full-strength Triage heal** (the Medic path) — the post-gate mutation shared by
 * {@link triage} and the `triage` overworld-effect handler (R4/A). Heal `wounded` for `base` +
 * the healer's Triage passive scaled on the wound's depth (read from the job def, since camp
 * units aren't stamped): more missing HP → more healing. Returns the HP restored. Pure of the
 * cost gate (the demanding fatigue price rides {@link checkOverworldCost}).
 */
export function applyTriageEffect(healer: Unit, wounded: Unit, base: number): number {
  const triageVal = getJob(primaryJobOf(healer))?.passives?.[PASSIVE.triage] ?? 0;
  const amount = base + Math.floor(triageVal * (wounded.maxHp - wounded.hp));
  return healUnit(wounded, amount);
}

/**
 * **Universal Triage fallback heal** (R4, the ratified ruling) — the post-gate mutation the
 * `triage` handler runs for the `fallback` skill in
 * {@link "./jobs-data/support".UNIVERSAL_OVERWORLD_SKILLS}. Heal `wounded` **one rest-chunk**
 * (D9 {@link "./upkeep".chunkHp}), funded by Rest Points at **half a normal rest's efficiency** —
 * the skill's `overworldCost.rp` provider charges 2× `rpPerChunk`, so a Medic-less party heals
 * **half the chunks per RP** (the named, tunable behavior change). This only heals the chunk; the
 * RP price rides {@link checkOverworldCost}. Returns the HP restored.
 */
export function applyTriageFallbackEffect(wounded: Unit): number {
  return healUnit(wounded, chunkHp(wounded));
}

// --- The standalone-verb cost registry is RETIRED (D61/#112; R4/A increment 9) ------
//
// `VERB_COSTS` and its module-load validation walk are gone: every economy verb's cost has
// dissolved onto a SkillDef's `overworldCost` — the Merchant/Banker/Noble verbs onto their
// `JobDef.skills`, `buy` + `triage` onto the universal overworld home / the Medic (validated by
// the single load-time walk in `jobs.ts`), and `bribeEnemy` onto the gate's `influence` knob with
// a per-target price. "Free and unlimited" is unrepresentable wherever a verb lives, now over the
// **one** home. The D88 guard test (`overworld-actions.test.ts`) inverts accordingly: it proves the
// ABSENCE of any standalone gated verb — every exported verb resolver is a JobDef-skill wrapper, a
// universal-skill wrapper, or gated elsewhere (bribe's influence knob), and a new unclassified
// export still fails BY NAME.
