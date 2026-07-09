/**
 * Action-effect previews (D58) — the pure projection behind the overworld's hover
 * readout. Given a camp/overworld action, produce the signed changes it would make to
 * the caravan's figures: a `stat`-bound change arrows the matching readout tile, while a
 * change with no `stat` is *off-panel* (HP, Fatigue, Influence, Debt, Protection, …).
 *
 * Read straight off each skill's declared cost + effect (and the {@link ECONOMY} / upkeep
 * cores for the finance and rest verbs), so a preview can never drift from what the
 * resolver applies — the same doctrine as {@link "./ability-forecast"}'s shared cores.
 *
 * Pure logic: no Phaser, no DOM — the render layer only lays these out.
 */

import type { SkillDef } from "./skills";
import type { RunState } from "./run";
import { overworldCostOf, resolveKnob } from "./overworld-cost";
import { TRIAGE } from "./economy-actions";
import { ECONOMY } from "./economy-actions";
import { computeUpkeep, rpPerNight } from "./upkeep";

/** A caravan figure a preview can point an arrow at — matches the HUD readout tiles. */
export type PreviewStat = "purse" | "morale" | "storage" | "kits" | "rp" | "upkeep";

/**
 * One projected effect of an action. A `stat` binds it to a readout tile (arrowed in the
 * gutter); without one it's off-panel. `amount` drives the arrow + sign; `text` overrides
 * the display for fuzzy/unit values ("50%", "small heal"); `good` sets the good/bad colour
 * when the sign alone doesn't say (a rising Debt is bad) — defaults to `amount ≥ 0`.
 */
export interface PreviewChange {
  stat?: PreviewStat;
  label: string;
  amount?: number;
  text?: string;
  good?: boolean;
}

/**
 * The projected effect of a no-target camp/overworld skill (Cook Stew, Feast, Find Trade,
 * Savvy Barter, Survey, Forage) — from its declared cost + `effect`. One effect per skill
 * (D74), so this reads the sole `effect` the resolver applies; a combat-only skill (no
 * overworld effect kind) simply projects its cost.
 */
export function skillEffectPreview(skill: SkillDef, run: RunState): PreviewChange[] {
  const changes: PreviewChange[] = [];
  const cost = overworldCostOf(skill);
  const gold = resolveKnob(cost.gold, run);
  if (gold > 0) changes.push({ stat: "purse", label: "Purse", amount: -gold });
  if (cost.fatigue) changes.push({ label: "Fatigue", amount: cost.fatigue, good: false });
  const eff = skill.effect;
  switch (eff?.kind) {
    case "provisionMeal":
      changes.push({ stat: "rp", label: "Rest Pts", amount: eff.rp });
      changes.push({ label: "Food", text: "covered tonight", good: true });
      break;
    case "morale":
      changes.push({ stat: "morale", label: "Morale", amount: eff.morale });
      if (eff.partyHeal > 0) changes.push({ label: "Banked heal", amount: eff.partyHeal, good: true });
      break;
    case "openMarket":
      changes.push({ label: "Market", text: "opens here", good: true });
      break;
    case "primeDeal":
      changes.push({ label: "Next deal", text: "primed", good: true });
      break;
    case "survey":
      changes.push({ label: "Intel", text: `+${eff.tierBump} tier`, good: true });
      break;
    case "forage":
      changes.push({ label: "Forage", text: "gather materials", good: true });
      break;
  }
  return changes;
}

/** Triage's preview — the wound-scaled heal shown qualitatively (a resolver-internal
 *  formula); the flat fatigue bite on the healer is the known, exact cost. */
export function triageActionPreview(): PreviewChange[] {
  return [
    { label: "HP", text: "heals worst wound", good: true },
    { label: "Fatigue", amount: TRIAGE.fatigue, good: false },
  ];
}

/** In-place rest — pays a night's rations for banked RP + a small heal. */
export function inPlaceRestPreview(run: RunState): PreviewChange[] {
  return [
    { stat: "purse", label: "Purse", amount: -computeUpkeep(run.party).total },
    { stat: "rp", label: "Rest Pts", amount: rpPerNight(run.party) },
    { label: "HP", text: "small heal", good: true },
  ];
}

/** Banker — engage flat purse interest per node-step (`ceil(purse × rate)`, ≥1). */
export function bankerInterestPreview(run: RunState): PreviewChange[] {
  const perStep = run.camp.gold > 0 ? Math.max(1, Math.ceil(run.camp.gold * ECONOMY.banker.interestRate)) : 0;
  return [{ label: "Interest", text: `+${perStep}g/step`, good: true }];
}

/** Banker — advance gold to the purse now against future run gold (recorded as debt). */
export function bankerBorrowPreview(amount: number): PreviewChange[] {
  return [
    { stat: "purse", label: "Purse", amount },
    { label: "Debt", amount, good: false },
  ];
}

/** Banker — buy theft protection (a flat gold cost for a standing skim reduction). */
export function bankerProtectPreview(): PreviewChange[] {
  return [
    { stat: "purse", label: "Purse", amount: -ECONOMY.banker.protectionCost },
    { label: "Protection", text: `${Math.round(ECONOMY.banker.protectionLevel * 100)}%`, good: true },
  ];
}

/** Noble — court a patron: spend gold for Influence (once per node). */
export function patronizePreview(): PreviewChange[] {
  return [
    { stat: "purse", label: "Purse", amount: -ECONOMY.noble.patronizeCost },
    { label: "Influence", amount: ECONOMY.noble.patronizeYield, good: true },
  ];
}
