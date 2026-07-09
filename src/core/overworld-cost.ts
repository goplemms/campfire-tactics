/**
 * The overworld two-axis cost gate (D61/D72/#126) — knobs, the invariant, the check
 * closure, and the load-time validator.
 *
 * Split out of `overworld-actions.ts` (R3, #129): the {@link CostKnob} / {@link
 * OverworldCost} grammar, the D61 two-axis invariant + its {@link validateOverworldCost},
 * the {@link overworldCostOf} resolver, and the single {@link checkOverworldCost}
 * limiter gate whose passing check carries a **commit closure** spending exactly the
 * prices captured at check time (the #126 re-resolution trap is dead by construction).
 * Camp jobs, overworld abilities, and economy verbs all route through this one gate.
 *
 * The load-time walk over `JOBS[*].skills` (below) enforces the invariant at import —
 * a one-way dependency on `jobs.ts` (which does not import back), so the cycle the old
 * co-located version implied is relaxed.
 *
 * Pure logic: no Phaser, no DOM.
 */

import type { Unit } from "./units";
import type { RunState } from "./run";
import type { SkillDef } from "./skills";
import type { Cost } from "./cost";
import { skillContexts } from "./skills";
import { JOBS } from "./jobs";
import { nonNegInt, bumpCounter } from "./num";
import { spendFatigue } from "./fatigue";
import { spend } from "./purse-journal";
import { spendInfluence } from "./economy";
import { spendRp } from "./upkeep";
import { cooldownRemaining, campSkillUses } from "./overworld-state";

/**
 * A **price knob** (D72): either a fixed number, or a **provider** computed from the
 * run at gate time. The provider is how Cook Stew prices itself at *the night's Food
 * value* (`(run) => computeUpkeep(run.party).total`) rather than a static figure —
 * a single, generic seam that keeps the two-axis menu (no new typed cost-kind per
 * dynamic price). Must be a **pure** function of run state. It is resolved **once, at
 * check time** (#126): the passing check captures the resolved prices in its commit
 * closure, so an effect that moves party composition mid-verb can no longer drift the
 * committed spend away from the price the check gated on (the old re-resolution trap).
 */
export type CostKnob = number | ((run: RunState) => number);

/** Resolve a {@link CostKnob} against the run — a provider is sanitized to a non-negative int. */
export function resolveKnob(knob: CostKnob | undefined, run: RunState): number {
  return typeof knob === "function" ? nonNegInt(knob(run)) : knob ?? 0;
}

/** True if a price {@link CostKnob} is **declared** — a provider always counts (its value isn't known at load). */
export function knobDeclared(knob: CostKnob | undefined): boolean {
  return typeof knob === "function" || (knob ?? 0) > 0;
}

/**
 * The **two-axis cost menu** every camp/overworld action declares (D61 — the D29
 * limiter menu made explicit) — the **node-steps view** of the one {@link Cost} grammar
 * (#113): it drops the CT-only `charge` and keeps node-steps pacing (`cooldown`/`usesPerNode`)
 * × the shared price map (`fatigue`/`gold`/`influence`/`rp`/`material`, all documented on
 * {@link Cost}). Two independent axes, each optional:
 *
 * - **Pacing (axis A) — *how often*:** `cooldown` (node-steps, the D35 spine) and/or
 *   `usesPerNode` (a per-node cap; the costless-signature limiter, e.g. Cook Stew).
 * - **Price (axis B) — *per cast*:** `fatigue`, `gold`, `influence` (D62), `rp`.
 *
 * The **bug-killing invariant** (enforced once, in {@link validateOverworldCost}):
 * **no action may be both unpaced *and* unpriced** — "free and unlimited" becomes
 * unrepresentable. An action bounded by a finite **consumable** instead of a knob
 * (the Merchant's *sell* — you can only sell what you carry) declares `selfLimited`
 * to satisfy the invariant honestly.
 */
export type OverworldCost = Omit<Cost, "charge" | "clock">;

/** True if `cost` declares any **pacing** knob (cooldown or per-node cap). */
export function hasPacing(cost: OverworldCost): boolean {
  return (cost.cooldown ?? 0) > 0 || cost.usesPerNode !== undefined;
}

/** True if `cost` declares any **price** knob (fatigue / gold / influence / rp) — a provider counts (D72). */
export function hasPrice(cost: OverworldCost): boolean {
  return (cost.fatigue ?? 0) > 0 || knobDeclared(cost.gold) || knobDeclared(cost.influence) || knobDeclared(cost.rp);
}

/**
 * The **two-axis invariant** (D61): a camp/overworld action may not be both unpaced
 * *and* unpriced (unless it's `selfLimited` by a finite consumable). Throws if it is —
 * so "free and unlimited", the bug class behind the unlimited camp actions, is
 * unrepresentable. Run over every registered ability at module load.
 */
export function validateOverworldCost(label: string, cost: OverworldCost): void {
  if (!hasPacing(cost) && !hasPrice(cost) && !cost.selfLimited) {
    throw new Error(
      `Overworld action "${label}" is free and unlimited — give it pacing ` +
        `(cooldown/usesPerNode) or a price (fatigue/gold/influence/rp), or mark it selfLimited. ` +
        `(D61 two-axis invariant)`,
    );
  }
}

/**
 * The {@link OverworldCost} an overworld/camp {@link SkillDef} resolves through the gate
 * (D61/D72/#113): the skill's own `overworldCost` — the full two-axis menu (Survey's cooldown
 * + fatigue, Cook Stew's per-node cap + computed price, …). The former dual-source bridge
 * (`?? { usesPerNode: skill.usesPerNode }`) is **gone** (the #113 fold): the per-node cap lives
 * inside `overworldCost` alone now, so a skill that declares no cost simply has none (`{}`).
 */
export function overworldCostOf(skill: SkillDef): OverworldCost {
  return skill.overworldCost ?? {};
}

// Enforce the two-axis invariant (D61/D72) at load: every overworld/camp **skill's** cost
// must be paced or priced (no free-and-unlimited). The home is now `JobDef.skills` (A2,
// D72) — Survey, Cook Stew, the triad's verbs — so a bad record fails fast at import,
// exactly as the retired `OVERWORLD_ABILITIES` registry did for its `OverworldAbility`s.
for (const job of Object.values(JOBS)) {
  for (const skill of job.skills) {
    if (skillContexts(skill).includes("overworld")) {
      validateOverworldCost(skill.name, overworldCostOf(skill));
    }
  }
}

/** The per-cast prices a passing check resolved — **captured at check time** (#126). */
export interface OverworldPrices {
  /** Fatigue to spend on the acting unit (base only — no surcharge, D73; 0 with no actor). */
  fatigue: number;
  /** Gold to spend from the purse (a provider knob, already resolved). */
  gold: number;
  /** Influence to spend (already resolved). */
  influence: number;
  /** Rest Points to spend (already resolved). */
  rp: number;
}

/**
 * A two-axis cost check verdict — affordable (with the captured {@link OverworldPrices}
 * and the `commit` closure that spends exactly them), or why not.
 */
export type OverworldCostCheck =
  | { ok: true; prices: OverworldPrices; commit(): void }
  | { ok: false; reason: string };

/**
 * The **single limiter gate** (D61): check an action's two-axis {@link OverworldCost}
 * against the run — pacing (cooldown / per-node cap) and price (fatigue headroom /
 * gold / influence / rp). A pure check that spends nothing; a passing check carries
 * its **commit closure** (#126) — call `check.commit()` once the effect applied to
 * spend the costs and arm the pacing. The prices are **resolved once, at check time**,
 * and the closure spends exactly those figures: an effect that moves party composition
 * between check and commit can no longer drift a provider-priced spend away from what
 * the check gated on (the old re-resolution trap is dead by construction).
 *
 * `id` keys the pacing ledgers (cooldown + per-node uses); `label` names the action in
 * refusals. `unit` is the acting character — **required only when the cost has
 * `fatigue`** (an economy verb with no actor, e.g. Patronize, may omit it).
 *
 * Camp jobs, overworld abilities, and economy verbs all route through this one gate —
 * the D61 fold.
 */
export function checkOverworldCost(run: RunState, id: string, cost: OverworldCost, label: string, unit?: Unit): OverworldCostCheck {
  const eco = run.overworld;
  // Pacing — the cooldown spine.
  if ((cost.cooldown ?? 0) > 0) {
    const cd = cooldownRemaining(eco, id);
    if (cd > 0) return { ok: false, reason: `${label} is on cooldown (${cd} node${cd === 1 ? "" : "s"}).` };
  }
  // Pacing — the per-node cap.
  if (cost.usesPerNode !== undefined && campSkillUses(eco, id) >= cost.usesPerNode) {
    return { ok: false, reason: `${label} is spent for tonight — Rest & Set Out to use it again.` };
  }
  // Price — the loose fatigue guardrail (D73): a clearing verb spends only its **base** fatigue
  // on the acting unit. Over-extension is **never gated here** (no surcharge, no lock) — the bite
  // is deferred to the recovery/combat consequences (pricier rest-heal, next-day carryover, the
  // Exhausted Slow). A fatigue price still needs an actor to spend it on (an actorless economy
  // verb declares no fatigue).
  const fatigueSpend = unit ? (cost.fatigue ?? 0) : 0;
  // Price — gold (the run purse). The knob may be a provider (D72) — resolve it now, once.
  const goldCost = resolveKnob(cost.gold, run);
  if (goldCost > 0 && run.camp.gold < goldCost) {
    return { ok: false, reason: `Not enough gold for ${label} (${goldCost}g).` };
  }
  // Price — Influence (the Noble's per-expedition standing, D62).
  const influenceCost = resolveKnob(cost.influence, run);
  if (influenceCost > 0 && eco.influence < influenceCost) {
    return { ok: false, reason: `Not enough Influence for ${label} (${influenceCost}).` };
  }
  // Price — Rest Points.
  const rpCost = resolveKnob(cost.rp, run);
  if (rpCost > 0 && run.rp < rpCost) {
    return { ok: false, reason: `Not enough Rest Points for ${label} (${rpCost}).` };
  }
  const prices: OverworldPrices = { fatigue: fatigueSpend, gold: goldCost, influence: influenceCost, rp: rpCost };
  return {
    ok: true,
    prices,
    // The commit half of the gate (D61/#126), called only after the effect applied:
    // spend the **captured** prices (never re-resolved — the effect may have moved the
    // run since the check), arm the cooldown, and bump the per-node use count.
    commit(): void {
      if (prices.fatigue > 0 && unit) unit.fatigue = spendFatigue(unit.fatigue, prices.fatigue);
      if (prices.gold > 0) spend(run.camp, prices.gold, "action", id, { nodeId: run.mapNodeId, night: run.night });
      if (prices.influence > 0) spendInfluence(eco, prices.influence);
      if (prices.rp > 0) spendRp(run, prices.rp);
      if ((cost.cooldown ?? 0) > 0) eco.cooldowns[id] = cost.cooldown!;
      if (cost.usesPerNode !== undefined) bumpCounter(eco.campUses, id);
    },
  };
}
