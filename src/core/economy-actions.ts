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
 * - **Noble — INFLUENCE** ({@link accrueNobleInfluence}/{@link patronize}/{@link
 *   bribeEnemy}): **Influence** — a separate, **per-expedition** currency that can never
 *   pay Upkeep — accrues passively from a Noble's presence and from the **Patronize**
 *   verb (gold → standing), and is spent on a **bribe** that sways an enemy (reading the
 *   D24 preview) into a temporary turncoat (generic) or a permanent recruit (authored, D33).
 *
 * **Determinism (D22):** income/bribe rolls derive from the guild seed; theft from
 * node/run seeds — no live RNG, no `Math.random`. Pure logic: no Phaser, no DOM.
 */

import type { RunState } from "./run";
import type { Unit } from "./units";
import { getNode, effectiveMarketTier, type MarketTier } from "./overworld";
import { checkOverworldCost, commitOverworldCost, type OverworldCost } from "./overworld-actions";
import type { NodePreview } from "./intel";
import { nonNegInt } from "./num";
import { addItem, canAdd, countOf, removeItem, getMaterial, saleValueOf, type MaterialDef } from "./inventory";
import { addInfluence, spendInfluence, gainRunGold } from "./economy";
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
    /**
     * Intelligence that marks a party member a **Noble** for presence accrual + Patronize
     * (D62). Intelligence is the Noble's stat (it drives the intel floor); this is an
     * interim proxy for "a Noble is present" until a dedicated Noble job lands.
     */
    presenceIntelligence: 3,
    /** Patronize (D62): purse gold spent to court patrons... */
    patronizeCost: 12,
    /** ...for this much Influence in return (gold → standing, once per node). */
    patronizeYield: 3,
    /** Base Influence cost to bribe an enemy (discounted by what intel reveals). */
    bribeBase: 4,
  },
} as const;

/** A generic verb result the render reads (applied, or why refused). */
export interface VerbResult {
  applied: boolean;
  reason?: string;
  detail?: string;
}

// --- Merchant — ACCESS (purse-funded, market-tier-gated) --------------------

/** The Merchant's price to buy one supply at a market of the given tier (D61). */
export function merchantPrice(tier: MarketTier): number {
  // A better market is cheaper access; `none` returns 0 (buy is refused upstream).
  return ECONOMY.merchant.buyPrice[tier];
}

/** What a Merchant buy produced. */
export interface MerchantBuyResult extends VerbResult {
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
  const price = merchantPrice(tier);
  if (run.camp.gold < price) {
    return { applied: false, reason: `Not enough purse gold (${price}g) to buy ${materialId}.`, price };
  }
  if (!canAdd(run.inventory, materialId)) {
    return { applied: false, reason: `No storage room for ${materialId}.`, price };
  }
  run.camp.gold -= price;
  addItem(run.inventory, materialId);
  return { applied: true, detail: `Bought ${materialId} for ${price}g (${tier} market).`, spent: price, price };
}

// --- Merchant — SELL (goods -> gold, gated by market access, D61) ------------

/** Gold one unit of `material` fetches at a `tier` market (0 = can't sell here). */
export function sellPrice(material: MaterialDef, tier: MarketTier): number {
  return Math.floor(saleValueOf(material) * ECONOMY.merchant.sellRate[tier]);
}

/** What a Merchant sell produced. */
export interface MerchantSellResult extends VerbResult {
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
  const material = getMaterial(materialId);
  if (!material) return { applied: false, reason: `Unknown material "${materialId}".` };
  if (countOf(run.inventory, materialId) <= 0) {
    return { applied: false, reason: `No ${material.name} to sell.` };
  }
  const tier = effectiveMarketTier(getNode(run.map, run.mapNodeId), run.party);
  const price = sellPrice(material, tier);
  if (price <= 0) {
    const why = saleValueOf(material) <= 0 ? `${material.name} can't be sold.` : `No market here to sell ${material.name}.`;
    return { applied: false, reason: why, price };
  }
  removeItem(run.inventory, materialId, 1);
  const { credited } = gainRunGold(run, price);
  // The Merchant grows from its signature work (D32/D53) — replacing the use-XP the
  // retired Trade camp skill used to grant. Only a live Merchant brokers (and levels).
  const broker = run.party.find((u) => u.alive && !u.captured && u.jobId === "merchant");
  const levels = broker ? grantAbilityUseXp(broker) : 0;
  return { applied: true, earned: credited, price, levels, detail: `Sold ${material.name} for ${price}g (${tier} market).` };
}

// --- Banker — TIME-SHIFT + SECURE (purse only, never the treasury) ----------

/**
 * **Banker TIME-SHIFT** (D30): engage flat purse **interest**. Sets a per-node-step
 * credit of `ceil(purse × rate)` (at least 1 when the purse is non-empty), accrued
 * by {@link "./overworld-actions".accruePurseInterest} as the caravan advances.
 * Purse-only — it never touches the treasury (D34). Returns the per-step amount.
 */
export function bankerEngageInterest(run: RunState): number {
  const perStep = run.camp.gold > 0 ? Math.max(1, Math.ceil(run.camp.gold * ECONOMY.banker.interestRate)) : 0;
  run.overworld.interestPerStep = perStep;
  return perStep;
}

/** What a buy-on-debt drew. */
export interface BankerBorrowResult extends VerbResult {
  /** Gold advanced to the purse. */
  borrowed?: number;
  /** The new outstanding debt balance. */
  debt?: number;
}

/**
 * **Banker BUY-ON-DEBT** (D30): advance gold to the purse **now**, recorded as debt
 * that **auto-repays from incoming run gold** ({@link "./economy".gainRunGold}).
 * Lets a caravan overspend on a key buy/bribe and settle it from later loot. Purse
 * + debt only — the treasury is never involved (D34).
 */
export function bankerBorrow(run: RunState, amount: number): BankerBorrowResult {
  const borrowed = nonNegInt(amount);
  if (borrowed <= 0) return { applied: false, reason: "Nothing to borrow." };
  run.camp.gold += borrowed;
  run.overworld.debt += borrowed;
  return { applied: true, borrowed, debt: run.overworld.debt, detail: `Borrowed ${borrowed}g against future loot.` };
}

/** What buying theft protection produced. */
export interface BankerProtectResult extends VerbResult {
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
export function bankerProtect(run: RunState): BankerProtectResult {
  const cost = ECONOMY.banker.protectionCost;
  if (run.camp.gold < cost) return { applied: false, reason: `Not enough purse gold (${cost}g) for protection.` };
  run.camp.gold -= cost;
  run.overworld.protection = Math.max(run.overworld.protection, ECONOMY.banker.protectionLevel);
  return { applied: true, spent: cost, protection: run.overworld.protection, detail: `Theft protection engaged.` };
}

// --- Noble — INFLUENCE (a walled-off, per-expedition currency, D62) ----------

/**
 * True if the party fields a **Noble** — a member whose Intelligence (the Noble's
 * stat, D62) marks them a standing-bearer. The presence that accrues Influence and
 * works the Patronize verb, mirroring {@link "./overworld".merchantFloor}. (Interim
 * proxy for a Noble until a dedicated Noble job lands.)
 */
export function hasNoble(party: readonly Unit[]): boolean {
  return party.some((u) => u.alive && !u.captured && (u.intelligence ?? 0) >= ECONOMY.noble.presenceIntelligence);
}

/** Influence the party's Noble accrues per node-step (0 with no Noble present, D62). */
export function nobleInfluencePerStep(party: readonly Unit[]): number {
  return hasNoble(party) ? ECONOMY.noble.incomePerStep : 0;
}

/**
 * Accrue the **Noble's passive Influence** one node-step (D62): a Noble builds rapport
 * just by travelling — people seek them for patronage and work. The Noble's twin of the
 * Banker's {@link "./overworld-actions".accruePurseInterest}; credited to the run's
 * **per-expedition** standing (never the guild). Called from {@link "./run".breakCamp}.
 * Returns the Influence gained (0 with no Noble present — no free faucet).
 */
export function accrueNobleInfluence(run: RunState): number {
  const gain = nobleInfluencePerStep(run.party);
  if (gain > 0) addInfluence(run.overworld, gain);
  return gain;
}

/** What a Patronize produced. */
export interface PatronizeResult extends VerbResult {
  /** Purse gold spent. */
  spent?: number;
  /** Influence gained. */
  gained?: number;
}

/** Patronize's two-axis cost (D61/D62): once per node (pacing) × purse gold (price). */
const PATRONIZE_COST: OverworldCost = { usesPerNode: 1, gold: ECONOMY.noble.patronizeCost };

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
  const check = checkOverworldCost(run, "patronize", PATRONIZE_COST, "Patronize");
  if (!check.ok) return { applied: false, reason: check.reason };
  const yield_ = ECONOMY.noble.patronizeYield;
  addInfluence(run.overworld, yield_);
  commitOverworldCost(run, "patronize", PATRONIZE_COST, check.fatigueSpend);
  return {
    applied: true,
    spent: ECONOMY.noble.patronizeCost,
    gained: yield_,
    detail: `Patronized for ${yield_} Influence (${ECONOMY.noble.patronizeCost}g).`,
  };
}

/** What a bribe attempt produced. */
export interface BribeResult extends VerbResult {
  /** Influence spent. */
  cost?: number;
  /** How the swayed unit resolves after the battle (temp generic / perm authored). */
  outcome?: RecruitOutcome;
}

/**
 * The Influence cost to bribe an enemy, **reading the D24 preview** (D30): the more
 * the party already knows about the encounter (a higher intel tier in the preview),
 * the cheaper the sway — knowing the field is leverage. Never below 1.
 */
export function bribeCost(preview?: NodePreview): number {
  const tier = preview?.intel?.tier ?? 0;
  return Math.max(1, ECONOMY.noble.bribeBase - tier);
}

/**
 * **Noble BRIBE** (D30/D33): sway an enemy by spending **Influence**, leaning on the
 * D24 `preview` for the price. On success the caller flips the unit to the player's
 * side for the fight; how it resolves *after* is the temp↔permanent vector (D33):
 * a **generic** enemy is temporary (fights this battle only), an **authored** one
 * is a permanent recruit ({@link "./recruitment".recruitToRoster}). Refuses
 * (spending nothing) if the run can't afford the Influence. Spends the run's
 * **per-expedition** standing (D62), not the guild.
 */
export function bribeEnemy(run: RunState, enemy: Pick<Unit, "authored" | "name">, preview?: NodePreview): BribeResult {
  const cost = bribeCost(preview);
  if (!spendInfluence(run.overworld, cost)) {
    return { applied: false, reason: `Not enough Influence to bribe ${enemy.name} (${cost}).`, cost };
  }
  const outcome = recruitClassify(enemy);
  const detail = outcome.permanent
    ? `${enemy.name} is swayed — joins permanently after the battle.`
    : `${enemy.name} turns coat for the rest of the battle.`;
  return { applied: true, cost, outcome, detail };
}
