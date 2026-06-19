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
 * - **Noble — INFLUENCE** ({@link collectPoliticalIncome}/{@link bribeEnemy}):
 *   political income lands as **Influence** (a separate currency that can never pay
 *   Upkeep), and a **bribe** sways an enemy — reading the D24 preview — into either
 *   a temporary turncoat (generic) or a permanent recruit (authored, D33).
 *
 * **Determinism (D22):** income/bribe rolls derive from the guild seed; theft from
 * node/run seeds — no live RNG, no `Math.random`. Pure logic: no Phaser, no DOM.
 */

import type { RunState } from "./run";
import type { Guild } from "./guild";
import type { Unit } from "./units";
import { getNode, effectiveMarketTier, type NodeKind, type MarketTier } from "./overworld";
import type { NodePreview } from "./intel";
import { nonNegInt } from "./num";
import { addItem, canAdd, countOf, removeItem, getMaterial, saleValueOf, type MaterialDef } from "./inventory";
import { streamFor } from "./rng";
import { addInfluence, spendInfluence, gainRunGold } from "./economy";
import { recruitClassify, type RecruitOutcome } from "./recruitment";

/** Economy-verb tuning — data, a numbers pass later (D30). */
export const ECONOMY = {
  merchant: {
    /** Purse price to buy one supply at a `rest`/town node (better access). */
    townPrice: 8,
    /** Purse price out in the wild (a `combat`/`event` node). */
    wildPrice: 16,
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
    /** Political-income band → Influence (D34). */
    incomeMin: 2,
    incomeMax: 5,
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

// --- Merchant — ACCESS (purse-funded, node-tier-gated) ----------------------

/** The Merchant's price to buy one supply at a node of the given kind (D30). */
export function merchantPrice(nodeKind: NodeKind): number {
  // A safe `rest` camp doubles as the "town" — better access than the wild.
  return nodeKind === "rest" ? ECONOMY.merchant.townPrice : ECONOMY.merchant.wildPrice;
}

/** What a Merchant buy produced. */
export interface MerchantBuyResult extends VerbResult {
  /** Purse gold spent. */
  spent?: number;
  /** The node-tier price paid. */
  price?: number;
}

/**
 * **Merchant ACCESS** (D30): spend **run-gold** (the purse, `camp.gold`) to buy one
 * of a supply into caravan **storage**, at a **node-tier price** (cheaper at a
 * `rest`/town node than in the wild). Refuses (without spending) if the purse can't
 * cover it or storage is full (the provisioning cap, D6). Never touches the
 * treasury (D34).
 */
export function merchantBuy(run: RunState, materialId: string, nodeKind: NodeKind): MerchantBuyResult {
  const price = merchantPrice(nodeKind);
  if (run.camp.gold < price) {
    return { applied: false, reason: `Not enough purse gold (${price}g) to buy ${materialId}.`, price };
  }
  if (!canAdd(run.inventory, materialId)) {
    return { applied: false, reason: `No storage room for ${materialId}.`, price };
  }
  run.camp.gold -= price;
  addItem(run.inventory, materialId);
  return { applied: true, detail: `Bought ${materialId} for ${price}g (purse).`, spent: price, price };
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
  return { applied: true, earned: credited, price, detail: `Sold ${material.name} for ${price}g (${tier} market).` };
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

// --- Noble — INFLUENCE (a walled-off currency) ------------------------------

/**
 * **Noble INFLUENCE faucet** (D30/D34): collect **political income** as Influence —
 * a separate currency that can **never** pay Upkeep or buy gear ({@link
 * "./economy".addInfluence}). Deterministic from the guild seed + a monotonic
 * counter. Returns the Influence gained.
 */
export function collectPoliticalIncome(guild: Guild): number {
  const n = guild.politicsCounter++;
  const rng = streamFor(guild.seed, `politics:${n}`);
  const income = rng.range(ECONOMY.noble.incomeMin, ECONOMY.noble.incomeMax);
  addInfluence(guild, income);
  return income;
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
 * (spending nothing) if the guild can't afford the Influence.
 */
export function bribeEnemy(guild: Guild, enemy: Pick<Unit, "authored" | "name">, preview?: NodePreview): BribeResult {
  const cost = bribeCost(preview);
  if (!spendInfluence(guild, cost)) {
    return { applied: false, reason: `Not enough Influence to bribe ${enemy.name} (${cost}).`, cost };
  }
  const outcome = recruitClassify(enemy);
  const detail = outcome.permanent
    ? `${enemy.name} is swayed — joins permanently after the battle.`
    : `${enemy.name} turns coat for the rest of the battle.`;
  return { applied: true, cost, outcome, detail };
}
