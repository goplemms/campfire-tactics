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
import type { Unit } from "./units";
import { nonNegInt } from "./num";
import { computeUpkeep, type UpkeepBill, type UpkeepLine } from "./upkeep";

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
 * carries a balance ({@link "./overworld-actions".OverworldEconomy.debt}), the
 * incoming gold **auto-repays it first** (D30), and only the remainder lands in the
 * purse. Returns the split.
 */
export function gainRunGold(run: RunState, amount: number): RunGoldResult {
  const gold = nonNegInt(amount);
  const debt = run.overworld.debt;
  const debtRepaid = Math.min(debt, gold);
  run.overworld.debt = debt - debtRepaid;
  const credited = gold - debtRepaid;
  run.camp.gold += credited;
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
  const ordered = [...bill.lines].sort((a, b) =>
    a.id === "food" ? -1 : b.id === "food" ? 1 : 0,
  );
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

// --- Influence: a purpose-bound currency (D34) ------------------------------

/**
 * Add **Influence** to the guild (M10, D34) — the Noble's political-income faucet.
 * Influence is walled off from gold: it can never pay Upkeep or buy gear.
 */
export function addInfluence(guild: Guild, amount: number): number {
  const n = nonNegInt(amount);
  guild.influence += n;
  return guild.influence;
}

/** True if the guild can afford an Influence cost. */
export function canAffordInfluence(guild: Guild, cost: number): boolean {
  return guild.influence >= cost;
}

/**
 * Spend **Influence** on a Noble verb (D34). Returns true if it was affordable and
 * deducted, false otherwise (the caller leaves the action un-applied). Influence
 * **only** flows out through the Noble's verbs — never as Upkeep or gear.
 */
export function spendInfluence(guild: Guild, cost: number): boolean {
  const n = nonNegInt(cost);
  if (guild.influence < n) return false;
  guild.influence -= n;
  return true;
}
