/**
 * The two-pool economy (M10, D28/D34) — faucet/sink routing for the guild
 * treasury and the run purse.
 *
 * M9 left the two pools as plumbing: `guild.treasury` (the pure vault) and
 * `run.camp.gold` (the carried purse). M10 fills that plumbing with **directional
 * routing** so each pool has exactly one kind of inflow:
 *
 * - **Loot → the PURSE** (D34): field winnings land in the carried purse — the
 *   tight, local routing currency. {@link gainRunGold} is the credit path (it also
 *   auto-repays any Banker debt first — D30).
 * - **Quest payouts → the TREASURY** (D34): a *completed* quest banks its payout to
 *   the vault. This (with a returning purse) is the treasury's **only** faucet —
 *   *the field is the faucet, the guild is the buffer*. The routing itself lives at
 *   the guild tier ({@link "./guild".resolveReturn}); {@link routePayoutToTreasury}
 *   is the named seam.
 * - **Upkeep ← the TREASURY** (D15/D34): maintenance is the treasury-side sink
 *   ({@link payTreasuryUpkeep}, reusing {@link "./upkeep".computeUpkeep}).
 *
 * And one new purpose-bound currency:
 *
 * - **Influence** (D34) — the Noble's whole economy, walled off from gold. It is
 *   earned as political income and spent **only** on the Noble's verbs; it can
 *   **never** pay Upkeep or buy gear (it isn't gold, so no gold sink ever reads
 *   it). {@link addInfluence}/{@link spendInfluence} are the only mutators.
 *
 * **Determinism (D22):** routing is plain arithmetic — no live RNG, no
 * `Math.random`. Pure logic: no Phaser, no DOM.
 */

import type { Guild } from "./guild";
import type { RunState } from "./run";
import type { OverworldState } from "./overworld-state";
import type { Unit } from "./units";
import { nonNegInt, bandFor } from "./num";
import { earn, type PurseSource } from "./purse-journal";
import { computeUpkeep, foodFirst, type UpkeepBill, type UpkeepLine } from "./upkeep";

// --- The run purse: loot in, debt auto-repaid (D34/D30) ---------------------

/** What crediting run gold produced (the purse-side faucet bookkeeping). */
export interface RunGoldResult {
  /** Gold that actually landed in the purse (after any debt was repaid). */
  credited: number;
  /** Buy-on-debt principal auto-repaid from the incoming gold (D30 Banker). */
  debtRepaid: number;
}

/**
 * Credit gold to the **run purse** (`camp.gold`) — the field faucet (D34). Loot
 * routes here, never to the treasury. If the Banker's **buy-on-debt** ledger
 * carries a balance ({@link "./overworld-actions".OverworldState.debt}), the
 * incoming gold **auto-repays it first** (D30), and only the remainder lands in the
 * purse. Returns the split.
 */
export function gainRunGold(run: RunState, amount: number, source: PurseSource = "loot", label = "Loot"): RunGoldResult {
  const gold = nonNegInt(amount);
  const debt = run.overworld.debt;
  const debtRepaid = Math.min(debt, gold);
  run.overworld.debt = debt - debtRepaid;
  const credited = gold - debtRepaid;
  // The debt-repaid portion never reaches the purse, so only `credited` is journaled.
  earn(run.camp, credited, source, label, { nodeId: run.mapNodeId, night: run.night });
  return { credited, debtRepaid };
}

// --- The treasury: payouts only (D34) ---------------------------------------

/**
 * Route a completed quest's **payout** into the **treasury** (D34) — the vault's
 * only earned faucet (with a returning purse). No passive growth ever feeds it.
 * Returns the gold banked. (The guild tier calls this on a completed return; see
 * {@link "./guild".resolveReturn}.)
 */
export function routePayoutToTreasury(guild: Guild, payout: number): number {
  const gold = nonNegInt(payout);
  guild.treasury += gold;
  return gold;
}

// --- Upkeep: the treasury-side sink (D15/D34) -------------------------------

/** The result of paying Upkeep from the treasury (M10, D34). */
export interface TreasuryUpkeepResult {
  bill: UpkeepBill;
  /** Gold actually drawn from the treasury. */
  paid: number;
  /** Lines left unfunded when the treasury couldn't cover them. */
  underfunded: UpkeepLine["id"][];
  /** Gold shortfall (the unfunded total). */
  shortfall: number;
}

/**
 * Pay Upkeep from the **treasury** (D15/D34) — maintenance is a treasury-side
 * sink, the buffer's drain between runs. Funds Food first (the harsher breach),
 * then Repairs, drawing from the vault; any line the treasury can't cover is left
 * underfunded. Reuses {@link computeUpkeep} so adding a maintenance job is adding a
 * line, not a meter. (Morale is a per-run camp concern — not modelled at the
 * guild tier; this is purely the gold sink.)
 */
export function payTreasuryUpkeep(guild: Guild, party: readonly Unit[] = guild.roster): TreasuryUpkeepResult {
  const bill = computeUpkeep(party);
  const ordered = foodFirst(bill.lines);
  let paid = 0;
  let shortfall = 0;
  const underfunded: UpkeepLine["id"][] = [];
  for (const line of ordered) {
    if (guild.treasury >= line.cost) {
      guild.treasury -= line.cost;
      paid += line.cost;
    } else {
      underfunded.push(line.id);
      shortfall += line.cost;
    }
  }
  return { bill, paid, underfunded, shortfall };
}

// --- Influence: a purpose-bound, per-expedition currency (D34/D62) -----------

/**
 * **Influence** standing bands (D62) — an ordered band over the raw value, the
 * Noble's twin of the market/intel tiers. The *current* band gates the Noble's
 * sinks (cheaper, likelier bribes; better map events), so spending standing on a
 * bribe can knock you down a band — the deliberate hoard-vs-spend tension.
 */
export type InfluenceTier = "unknown" | "known" | "respected" | "favored" | "renowned";

/** Influence band floors — the value each standing band starts at (D62). Data, a numbers pass later. */
export const INFLUENCE_BANDS: readonly { min: number; tier: InfluenceTier }[] = [
  { min: 25, tier: "renowned" },
  { min: 15, tier: "favored" },
  { min: 8, tier: "respected" },
  { min: 3, tier: "known" },
  { min: 0, tier: "unknown" },
];

/** Band a raw Influence value into its standing tier (D62). */
export function influenceTier(value: number): InfluenceTier {
  return bandFor(value, INFLUENCE_BANDS, INFLUENCE_BANDS[INFLUENCE_BANDS.length - 1]).tier;
}

/**
 * Add **Influence** to the run's **per-expedition** standing (D62) — the Noble's
 * faucet (passive presence accrual + Patronize). Influence is walled off from gold
 * (it can never pay Upkeep or buy gear) and is rebuilt each run like the purse — it
 * does **not** bank to the guild.
 */
export function addInfluence(eco: OverworldState, amount: number): number {
  const n = nonNegInt(amount);
  eco.influence += n;
  return eco.influence;
}

/** True if the run holds enough Influence to afford `cost`. */
export function canAffordInfluence(eco: OverworldState, cost: number): boolean {
  return eco.influence >= cost;
}

/**
 * Spend **Influence** on a Noble verb (D62). Returns true if it was affordable and
 * deducted, false otherwise (the caller leaves the action un-applied). Influence
 * **only** flows out through the Noble's verbs — never as Upkeep or gear.
 */
export function spendInfluence(eco: OverworldState, cost: number): boolean {
  const n = nonNegInt(cost);
  if (eco.influence < n) return false;
  eco.influence -= n;
  return true;
}
