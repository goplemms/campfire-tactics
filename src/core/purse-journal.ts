/**
 * The run **purse journal** (`camp.purseLog`) — an append-only record of every gold
 * movement in or out of the run purse, each tagged with a typed {@link PurseSource}
 * so flows can be grouped and traced. Distinct from the Captain's Journal
 * ({@link "./journal"}, the party's concerns) and the {@link "./ledger"} (the derived
 * readout) — this is the **transaction substrate** the latter will eventually fold.
 *
 * The purse (`camp.gold`) is the run's single bottom line, but it used to be mutated
 * inline in a dozen places while {@link "./ledger".buildLedger} re-derived its flow
 * after the fact. This is the authoritative record instead: every credit/debit goes
 * through the one {@link earn}/{@link spend} chokepoint, which mutates the purse **and**
 * records why — so the realized economy is self-reporting and the invariant
 * `sum(deltas) === camp.gold` holds by construction (see {@link purseFromLog}).
 *
 * **Purse-scoped only (D34):** the guild **treasury** and **Influence** are separate
 * currencies and are *not* journaled here. Presentation (a ledger fold, a sim report)
 * reads the log later — this module owns only the record + the two verbs.
 *
 * Pure logic: no Phaser, no DOM.
 */

import type { Camp } from "./camp";

/**
 * Where a purse movement came from / went — the typed flow tag that powers grouped
 * reports and the eventual ledger fold. Add a member when a new source/sink appears.
 */
export type PurseSource =
  | "opening" // the purse carried into the field (the seed entry)
  | "loot" // combat / node reward credited to the purse
  | "sale" // the Merchant selling valuables for gold
  | "toll" // a tollgate fee
  | "upkeep" // the nightly Food/Repairs bill
  | "cleric" // an emergency cleric revive (D9)
  | "theft" // a thief skimming the purse (out)…
  | "recovery" // …or its kill-to-recover (in)
  | "banker" // a Banker buy-on-debt advance
  | "interest" // the Banker's per-step interest faucet
  | "deft-hands" // the Thief's Deft Hands node skim (in) (D68)
  | "recruit" // a mid-run recruiter fee
  | "event" // a story-node payout or cost
  | "action"; // an overworld ability's gold cost

/** Optional run context stamped on an entry (where/when), when the caller has it. */
export interface PurseContext {
  /** The node the movement happened at. */
  nodeId?: string;
  /** The run night it occurred on. */
  night?: number;
}

/** One purse movement: a signed gold delta with its source and a human-readable line. */
export interface PurseEntry extends PurseContext {
  /** Signed gold: **+** into the purse, **−** out of it. */
  delta: number;
  /** The typed flow this belongs to. */
  source: PurseSource;
  /** A short human-readable description (e.g. `"Buy Trap Kit"`, `"Toll @ gate-2"`). */
  label: string;
}

/**
 * Credit the purse `amount` gold from `source` and log it — the single inflow
 * chokepoint. Call this instead of mutating `camp.gold` directly. A non-positive
 * `amount` is a no-op (no entry). Returns the amount credited.
 */
export function earn(camp: Camp, amount: number, source: PurseSource, label: string, ctx: PurseContext = {}): number {
  if (amount <= 0) return 0;
  camp.gold += amount;
  camp.purseLog.push({ delta: amount, source, label, ...ctx });
  return amount;
}

/**
 * Debit the purse `amount` gold to `source` and log it — the single outflow
 * chokepoint. It does **not** itself gate affordability (callers check before
 * spending, as today); a non-positive `amount` is a no-op. Returns the amount spent.
 */
export function spend(camp: Camp, amount: number, source: PurseSource, label: string, ctx: PurseContext = {}): number {
  if (amount <= 0) return 0;
  camp.gold -= amount;
  camp.purseLog.push({ delta: -amount, source, label, ...ctx });
  return amount;
}

/** The opening-purse log for a camp carrying `gold` into the field (empty if 0). */
export function openingPurseLog(gold: number): PurseEntry[] {
  return gold > 0 ? [{ delta: gold, source: "opening", label: "Carried into the field" }] : [];
}

/** The purse balance implied by the log — equals `camp.gold` by construction. */
export function purseFromLog(camp: Camp): number {
  return camp.purseLog.reduce((sum, e) => sum + e.delta, 0);
}

/** Sum the log's deltas for one {@link PurseSource} — the grouped-report primitive. */
export function purseTotalBySource(camp: Camp, source: PurseSource): number {
  return camp.purseLog.reduce((sum, e) => (e.source === source ? sum + e.delta : sum), 0);
}
