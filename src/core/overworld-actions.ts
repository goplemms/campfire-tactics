/**
 * The overworld action economy (D29/D35) — the machinery of the second hook
 * surface.
 *
 * The overworld is the **twin of the combat CT clock** ({@link "./clock"}, D5),
 * one tier up: a data-driven hook surface where classes *act between nodes*. An
 * **overworld ability** is **data** — an id, a display, an {@link OverworldEffect},
 * and a {@link OverworldCost} drawn from the short limiter menu (D29) — resolved by
 * one interpreter ({@link useOverworldSkill}), exactly as combat/camp skills are
 * data resolved by {@link "./skills"} (D3/D4 ethos). New abilities are new records,
 * not new branches. Since D72 the home is unified onto `JobDef.skills` (A2): an
 * overworld action is a {@link "./skills".SkillDef} with an `overworldCost` + an
 * {@link "./skills".OverworldActionEffect}, surfaced through {@link "./leveling".availableSkills}.
 *
 * - **Spine — per-ability cooldowns (D35).** Each ability carries a **node-step
 *   cooldown**: firing it arms the cooldown; advancing a node ({@link tickCooldowns},
 *   driven from {@link "./run".recordNight}) decrements it; at 0 it re-arms. The
 *   cooldown is **per-run, per-ability** — a Merchant can't market every node.
 *   *Cooldowns encourage engagement* (use-it-or-waste-it) where a tight hoardable
 *   pool would punish use.
 * - **Guardrail — loose fatigue (D35).** Each ability *may* also cost
 *   {@link "./fatigue".spendFatigue | fatigue} on the **acting character** — the
 *   loose over-extension stake, not the pace. An over-extended actor pays a gentle
 *   surcharge and, when exhausted, can't push the most-demanding actions.
 * - **Per-ability costs (D34/D30).** `gold` (the single existing run pool — the
 *   two-pool purse split is M10) rides on top of the cooldown spine.
 *
 * Determinism (D22): cooldowns/fatigue are plain run state — **no live RNG**.
 *
 * Pure logic: no Phaser, no DOM.
 */

import { healUnit, primaryJobOf, type Unit } from "./units";
import type { RunState } from "./run";
import type { SkillDef, OverworldActionEffect, SkillEffect } from "./skills";
import { skillContexts } from "./skills";
import { getJob, unitHasCapability, JOBS } from "./jobs";
import { PASSIVE } from "./combat";
import { spendFatigue } from "./fatigue";
import { decayCounters, bumpCounter, nonNegInt } from "./num";
import { earn, spend } from "./purse-journal";
import { spendInfluence } from "./economy";
import { reachableFrom, marketOpenedFlag } from "./overworld";
import { satisfyUpkeepLine } from "./upkeep";
import { applyCampSkill, type Camp, type CampOutcome } from "./camp";
import { grantAbilityUseXp, jobLevelOf } from "./leveling";
import { streamFor } from "./rng";
import { grantItem } from "./inventory";

/**
 * A **price knob** (D72): either a fixed number, or a **provider** computed from the
 * run at gate time. The provider is how Cook Stew prices itself at *the night's Food
 * value* (`(run) => computeUpkeep(run.party).total`) rather than a static figure —
 * a single, generic seam that keeps the two-axis menu (no new typed cost-kind per
 * dynamic price). **Must be a pure function of run state that is stable across the
 * action** (it is resolved at the check and again at the commit, after the effect):
 * key it off composition the effect doesn't move (party size), not the purse it spends.
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
 * limiter menu made explicit). Two independent axes, each optional:
 *
 * - **Pacing (axis A) — *how often*:** `cooldown` (node-steps, the D35 spine) and/or
 *   `usesPerNode` (a per-node cap; the costless-signature limiter, e.g. Cook Stew).
 * - **Price (axis B) — *per cast*:** `fatigue` (the loose over-extension guardrail),
 *   `gold` (the run purse), `influence` (the Noble's walled-off currency, D62), `rp`.
 *
 * The **bug-killing invariant** (enforced once, in {@link validateOverworldCost}):
 * **no action may be both unpaced *and* unpriced** — "free and unlimited" becomes
 * unrepresentable. An action bounded by a finite **consumable** instead of a knob
 * (the Merchant's *sell* — you can only sell what you carry) declares `selfLimited`
 * to satisfy the invariant honestly.
 */
export interface OverworldCost {
  // --- Pacing (axis A): how often the action may fire ---
  /** Node-steps before this action can fire again — the D35 spine. */
  cooldown?: number;
  /** Per-node use cap (reset each node-step) — the limiter for costless signature actions. */
  usesPerNode?: number;
  // --- Price (axis B): what each individual cast costs ---
  /** Fatigue spent on the acting character — the loose guardrail (D35). */
  fatigue?: number;
  /** Run gold spent from the purse (`camp.gold`, D34/D30) — static, or a {@link CostKnob} provider. */
  gold?: CostKnob;
  /**
   * Influence spent — the Noble's walled-off currency (D62; run-scoped). Static or a provider.
   * **Reserved (no verb prices in it yet):** the gate fully checks + spends it ({@link
   * checkOverworldCost}/{@link commitOverworldCost}), kept for the planned **Influence revamp** —
   * the intended home for routing Bribe's spend through the shared gate (it currently spends
   * Influence directly via `spendInfluence`, off-gate). Declared-but-unused **on purpose**, not dead.
   */
  influence?: CostKnob;
  /**
   * Rest Points spent. Static or a provider. **Reserved (no verb prices in it yet):** the gate
   * honors it for a future RP-priced overworld/clearing verb (RP is live — banked nightly, spent on
   * healing; D73's Weary heal-cost is recovery-side, not this knob). Declared-but-unused on purpose.
   */
  rp?: CostKnob;
  // --- Escape hatch: an intrinsic limiter outside the two-knob menu ---
  /**
   * True when the action is bounded by a finite **consumable** rather than a
   * pacing/price knob — e.g. the Merchant's *sell* (you can only sell goods you
   * carry). Lets such an action satisfy the no-free-and-unlimited invariant
   * without a synthetic cooldown. Use only when the limiter is genuinely real.
   */
  selfLimited?: boolean;
}

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

// --- The per-run economy sub-state ------------------------------------------

/**
 * The overworld economy's per-run state (D35): per-ability cooldowns (node-steps
 * remaining; absent/0 ⇒ ready) and the per-node intel tier bumps Scout buys
 * (read back by {@link "./intel".previewNode}'s `extraTier`).
 */
export interface OverworldEconomy {
  /** Node-steps remaining on each ability's cooldown, keyed by ability id. */
  cooldowns: Record<string, number>;
  /** Extra intel tiers bought per node id (Scout), fed to `previewNode`. */
  scouted: Record<string, number>;
  /**
   * Times each **camp job skill** has been used **at the current node**, keyed by
   * skill id — the limiter for costless signature actions (D35; Cook stew, Merchant
   * trade). Compared against {@link "./skills".SkillDef.usesPerNode} and **reset to
   * empty each node-step** ({@link tickCooldowns}), so the allowance is per-node, not
   * per-run.
   */
  campUses: Record<string, number>;
  /**
   * **Per-node ability flags** (D72) — a general boolean bag for signature actions that
   * mark a transient fact about *this* node (the Find-Trade "impromptu market opened
   * here" flag, folded into {@link "./overworld".effectiveMarketTier}). **Reset to empty
   * each node-step** ({@link tickCooldowns}), exactly like {@link campUses}, so the mark
   * never leaks to the next node. Set/read via {@link setNodeFlag}/{@link hasNodeFlag}.
   */
  nodeFlags: Record<string, boolean>;
  /**
   * **One-shot primed flags** (D72) — a general boolean bag for "the *next* X goes a
   * certain way" treats (the Savvy-Barter "next deal primed" flag, consumed by the next
   * trade). **Consumed on read** ({@link consumeFlag}) and **persists across node-steps**
   * until then (unlike {@link nodeFlags}) — a primed treat you haven't cashed waits. Set
   * via {@link primeFlag}; peek without consuming via {@link isPrimed}.
   */
  primedFlags: Record<string, boolean>;
  /**
   * The **Banker's** purse-scoped sub-state (M10, D30/D34) — **never** touches the
   * guild treasury. All three are off (0) until a Banker verb engages them
   * ({@link "./economy-actions"}).
   */
  /** Flat purse interest credited per node-step once the Banker engages it (0 = off). */
  interestPerStep: number;
  /** Outstanding buy-on-debt principal — auto-repaid from incoming run gold. */
  debt: number;
  /** Theft-protection level (0 = none) — blunts a thief's skim ({@link "./theft"}). */
  protection: number;
  /**
   * The Noble's **per-expedition Influence** standing (D62) — a walled-off currency
   * (never pays Upkeep/gear, {@link "./economy".addInfluence}) that accrues passively
   * from a Noble's presence + the Patronize verb, and is spent on bribes. Run-scoped
   * (rebuilt each expedition, like the purse) — it does **not** bank to the guild.
   */
  influence: number;
}

/** A fresh, fully-ready economy (every ability off cooldown, nothing scouted, no flags set). */
export function createOverworldEconomy(): OverworldEconomy {
  return { cooldowns: {}, scouted: {}, campUses: {}, nodeFlags: {}, primedFlags: {}, interestPerStep: 0, debt: 0, protection: 0, influence: 0 };
}

/** A deep copy of the economy (for snapshots / round-trips). */
export function cloneOverworldEconomy(eco: OverworldEconomy): OverworldEconomy {
  return {
    cooldowns: { ...eco.cooldowns },
    scouted: { ...eco.scouted },
    campUses: { ...eco.campUses },
    nodeFlags: { ...eco.nodeFlags },
    primedFlags: { ...eco.primedFlags },
    interestPerStep: eco.interestPerStep,
    debt: eco.debt,
    protection: eco.protection,
    influence: eco.influence,
  };
}

// --- General ability-flag bag (D72) -----------------------------------------

/** Set a **per-node** ability flag (cleared each node-step) — the Find-Trade "market opened here" shape. */
export function setNodeFlag(eco: OverworldEconomy, flag: string): void {
  eco.nodeFlags[flag] = true;
}

/** True if a **per-node** ability flag is currently set (a non-consuming read). */
export function hasNodeFlag(eco: OverworldEconomy, flag: string): boolean {
  return eco.nodeFlags[flag] === true;
}

/** **Prime** a one-shot ability flag (persists across node-steps until consumed) — the Savvy-Barter shape. */
export function primeFlag(eco: OverworldEconomy, flag: string): void {
  eco.primedFlags[flag] = true;
}

/**
 * Read **and consume** a one-shot primed flag (D72): returns true at most once per
 * prime, clearing it — the consume-on-next-use helper a follow-up action reads (the
 * Savvy-Barter "next deal" reading its primed discount). Returns false if never primed.
 */
export function consumeFlag(eco: OverworldEconomy, flag: string): boolean {
  if (eco.primedFlags[flag]) {
    delete eco.primedFlags[flag];
    return true;
  }
  return false;
}

/** Peek at a one-shot primed flag **without consuming** it (for render surfacing). */
export function isPrimed(eco: OverworldEconomy, flag: string): boolean {
  return eco.primedFlags[flag] === true;
}

/** Node-steps remaining on an ability's cooldown (0 = ready). */
export function cooldownRemaining(eco: OverworldEconomy, abilityId: string): number {
  return eco.cooldowns[abilityId] ?? 0;
}

/** Times a camp job skill has already been used at the current node (0 = unused). */
export function campSkillUses(eco: OverworldEconomy, skillId: string): number {
  return eco.campUses[skillId] ?? 0;
}

/**
 * Uses **left** for a camp job skill at the current node. `usesPerNode` undefined ⇒
 * uncapped (the skill is gated by its own per-cast cost), reported as `Infinity`.
 */
export function campSkillUsesLeft(eco: OverworldEconomy, skill: SkillDef): number {
  if (skill.usesPerNode === undefined) return Infinity;
  return Math.max(0, skill.usesPerNode - campSkillUses(eco, skill.id));
}

/** The extra intel tier bought for a node so far (the Scout bump). */
export function scoutedTier(eco: OverworldEconomy, nodeId: string): number {
  return eco.scouted[nodeId] ?? 0;
}

/**
 * Advance the overworld clock **one node-step**: decrement every cooldown by 1
 * (floored at 0) and **clear the per-node camp-use counts** so the next node opens
 * with a fresh action allowance (D35). Called once per node played from
 * {@link "./run".breakCamp}, so both combat and rest nodes tick the spine.
 */
export function tickCooldowns(eco: OverworldEconomy): void {
  decayCounters(eco.cooldowns, 1);
  // Per-node allowance + per-node flags reset at the node boundary (D35/D72) — a new
  // camp, fresh uses, and any "opened here" mark cleared. (Primed one-shots persist.)
  eco.campUses = {};
  eco.nodeFlags = {};
}

/**
 * Accrue the **Banker's** flat purse interest one node-step (M10, D30/D34): credit
 * `interestPerStep` to the carried purse (`camp.gold`). Called once per node played
 * from {@link "./run".recordNight}, right alongside {@link tickCooldowns}. A pure
 * **purse** faucet — it **never** touches the guild treasury (D34). Returns the
 * gold credited (0 when no Banker interest is engaged).
 */
export function accruePurseInterest(eco: OverworldEconomy, camp: Camp): number {
  if (eco.interestPerStep <= 0) return 0;
  earn(camp, eco.interestPerStep, "interest", "Banker interest");
  return eco.interestPerStep;
}

// --- The resolver -----------------------------------------------------------

/**
 * The base shape **every** camp / overworld / economy action returns (D61): it
 * either `applied` (with an optional `detail` summary) or was refused (with a
 * `reason`). The single canonical result type the action surfaces share — the
 * economy verbs' `VerbResult` ({@link "./economy-actions"}) is an alias of this.
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
export interface ActionResult extends ActionOutcome {
  /** Fatigue actually spent on the acting unit (base + any over-extension surcharge). */
  fatigueSpent?: number;
  /** Gold spent, if the ability was priced. */
  goldSpent?: number;
}

/** Extra inputs an ability may need (e.g. Scout's chosen target node). */
export interface ActionOpts {
  /** Scout: the reachable node whose preview to raise. */
  targetNodeId?: string;
}

/** A two-axis cost check verdict — affordable (with the fatigue to spend), or why not. */
export type OverworldCostCheck = { ok: true; fatigueSpend: number } | { ok: false; reason: string };

/**
 * The **single limiter gate** (D61): check an action's two-axis {@link OverworldCost}
 * against the run — pacing (cooldown / per-node cap) and price (fatigue headroom /
 * gold / influence / rp). A pure check that spends nothing; it returns the fatigue to
 * spend on commit so the over-extension surcharge is computed once. `id` keys the
 * pacing ledgers (cooldown + per-node uses); `label` names the action in refusals.
 * `unit` is the acting character — **required only when the cost has `fatigue`** (an
 * economy verb with no actor, e.g. Patronize, may omit it).
 *
 * Camp jobs, overworld abilities, and economy verbs all route through this one gate —
 * the D61 fold. Pair a passing check with {@link commitOverworldCost} once the effect
 * applies.
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
    return { ok: false, reason: `${label} is spent for tonight — Break Camp to use it again.` };
  }
  // Price — the loose fatigue guardrail (D73): a clearing verb spends only its **base** fatigue
  // on the acting unit. Over-extension is **never gated here** (no surcharge, no lock) — the bite
  // is deferred to the recovery/combat consequences (pricier rest-heal, next-day carryover, the
  // Exhausted Slow). A fatigue price still needs an actor to spend it on (an actorless economy
  // verb declares no fatigue).
  const fatigueSpend = unit ? (cost.fatigue ?? 0) : 0;
  // Price — gold (the run purse). The knob may be a provider (D72) — resolve it now.
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
  return { ok: true, fatigueSpend };
}

/**
 * Spend a checked action's costs and arm its pacing (D61) — the commit half of the
 * gate, called only after {@link checkOverworldCost} passed and the effect applied.
 * Spends the (already-surcharged) fatigue, gold, influence, and rp; arms the cooldown
 * and bumps the per-node use count keyed by `id`.
 */
export function commitOverworldCost(run: RunState, id: string, cost: OverworldCost, fatigueSpend: number, unit?: Unit): void {
  const eco = run.overworld;
  if (fatigueSpend > 0 && unit) unit.fatigue = spendFatigue(unit.fatigue, fatigueSpend);
  // Re-resolve the price knobs (D72) — a static knob is unchanged; a provider is pure
  // and stable across the action, so this matches what {@link checkOverworldCost} gated on.
  const goldCost = resolveKnob(cost.gold, run);
  const influenceCost = resolveKnob(cost.influence, run);
  const rpCost = resolveKnob(cost.rp, run);
  if (goldCost > 0) spend(run.camp, goldCost, "action", id, { nodeId: run.mapNodeId, night: run.night });
  if (influenceCost > 0) spendInfluence(eco, influenceCost);
  if (rpCost > 0) run.rp -= rpCost;
  if ((cost.cooldown ?? 0) > 0) eco.cooldowns[id] = cost.cooldown!;
  if (cost.usesPerNode !== undefined) bumpCounter(eco.campUses, id);
}

/**
 * The {@link OverworldCost} an overworld/camp {@link SkillDef} resolves through the gate
 * (D61/D72): the skill's own `overworldCost` (the full two-axis menu — Survey's cooldown +
 * fatigue, a computed price, …), or — for a costless signature action that declares only
 * `usesPerNode` (Cook Stew) — the per-node cap alone. Supersedes the former `campSkillCost`,
 * widening it from the pacing knob to the whole menu. (`usesPerNode` undefined ⇒ no cap,
 * the legacy "pays its own way" escape.)
 */
export function overworldCostOf(skill: SkillDef): OverworldCost {
  return skill.overworldCost ?? { usesPerNode: skill.usesPerNode };
}

/** The outcome of a gated camp-skill use — the {@link CampOutcome} plus the gate verdict. */
export interface CampSkillResult extends ActionResult {
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
 * 2. The shared two-axis **cost gate** ({@link checkOverworldCost} — computed costs and all).
 * 3. The **effect**, by partition: the exhaustive {@link OVERWORLD_EFFECT_HANDLERS} registry
 *    (openMarket / primeDeal / provisionMeal / survey), or the camp resolver for a `morale`
 *    {@link "./skills".CampEffect} (Cook Stew).
 * 4. {@link commitOverworldCost} + use-XP ({@link grantAbilityUseXp}, D53).
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
    commitOverworldCost(run, skill.id, cost, check.fatigueSpend, unit);
    grantAbilityUseXp(unit);
    const goldSpent = resolveKnob(cost.gold, run);
    return { applied: true, detail: applied.detail, fatigueSpent: check.fatigueSpend, goldSpent: goldSpent > 0 ? goldSpent : undefined };
  }
  // The camp partition (Cook Stew's `morale`) — resolved by the camp interpreter.
  if (effect.kind === "morale") {
    const camp = applyCampSkill(skill, run.camp);
    commitOverworldCost(run, skill.id, cost, check.fatigueSpend, unit);
    const levels = grantAbilityUseXp(unit);
    const parts: string[] = [];
    if (camp.morale) parts.push(`+${camp.morale} morale`);
    if (camp.bankedHeal) parts.push(`banked +${camp.bankedHeal} HP/unit`);
    if (levels > 0) parts.push(`${unit.name} reached L${unit.level}!`);
    return { applied: true, outcome: { ...camp, levels }, detail: `${skill.name}: ${parts.join(", ")}.`, fatigueSpent: check.fatigueSpend };
  }
  // A non-overworld effect routed here by mistake (a battle/deploy kind) — refuse cleanly.
  return { applied: false, reason: `${skill.name} is not an overworld action.` };
}

/**
 * Back-compat alias for the camp-skill call sites (D72) — overworld camp skills now route
 * through the unified {@link useOverworldSkill}. (Cook Stew et al. take no `opts`.)
 */
export function useCampSkillAtNode(run: RunState, unit: Unit, skill: SkillDef): CampSkillResult {
  return useOverworldSkill(run, unit, skill);
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
} as const;

/**
 * Triage's two-axis cost (D61) — the **demanding** fatigue price the shared gate validates +
 * spends. Hoisted to a named export so the D61 guard test can assert it stays paced-or-priced:
 * Triage is a **standalone** verb, outside the `JobDef.skills` load-time validator.
 */
export const TRIAGE_COST: OverworldCost = { fatigue: TRIAGE.fatigue };

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
  /** Fatigue spent on the healer (base + any over-extension surcharge). */
  fatigueSpent?: number;
}

/**
 * **Triage** (the audit pass) — the **healer's** camp heal, distinct from the universal
 * Rest ({@link "./upkeep".restHeal}, RP/rations): a healing class spends **their own
 * fatigue** (worn out) to mend the party's **most-wounded** fighter for *more* than a
 * Rest — scaling with the Medic's Triage (heal harder the worse the wound). Job-gated to
 * a {@link isHealer} (only a healer can triage); the fatigue rides the shared
 * {@link checkOverworldCost} gate. Over-triaging is **not** locked (D73) — it accrues fatigue
 * toward the Exhausted consequences (pricier rest-heal, the combat Slow), the consequence-based
 * limiter. Pure fatigue — no RP. Refuses (spending nothing) without a healer or with no one wounded.
 */
export function triage(run: RunState, healer: Unit): TriageResult {
  if (!isHealer(healer)) {
    return { applied: false, reason: `${healer.name} can't triage — only a healer can.` };
  }
  // Triage treats the worst first: the most-wounded living, uncaptured ally.
  const wounded = run.party
    .filter((u) => u.alive && !u.captured && u.hp < u.maxHp)
    .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
  if (!wounded) return { applied: false, reason: "No wounded fighter to triage." };

  const cost = TRIAGE_COST;
  const check = checkOverworldCost(run, "triage", cost, "Triage", healer);
  if (!check.ok) return { applied: false, reason: check.reason };

  // Heal scales with the healer's Triage (read from the job def — camp units aren't
  // stamped) and the wound's depth: more missing HP → more healing.
  const triageVal = getJob(primaryJobOf(healer))?.passives?.[PASSIVE.triage] ?? 0;
  const amount = TRIAGE.base + Math.floor(triageVal * (wounded.maxHp - wounded.hp));
  const healed = healUnit(wounded, amount);
  commitOverworldCost(run, "triage", cost, check.fatigueSpend, healer);
  return {
    applied: true,
    healed,
    targetId: wounded.id,
    fatigueSpent: check.fatigueSpend,
    detail: `Triaged ${wounded.name}: +${healed} HP (${healer.name} worn out).`,
  };
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
    run.rp += effect.rp;
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
    const rng = streamFor(run.seed, `forage:${run.mapNodeId}:${run.night}:${idx}`);
    for (let i = 0; i < rolls; i++) {
      const pick = rng.pickWeighted(effect.table, (e) => e.weight);
      grantItem(run.inventory, pick.id);
      found.push(pick.id);
    }
    return { ok: true, detail: found.length ? `Foraged: ${found.join(", ")}.` : "Foraged, but found nothing." };
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
