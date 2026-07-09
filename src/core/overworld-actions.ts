/**
 * The overworld action **interpreter** + effect registry (D29/D35/D72).
 *
 * The overworld is the **twin of the combat CT clock** ({@link "./clock"}, D5),
 * one tier up: a data-driven hook surface where classes *act between nodes*. An
 * **overworld ability** is **data** — a {@link "./skills".SkillDef} with an
 * `overworldCost` + an {@link "./skills".OverworldActionEffect} — resolved by one
 * interpreter ({@link useOverworldSkill}), exactly as combat/camp skills are data
 * resolved by {@link "./skills"} (D3/D4 ethos). New abilities are new records, not new
 * branches.
 *
 * This module is the **interpreter half** of the economy (R3, #129): the cost grammar
 * + gate live in {@link "./overworld-cost"}, the per-run state in
 * {@link "./overworld-state"}, and the economy verbs (Merchant / Banker / Noble /
 * Triage) in {@link "./economy-actions"}. Here: the shared result types, the single
 * {@link useOverworldSkill} interpreter, and the exhaustive
 * {@link OVERWORLD_EFFECT_HANDLERS} effect registry.
 *
 * Determinism (D22): cooldowns/fatigue are plain run state — **no live RNG** (Forage's
 * roll rides a seeded stream).
 *
 * Pure logic: no Phaser, no DOM.
 */

import { fieldedUnits, primaryJobOf, type Unit } from "./units";
import type { RunState } from "./run";
import type { SkillDef, OverworldActionEffect, SkillEffect } from "./skills";
import type { MaterialCost } from "./cost";
import { unitHasCapability, getJob, type JobLookup } from "./jobs";
import { bumpCounter, nonNegInt } from "./num";
import { reachableFrom, marketOpenedFlag, getNode, effectiveMarketTier } from "./overworld";
import { satisfyUpkeepLine, accrueRp } from "./upkeep";
import { applyCampSkill, type CampOutcome } from "./camp";
import { availableSkills, grantAbilityUseXp, jobLevelOf } from "./leveling";
import { streamFor } from "./rng";
import { Labels } from "./rng-labels";
import { grantItem } from "./inventory";
import { overworldCostOf, checkOverworldCost, resolveKnob, type OverworldCost } from "./overworld-cost";
import { setNodeFlag, primeFlag, campSkillUses, cooldownRemaining, isPrimed } from "./overworld-state";
// The economy-verb effect **cores** (R4/A) — the post-gate mutations each economy verb also
// runs. The handlers below delegate to these so the projection (batch 3) and the legacy verbs
// share one body per mechanism (no behaviour drift). One-directional at runtime: economy-actions
// depends on this module only for the `ActionOutcome` type (erased) + the `DEAL_PRIMED_FLAG`
// value (used lazily), so importing its cores here is init-safe.
import {
  applySellEffect,
  applyBuyEffect,
  buyPriceFor,
  applyBorrowEffect,
  applyEngageInterestEffect,
  applyGuardPurseEffect,
  applyPatronizeEffect,
  applyTriageEffect,
  applyTriageFallbackEffect,
  mostWoundedFielded,
} from "./economy-actions";

// --- The shared action-result types -----------------------------------------

/**
 * The base shape **every** camp / overworld / economy action returns (D61): it
 * either `applied` (with an optional `detail` summary) or was refused (with a
 * `reason`). The single canonical result type the action surfaces share — the
 * economy verbs ({@link "./economy-actions"}) extend it directly.
 */
export interface ActionOutcome {
  /** True if the action took effect (costs spent, pacing armed). */
  applied: boolean;
  /** When refused: a human-readable reason for the render. */
  reason?: string;
  /** When applied: a short summary of what happened. */
  detail?: string;
}

/** An overworld-action outcome — the shared base plus the spend readouts. */
export interface OverworldActionResult extends ActionOutcome {
  /** Fatigue actually spent on the acting unit (base + any over-extension surcharge). */
  fatigueSpent?: number;
  /** Gold spent, if the ability was priced. */
  goldSpent?: number;
}

/** Extra inputs an ability may need (e.g. Scout's chosen target node, a trade's good/amount). */
export interface ActionOpts {
  /** Scout: the reachable node whose preview to raise. */
  targetNodeId?: string;
  /** Buy / Sell (the economy verbs, R4/A): the material id to trade. */
  materialId?: string;
  /** Buy (R4/A): the market tier to buy at (defaults to the current node's effective tier). */
  tier?: import("./overworld").MarketTier;
  /** Borrow (R4/A): the sum to advance to the purse. */
  amount?: number;
}

// --- The projection: availableActions (R4/B, #112 step 3) -------------------

/**
 * A verb's **gate verdict** in the {@link availableActions} projection — affordable, or the
 * why-refused reason. The run-tier twin of a combat skill's usability: derived from the same
 * {@link "./overworld-cost".checkOverworldCost} closure the interpreter runs, but **without
 * committing** (nothing is spent to enumerate).
 */
export type ActionVerdict = { ok: true } | { ok: false; reason: string };

/**
 * The **cost readout** for one action (R4/B, #112) — the resolved figures a surface reports for
 * each axis of the one {@link "./overworld-cost".OverworldCost} grammar: pacing (cooldown left /
 * per-node cap + uses left) and the per-cast **prices** with every provider knob already resolved
 * against the run (Cook Stew's food-valued gold, the Triage fallback's RP). Every field is
 * optional — an axis the action doesn't declare is simply absent. This is what a render greys/labels
 * a button from, and what the sim meta-policy reads to price a legal move.
 */
export interface ActionCostReadout {
  /** Fatigue spent on the acting unit per cast (base only, D73). */
  fatigue?: number;
  /** Gold spent from the purse per cast (a provider knob, already resolved). */
  gold?: number;
  /** Influence spent per cast (already resolved). */
  influence?: number;
  /** Rest Points spent per cast (already resolved). */
  rp?: number;
  /** A carried material consumed per cast (#113). */
  material?: MaterialCost;
  /** Node-steps of cooldown remaining (omitted when ready). */
  cooldown?: number;
  /** The declared per-node use cap, when the action is per-node paced. */
  usesPerNode?: number;
  /** Uses left at the current node, when per-node paced. */
  usesLeft?: number;
  /** True when the action is bounded by a finite consumable rather than a knob (Merchant Sell). */
  selfLimited?: boolean;
}

/**
 * One **available action** at the current node (R4/B, #112) — the run-tier twin of a surfaced
 * combat skill: a verb some fielded unit's overworld skill set offers, with its `verdict` (the
 * gate's ok / why-refused) and a `cost` readout, both derived — never hand-wired. Shaped for two
 * consumers: the {@link "../../game/scenes/OverworldScene"} camp UI (a render of this projection,
 * increment 11) **and** the sim meta-policy's legal-move enumeration (D56/D57).
 */
export interface ActionView {
  /** The owning {@link SkillDef}'s id — keys the pacing ledgers + the interpreter dispatch. */
  id: string;
  /** The verb's display name. */
  label: string;
  /** The fielded unit surfacing (and, for a fatigue-priced verb, performing) it. */
  actorId?: string;
  /** The verb's effect kind (the interpreter partition — buy/sell/triage/survey/…). */
  effectKind: SkillEffect["kind"];
  /** The gate verdict — offered, or why refused (the check closure, uncommitted). */
  verdict: ActionVerdict;
  /** The resolved per-axis cost readout. */
  cost: ActionCostReadout;
}

/**
 * The **resolved cost readout** for an action's {@link "./overworld-cost".OverworldCost} at the
 * run's current node (R4/B) — providers resolved, cooldown + per-node uses read from the ledgers.
 * The projection's cost half, split out so a surface can also read a single action's cost directly.
 */
export function readActionCost(run: RunState, id: string, cost: OverworldCost): ActionCostReadout {
  const out: ActionCostReadout = {};
  const fatigue = cost.fatigue ?? 0;
  if (fatigue > 0) out.fatigue = fatigue;
  const gold = resolveKnob(cost.gold, run);
  if (gold > 0) out.gold = gold;
  const influence = resolveKnob(cost.influence, run);
  if (influence > 0) out.influence = influence;
  const rp = resolveKnob(cost.rp, run);
  if (rp > 0) out.rp = rp;
  if (cost.material) out.material = cost.material;
  const cd = cooldownRemaining(run.overworld, id);
  if (cd > 0) out.cooldown = cd;
  if (cost.usesPerNode !== undefined) {
    out.usesPerNode = cost.usesPerNode;
    out.usesLeft = Math.max(0, cost.usesPerNode - campSkillUses(run.overworld, id));
  }
  if (cost.selfLimited) out.selfLimited = true;
  return out;
}

/**
 * **`availableActions(run)`** (R4/B, #112 step 3) — the run-tier twin of {@link
 * "./leveling".availableSkills}: every overworld verb usable at the current node, each with its
 * gate verdict and cost readout, **derived** from core state (no hand-wired per-verb blocks). For
 * every **fielded** party member ({@link "./units".fieldedUnits}) it folds that unit's overworld
 * skill set — its job skills plus the {@link "./jobs-data/support".UNIVERSAL_OVERWORLD_SKILLS}
 * home (Buy / the Triage fallback), exactly as `availableSkills` folds combat's universals — and
 * runs each through the shared {@link "./overworld-cost".checkOverworldCost} gate **without
 * committing** to read the verdict. `lookup` is injectable for fixtures.
 *
 * The **one projection** every camp verb surface renders (the D80 layout stays; the wiring becomes
 * this) and the sim meta-policy's legal-move enumeration reads (D56/D57). A universal verb surfaces
 * once per fielded unit (as `availableSkills` reports it per unit); a surface that wants a single
 * Buy row dedupes on `id` at render time.
 */
export function availableActions(run: RunState, lookup: JobLookup = getJob): ActionView[] {
  const out: ActionView[] = [];
  for (const unit of fieldedUnits(run.party)) {
    for (const skill of availableSkills(unit, "overworld", lookup)) {
      const cost = overworldCostOf(skill);
      const check = checkOverworldCost(run, skill.id, cost, skill.name, unit);
      out.push({
        id: skill.id,
        label: skill.name,
        actorId: unit.id,
        effectKind: skill.effect.kind,
        verdict: check.ok ? { ok: true } : { ok: false, reason: check.reason },
        cost: readActionCost(run, skill.id, cost),
      });
    }
  }
  return out;
}

// --- The interpreter --------------------------------------------------------

/** The outcome of a gated camp-skill use — the {@link CampOutcome} plus the gate verdict. */
export interface CampSkillResult extends OverworldActionResult {
  /** When applied: what the camp skill changed + the levels its owner gained. */
  outcome?: CampOutcome & { levels: number };
}

/**
 * Use an **overworld / camp skill** at the current node (D35/D61/D72) — the **single
 * interpreter** every between-nodes action routes through (A2): Survey, Cook Stew, the
 * non-combat triad's verbs, the fixtures. One path replaces both the old registry
 * interpreter (`takeOverworldAction`) and the camp-skill path (`useCampSkillAtNode`):
 *
 * 1. **Class gate** is implicit — the skill came off the actor's job via {@link
 *    "./leveling".availableSkills}; **Capability gate** (D72) is the explicit `requires`.
 * 2. The shared two-axis **cost gate** ({@link "./overworld-cost".checkOverworldCost} — computed costs and all).
 * 3. The **effect**, by partition: the exhaustive {@link OVERWORLD_EFFECT_HANDLERS} registry
 *    (openMarket / primeDeal / provisionMeal / survey), or the camp resolver for a `morale`
 *    {@link "./skills".CampEffect} (Cook Stew).
 * 4. The check's commit closure (`check.commit()`, #126) + use-XP ({@link grantAbilityUseXp}, D53).
 *
 * Never throws on a refusal — returns the {@link CampSkillResult} the render reads.
 */
export function useOverworldSkill(run: RunState, unit: Unit, skill: SkillDef, opts: ActionOpts = {}): CampSkillResult {
  // Capability gate (D72): the explicit Capability gate, layered on the implicit class home.
  if (skill.requires && !unitHasCapability(unit, skill.requires)) {
    return { applied: false, reason: `${unit.name} can't ${skill.name} — only a ${skill.requires} can.` };
  }
  const cost = overworldCostOf(skill);
  const check = checkOverworldCost(run, skill.id, cost, skill.name, unit);
  if (!check.ok) return { applied: false, reason: check.reason };

  // One effect per skill (D74): an overworld skill (Survey, Cook Stew, Forage) resolves its
  // sole `effect` here — no second overworld face to reach for.
  const effect = skill.effect;
  // The overworld-economy partition (incl. migrated Survey) — the exhaustive registry.
  if (isOverworldActionEffect(effect)) {
    const applied = applyOverworldEffect(effect, { run, unit, opts });
    if (!applied.ok) return { applied: false, reason: applied.reason };
    check.commit();
    grantAbilityUseXp(unit);
    return { applied: true, detail: applied.detail, fatigueSpent: check.prices.fatigue, goldSpent: check.prices.gold > 0 ? check.prices.gold : undefined };
  }
  // The camp partition (Cook Stew's `morale`) — resolved by the camp interpreter.
  if (effect.kind === "morale") {
    const camp = applyCampSkill(skill, run.camp);
    check.commit();
    const levels = grantAbilityUseXp(unit);
    const parts: string[] = [];
    if (camp.morale) parts.push(`+${camp.morale} morale`);
    if (camp.bankedHeal) parts.push(`banked +${camp.bankedHeal} HP/unit`);
    if (levels > 0) parts.push(`${unit.name} reached L${unit.level}!`);
    return { applied: true, outcome: { ...camp, levels }, detail: `${skill.name}: ${parts.join(", ")}.`, fatigueSpent: check.prices.fatigue };
  }
  // A non-overworld effect routed here by mistake (a battle/deploy kind) — refuse cleanly.
  return { applied: false, reason: `${skill.name} is not an overworld action.` };
}

// --- The overworld-effect registry (D72) ------------------------------------

/** The well-known one-shot flag a Merchant's "next deal" primes (D72) — consumed by the next trade. */
export const DEAL_PRIMED_FLAG = "merchant-deal-primed";

/** What an {@link OverworldActionEffect} handler resolves against — the run, the actor, and the action opts. */
export interface OverworldEffectCtx {
  run: RunState;
  unit: Unit;
  opts: ActionOpts;
}

/** An overworld-effect outcome — applied (with a detail) or refused (with a reason). */
export type OverworldEffectResult = { ok: true; detail: string } | { ok: false; reason: string };

/**
 * The **overworld-effect registry** (D72) — a handler per {@link OverworldActionEffect}
 * kind, the mapped type `{ [K in OverworldActionEffect["kind"]]: ... }` **exhaustive at
 * compile time** (mirroring `skills.ts`'s `BATTLE_EFFECT_HANDLERS` / `ability-forecast.ts`'s
 * `FORECAST_HANDLERS` / `grants.ts`'s `GRANT_EFFECT_HANDLERS`): adding a kind to the union
 * fails the build here until its handler is written. Each handler applies its mechanism
 * against the run and returns a result the interpreter surfaces — effects are **data**,
 * one interpreter, no new branches (D3/D4). The verbs that carry these onto real classes
 * (Find Trade / Savvy Barter / Cook Stew) are the following content pass.
 */
const OVERWORLD_EFFECT_HANDLERS: {
  [K in OverworldActionEffect["kind"]]: (effect: Extract<OverworldActionEffect, { kind: K }>, ctx: OverworldEffectCtx) => OverworldEffectResult;
} = {
  openMarket: (_effect, { run }) => {
    // Find-Trade mechanism: open an impromptu market at this node for the node-step
    // (the per-node flag effectiveMarketTier folds in; cleared at the next Break Camp).
    setNodeFlag(run.overworld, marketOpenedFlag(run.mapNodeId));
    return { ok: true, detail: "Opened an impromptu market here." };
  },
  primeDeal: (_effect, { run }) => {
    // Savvy-Barter mechanism: prime the one-shot "next deal" flag a follow-up trade consumes.
    primeFlag(run.overworld, DEAL_PRIMED_FLAG);
    return { ok: true, detail: "The next deal is primed." };
  },
  provisionMeal: (effect, { run }) => {
    // Cook-Stew mechanism: bank RP (D9) and satisfy the Food line (D15/D45) — the day's
    // food becomes recovery with no double-charge (payUpkeep skips the satisfied line).
    accrueRp(run, effect.rp);
    satisfyUpkeepLine(run.camp, "food");
    return { ok: true, detail: `Cooked: +${effect.rp} Rest Points banked, the night's food covered.` };
  },
  survey: (effect, { run, opts }) => {
    // The Scout's recon (D24), migrated from the retired registry switch (D72): raise a
    // chosen *reachable* node's banded intel preview (read back by intel.previewNode).
    const targetId = opts.targetNodeId;
    if (!targetId) return { ok: false, reason: "Survey needs a node to read." };
    const reachable = reachableFrom(run.map, run.mapNodeId);
    if (!reachable.some((n) => n.id === targetId)) {
      return { ok: false, reason: "That node isn't reachable to survey." };
    }
    bumpCounter(run.overworld.scouted, targetId, effect.tierBump);
    return { ok: true, detail: `Surveyed ${targetId} — preview raised ${effect.tierBump} tier.` };
  },
  forage: (effect, { run, unit }) => {
    // The Survivalist's clearing verb (D73): a guaranteed floor + job-level-scaled bonus rolls,
    // deterministic per node-step. The seed label keys on node + night + the **per-night use index**
    // (read pre-commit from campUses, so the 1st forage this night is 0 and the 2nd is 1) — two
    // forages at one node roll differently, and re-foraging across in-place rests (night bumps) too.
    const found: string[] = [];
    // Grants land unconditionally (D75) — a Forage find never silently vanishes at the cap;
    // any over-capacity is resolved later by the discard menu / autoTrim.
    for (const id of effect.guaranteed) {
      grantItem(run.inventory, id);
      found.push(id);
    }
    const lvl = jobLevelOf(unit, primaryJobOf(unit));
    const rolls = effect.baseRolls + Math.floor(lvl * effect.rollsPerLevel);
    const idx = campSkillUses(run.overworld, "forage");
    const rng = streamFor(run.seed, Labels.forage(run.mapNodeId, run.night, idx));
    for (let i = 0; i < rolls; i++) {
      const pick = rng.pickWeighted(effect.table, (e) => e.weight);
      grantItem(run.inventory, pick.id);
      found.push(pick.id);
    }
    return { ok: true, detail: found.length ? `Foraged: ${found.join(", ")}.` : "Foraged, but found nothing." };
  },
  // --- The economy verbs (R4/A) — each delegates to its economy-actions core, so the
  // projection (batch 3) and the legacy free-function verbs share one body per mechanism.
  buy: (_effect, { run, opts }) => {
    // Universal Buy (D61): the good + market tier come from the action opts; the gold price
    // (with any primed Savvy-Barter overlay) rode the shared gate before this handler.
    const tier = opts.tier ?? effectiveMarketTier(getNode(run.map, run.mapNodeId), run.party, run.overworld);
    const primed = isPrimed(run.overworld, DEAL_PRIMED_FLAG);
    return applyBuyEffect(run, opts.materialId ?? "", tier, buyPriceFor(tier, primed), primed);
  },
  sell: (_effect, { run, opts }) => {
    const r = applySellEffect(run, opts.materialId ?? "");
    return r.ok ? { ok: true, detail: r.detail } : { ok: false, reason: r.reason };
  },
  borrow: (_effect, { run, opts }) => {
    const amount = nonNegInt(opts.amount ?? 0);
    if (amount <= 0) return { ok: false, reason: "Nothing to borrow." };
    return { ok: true, detail: applyBorrowEffect(run, amount).detail };
  },
  engageInterest: (_effect, { run }) => {
    const r = applyEngageInterestEffect(run);
    return r.ok ? { ok: true, detail: r.detail } : { ok: false, reason: r.reason };
  },
  guardPurse: (_effect, { run }) => {
    return { ok: true, detail: applyGuardPurseEffect(run).detail };
  },
  patronize: (_effect, { run }) => {
    return { ok: true, detail: applyPatronizeEffect(run).detail };
  },
  triage: (effect, { run, unit }) => {
    // Treats the worst first (D40). Two paths (R4, the ratified ruling): the Medic's
    // full-strength fatigue-fuelled heal, or the universal RP-funded half-efficiency fallback.
    const wounded = mostWoundedFielded(run);
    if (!wounded) return { ok: false, reason: "No wounded fighter to triage." };
    const healed = effect.fallback ? applyTriageFallbackEffect(wounded) : applyTriageEffect(unit, wounded, effect.base);
    return { ok: true, detail: `Triaged ${wounded.name}: +${healed} HP.` };
  },
};

/** True if a {@link "./skills".SkillEffect} is an {@link OverworldActionEffect} (the registry owns its kind). */
export function isOverworldActionEffect(effect: SkillEffect): effect is OverworldActionEffect {
  return effect.kind in OVERWORLD_EFFECT_HANDLERS;
}

/**
 * Apply an {@link OverworldActionEffect} through the exhaustive {@link
 * OVERWORLD_EFFECT_HANDLERS} registry (D72) — the single overworld-effect interpreter the
 * camp/overworld action path ({@link useOverworldSkill}) dispatches through.
 */
export function applyOverworldEffect(effect: OverworldActionEffect, ctx: OverworldEffectCtx): OverworldEffectResult {
  const handler = OVERWORLD_EFFECT_HANDLERS[effect.kind] as (e: OverworldActionEffect, c: OverworldEffectCtx) => OverworldEffectResult;
  return handler(effect, ctx);
}
