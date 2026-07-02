/**
 * The economic ledger (D45) — the routing readout the overworld pillar implied.
 *
 * The overworld is an **economic routing problem** (D28), but the budget that *is*
 * the decision was invisible. The ledger is that readout: a **pure projection** of
 * run state (the `previewNode`/forecast pattern), **purse-scoped** — it reports the
 * **run purse** flow only. The guild **treasury** is the hall's concern, and
 * **Influence** is *shown but never summed into gold* (it can't pay Upkeep, D34).
 *
 * - **Broad totals → expand for crunch (D45).** A handful of category totals
 *   (Upkeep / Loot / Field spend / Banker) with **line items** to expand into; the
 *   bottom-line **balance** is the current purse.
 * - **Receipt *and* forecast.** The realized flows reconcile to the balance (the
 *   receipt); the embedded {@link "./forecast".projectForecast} is the load-bearing
 *   forward projection (D48) — *"this route + a rest → purse at the bottom."*
 * - **A soft, intent-aware gate** ({@link nightEndGate}) on Break Camp: it
 *   hard-stops only when warranted — a projected shortfall, can't-afford-the-rest,
 *   outstanding debt, or a **non-voluntary** underfunded line — and stays quiet on a
 *   **deliberate** skip (it keys off *intent*, not the funded bit).
 *
 * Pure logic: no Phaser, no DOM.
 */

import type { RunState } from "./run";
import { computeUpkeep, foodFirst } from "./upkeep";
import { projectForecast, type RouteForecast } from "./forecast";

/** One expandable line item within a ledger category (signed gold). */
export interface LedgerLine {
  id: string;
  label: string;
  /** Signed gold: **+** an inflow to the purse, **−** an outflow. */
  amount: number;
  /** Voluntary-skip / projected marker for the render (Upkeep lines, D45). */
  note?: string;
  /**
   * For a voluntarily-skipped line: the signed amount it *would* carry if restored (its
   * cost), while {@link amount} is 0 so it stays out of the total. The render shows this —
   * struck through — so the player sees what un-skipping the line would cost (D45).
   */
  restoreAmount?: number;
}

/** A ledger category — a broad total over its expandable {@link LedgerLine}s (D45). */
export interface LedgerCategory {
  id: "opening" | "loot" | "field" | "upkeep" | "banker";
  label: string;
  /** The category total — the sum of its line amounts for itemized flows (loot/field/upkeep/
   *  banker). The `opening` lump-sum is the exception: it carries its figure on the header
   *  with no sub-lines. */
  total: number;
  lines: LedgerLine[];
  /**
   * **Projected** categories (the night's Upkeep, the Banker's standing position)
   * are *forward-looking* — shown, but **not** part of the realized reconciliation
   * to the balance. Realized flow categories (opening/loot/field) sum to balance.
   */
  projected?: boolean;
}

/** The full ledger projection (D45) — totals, lines, the forecast, and Influence. */
export interface Ledger {
  /** The bottom line: the current **run purse** (D34). */
  balance: number;
  /**
   * The estimated purse carried **into the next day** (D45/D48): the current {@link balance}
   * plus every `projected` category total (tonight's Upkeep, the Banker position). The
   * realized categories already reconcile into `balance`, so only the projected ones move it.
   */
  forecastBalance: number;
  /** The categories (broad totals + expandable lines). */
  categories: LedgerCategory[];
  /**
   * **Influence** (D34) — the Noble's separate currency, **shown but never summed
   * into gold** (it can't pay Upkeep). Sourced from the guild tier (the run itself
   * holds no Influence); defaults to 0.
   */
  influence: number;
  /** The embedded route forecast (D48) — the forward half of the ledger. */
  forecast: RouteForecast;
  /** Jump-to-market hint: true when a Merchant buy is usable here (D45). */
  marketReady: boolean;
}

/** Options for {@link buildLedger}. */
export interface BuildLedgerOptions {
  /** The guild's Influence to display (never summed into gold, D34). */
  influence?: number;
  /** Whether a market verb is usable here (town/rest node · Merchant · off cooldown). */
  marketReady?: boolean;
}

/**
 * Build the purse-scoped economic ledger (D45) — a pure projection over `run`
 * state. The realized **opening / loot / field-spend** categories reconcile to the
 * current **balance**; **Upkeep** (the night's projected cost) and **Banker** (the
 * standing interest/debt/protection position) are shown but flagged `projected`.
 * Embeds the {@link projectForecast} forecast (D48). Influence rides along, never
 * summed into gold (D34).
 */
export function buildLedger(run: RunState, opts: BuildLedgerOptions = {}): Ledger {
  const balance = run.camp.gold;

  // Realized flows from the run history (purse-scoped): a positive node gold is
  // loot in; a negative one is a field spend (tolls, thief skims, shop/recruiter).
  const lootLines: LedgerLine[] = [];
  const fieldLines: LedgerLine[] = [];
  for (const rec of run.history) {
    if (rec.goldEarned > 0) {
      lootLines.push({ id: `loot:${rec.nodeId}`, label: `${rec.kind} @ ${rec.nodeId}`, amount: rec.goldEarned });
    } else if (rec.goldEarned < 0) {
      fieldLines.push({ id: `spend:${rec.nodeId}`, label: `${rec.kind} @ ${rec.nodeId}`, amount: rec.goldEarned });
    }
  }
  const lootTotal = lootLines.reduce((s, l) => s + l.amount, 0);
  const fieldTotal = fieldLines.reduce((s, l) => s + l.amount, 0);

  // Opening: the purse carried into the field (plus any untracked adjustment),
  // derived so the realized categories reconcile exactly to the balance.
  const openingTotal = balance - lootTotal - fieldTotal;

  // Upkeep: the night's projected cost (the reconcile role) — Food/Repairs lines,
  // each an outflow, with the player's voluntary-skip intent marked (D45).
  const bill = computeUpkeep(run.party);
  const skip = new Set(run.camp.skippedUpkeep);
  const upkeepLines: LedgerLine[] = foodFirst(bill.lines).map((l) => ({
    id: `upkeep:${l.id}`,
    label: l.name,
    amount: skip.has(l.id) ? 0 : -l.cost,
    note: skip.has(l.id) ? "voluntarily skipped" : undefined,
    restoreAmount: -l.cost, // the funded cost — shown (struck) on a skipped line as the un-skip price
  }));

  // Banker: the standing position — the interest faucet, outstanding debt, and
  // theft protection (informational; the debt is the only summed liability).
  const eco = run.overworld;
  const bankerLines: LedgerLine[] = [];
  if (eco.interestPerStep > 0) bankerLines.push({ id: "banker:interest", label: "Interest / step", amount: eco.interestPerStep, note: "faucet" });
  if (eco.debt > 0) bankerLines.push({ id: "banker:debt", label: "Outstanding debt", amount: -eco.debt, note: "auto-repaid from loot" });
  if (eco.protection > 0) bankerLines.push({ id: "banker:protection", label: "Theft protection", amount: 0, note: `${Math.round(eco.protection * 100)}%` });

  const categories: LedgerCategory[] = [
    // Carried purse — a lump-sum header (no itemized lines): the caravan *is* the field, so
    // "carried into the field" was a redundant restatement of this figure. Its total still
    // reconciles the balance (opening + loot + field), it just isn't broken into a sub-line.
    { id: "opening", label: "Carried purse", total: openingTotal, lines: [] },
    { id: "loot", label: "Loot", total: lootTotal, lines: lootLines },
    { id: "field", label: "Field spend", total: fieldTotal, lines: fieldLines },
    { id: "upkeep", label: "Upkeep (tonight)", total: upkeepLines.reduce((s, l) => s + l.amount, 0), lines: upkeepLines, projected: true },
    { id: "banker", label: "Banker", total: bankerLines.reduce((s, l) => s + l.amount, 0), lines: bankerLines, projected: true },
  ];

  // Only the projected categories (Upkeep tonight, Banker) move the purse from here; the
  // realized ones already sum into `balance`.
  const forecastBalance = balance + categories.filter((c) => c.projected).reduce((s, c) => s + c.total, 0);

  return {
    balance,
    forecastBalance,
    categories,
    influence: opts.influence ?? 0,
    forecast: projectForecast(run),
    marketReady: opts.marketReady ?? false,
  };
}

/** The soft Break-Camp gate (D45) — whether to warn, and why. */
export interface NightEndGate {
  /** True if something warrants a forced look before departing (else one-click). */
  warn: boolean;
  /** Human-readable reasons (empty when `warn` is false). */
  reasons: string[];
}

/**
 * The **intent-aware** soft gate on Break Camp (D45). Warns only when the player is
 * actually pushing their luck — an outstanding **debt** (Banker gold or worn gear),
 * a line they genuinely **can't afford** (a *non-voluntary* breach), or a
 * **projected shortfall** (the burn to the nearest visible rest outruns the purse,
 * on the **pessimistic** loot floor, D48). A **deliberately** unticked line never
 * nags — it keys off *intent*, not the funded bit (D45). Pure projection.
 */
export function nightEndGate(run: RunState): NightEndGate {
  const reasons: string[] = [];
  const skip = new Set(run.camp.skippedUpkeep);

  // Outstanding worn-gear debt (D45/D47) — a rest node clears it.
  if (run.camp.gearWear > 0) {
    reasons.push(`Worn gear is piling up (${run.camp.gearWear}) — route to a rest node to clear it.`);
  }
  // Outstanding Banker debt (D30).
  if (run.overworld.debt > 0) {
    reasons.push(`Outstanding Banker debt: ${run.overworld.debt}g.`);
  }

  // A line you can't afford — but only nag *non-voluntary* breaches (intent, D45).
  let gold = run.camp.gold;
  for (const line of foodFirst(computeUpkeep(run.party).lines)) {
    if (skip.has(line.id)) continue; // deliberate skip — you meant it, no nag
    if (gold >= line.cost) gold -= line.cost;
    else reasons.push(`Can't afford ${line.name} (${line.cost}g) — morale will suffer.`);
  }

  // A projected shortfall: the pessimistic burn to the nearest visible rest outruns
  // the purse (can't-afford-the-rest-at-route's-end, D45/D48).
  const { runway } = projectForecast(run);
  if (runway.purseAtRest !== undefined && runway.purseAtRest < 0) {
    reasons.push(`The burn to the next rest outruns the purse (short ${-runway.purseAtRest}g).`);
  }

  return { warn: reasons.length > 0, reasons };
}
