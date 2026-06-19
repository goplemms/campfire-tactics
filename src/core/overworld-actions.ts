/**
 * The overworld action economy (D29/D35) — the machinery of the second hook
 * surface.
 *
 * The overworld is the **twin of the combat CT clock** ({@link "./clock"}, D5),
 * one tier up: a data-driven hook surface where classes *act between nodes*. An
 * **overworld ability** is **data** — an id, a display, an {@link OverworldEffect},
 * and a {@link OverworldCost} drawn from the short limiter menu (D29) — resolved by
 * one interpreter ({@link takeOverworldAction}), exactly as combat/camp skills are
 * data resolved by {@link "./skills"} (D3/D4 ethos). New abilities are new records,
 * not new branches.
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

import type { Unit } from "./units";
import type { RunState } from "./run";
import type { SkillDef } from "./skills";
import { spendFatigue, fatiguePenalty } from "./fatigue";
import { reachableFrom } from "./overworld";
import { useCampJobSkill, type Camp, type CampOutcome } from "./camp";
import { grantAbilityUseXp } from "./leveling";

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
  /** Run gold spent from the purse (`camp.gold`, D34/D30). */
  gold?: number;
  /** Influence spent — the Noble's walled-off currency (D62; run-scoped). */
  influence?: number;
  /** Rest Points spent. */
  rp?: number;
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

/** True if `cost` declares any **price** knob (fatigue / gold / influence / rp). */
export function hasPrice(cost: OverworldCost): boolean {
  return (cost.fatigue ?? 0) > 0 || (cost.gold ?? 0) > 0 || (cost.influence ?? 0) > 0 || (cost.rp ?? 0) > 0;
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

/** Raise a chosen reachable node's intel preview tier (leans on {@link "./intel"}). */
export interface ScoutEffect {
  kind: "scout";
  /** How many tiers to bump the target node's preview by. */
  tierBump: number;
}

/**
 * The declarative effect an overworld ability applies (interpreted by the resolver).
 * (The Merchant's old `market` effect — a gold/storage mint — was retired in D61;
 * the Merchant's access is now the node's {@link "./overworld".MarketTier} + the
 * {@link "./economy-actions".merchantBuy}/{@link "./economy-actions".merchantSell}
 * verbs, not a cooldown ability.)
 */
export type OverworldEffect = ScoutEffect;

/** An overworld ability — pure data (D29), the overworld twin of a {@link "./skills".SkillDef}. */
export interface OverworldAbility {
  id: string;
  name: string;
  description: string;
  effect: OverworldEffect;
  cost: OverworldCost;
  /**
   * Job ids that thematically perform this (render hint for picking an actor).
   * The resolver does **not** enforce it — the economy stays loose. Omitted = any.
   */
  jobIds?: string[];
}

// --- The registry (jobs.ts/skills.ts spirit) --------------------------------

/**
 * **Scout** — raise a reachable node's banded intel preview by a tier (D24). The
 * cheap, frequent action: a short cooldown and light fatigue, available to anyone.
 */
export const SCOUT: OverworldAbility = {
  id: "scout",
  name: "Scout",
  description: "Survey a node ahead — raise its intel preview by one tier.",
  effect: { kind: "scout", tierBump: 1 },
  cost: { cooldown: 2, fatigue: 1 },
};

/** The overworld-ability registry — the single source abilities load from. */
export const OVERWORLD_ABILITIES: Record<string, OverworldAbility> = {
  [SCOUT.id]: SCOUT,
};

// Enforce the two-axis invariant (D61) at load: no registered ability may be both
// unpaced and unpriced. A bad record fails fast at import, not silently in play.
for (const ability of Object.values(OVERWORLD_ABILITIES)) {
  validateOverworldCost(ability.name, ability.cost);
}

/** Look up an overworld ability by id. */
export function getAbility(id: string): OverworldAbility | undefined {
  return OVERWORLD_ABILITIES[id];
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
   * skill id — the limiter for costless signature actions (D35; Chef stew, Merchant
   * trade). Compared against {@link "./skills".SkillDef.usesPerNode} and **reset to
   * empty each node-step** ({@link tickCooldowns}), so the allowance is per-node, not
   * per-run.
   */
  campUses: Record<string, number>;
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

/** A fresh, fully-ready economy (every ability off cooldown, nothing scouted). */
export function createOverworldEconomy(): OverworldEconomy {
  return { cooldowns: {}, scouted: {}, campUses: {}, interestPerStep: 0, debt: 0, protection: 0, influence: 0 };
}

/** A deep copy of the economy (for snapshots / round-trips). */
export function cloneOverworldEconomy(eco: OverworldEconomy): OverworldEconomy {
  return {
    cooldowns: { ...eco.cooldowns },
    scouted: { ...eco.scouted },
    campUses: { ...eco.campUses },
    interestPerStep: eco.interestPerStep,
    debt: eco.debt,
    protection: eco.protection,
    influence: eco.influence,
  };
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
  for (const id of Object.keys(eco.cooldowns)) {
    const next = eco.cooldowns[id] - 1;
    if (next <= 0) delete eco.cooldowns[id];
    else eco.cooldowns[id] = next;
  }
  // Per-node allowance resets at the node boundary (D35) — a new camp, fresh uses.
  eco.campUses = {};
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
  camp.gold += eco.interestPerStep;
  return eco.interestPerStep;
}

// --- The resolver -----------------------------------------------------------

/** The outcome of attempting an overworld action — applied, or why refused. */
export interface ActionResult {
  /** True if the effect fired (cooldown armed, costs spent). */
  applied: boolean;
  /** When refused: a human-readable reason for the render. */
  reason?: string;
  /** When applied: a short summary of what happened. */
  detail?: string;
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
  // Price — the loose fatigue guardrail. Only *demanding* actions lock, and only once
  // the actor is over-extended; the cheap things always stay available.
  let fatigueSpend = 0;
  const baseFatigue = cost.fatigue ?? 0;
  if (baseFatigue > 0 && unit) {
    const penalty = fatiguePenalty(unit.fatigue);
    if (baseFatigue >= penalty.lockAtOrAbove) {
      return { ok: false, reason: `${unit.name} is too exhausted for ${label} — rest first.` };
    }
    fatigueSpend = baseFatigue + penalty.surcharge;
  }
  // Price — gold (the run purse).
  if ((cost.gold ?? 0) > 0 && run.camp.gold < cost.gold!) {
    return { ok: false, reason: `Not enough gold for ${label} (${cost.gold}g).` };
  }
  // Price — Influence (the Noble's per-expedition standing, D62).
  if ((cost.influence ?? 0) > 0 && eco.influence < cost.influence!) {
    return { ok: false, reason: `Not enough Influence for ${label} (${cost.influence}).` };
  }
  // Price — Rest Points.
  if ((cost.rp ?? 0) > 0 && run.rp < cost.rp!) {
    return { ok: false, reason: `Not enough Rest Points for ${label} (${cost.rp}).` };
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
  if ((cost.gold ?? 0) > 0) run.camp.gold -= cost.gold!;
  if ((cost.influence ?? 0) > 0) eco.influence -= cost.influence!;
  if ((cost.rp ?? 0) > 0) run.rp -= cost.rp!;
  if ((cost.cooldown ?? 0) > 0) eco.cooldowns[id] = cost.cooldown!;
  if (cost.usesPerNode !== undefined) eco.campUses[id] = campSkillUses(eco, id) + 1;
}

/**
 * Take an overworld action (D29/D35/D61): the single interpreter. Routes the ability's
 * two-axis {@link OverworldCost} through the shared {@link checkCost} gate (pacing +
 * price), applies the effect, then {@link commitCost | commits} the spend and arms the
 * pacing. Returns an {@link ActionResult} the render reads — never throws on a refusal.
 */
export function takeOverworldAction(
  run: RunState,
  unit: Unit,
  abilityId: string,
  opts: ActionOpts = {},
): ActionResult {
  const ability = getAbility(abilityId);
  if (!ability) return { applied: false, reason: `Unknown overworld ability "${abilityId}".` };

  const check = checkOverworldCost(run, abilityId, ability.cost, ability.name, unit);
  if (!check.ok) return { applied: false, reason: check.reason };

  // Apply the effect (may still refuse — e.g. an unreachable Scout target).
  const applied = applyEffect(run, ability, opts);
  if (!applied.ok) return { applied: false, reason: applied.reason };

  commitOverworldCost(run, abilityId, ability.cost, check.fatigueSpend, unit);

  // Use-leveling (D53): a successful overworld ability use bumps its user — the
  // non-combat growth path (Scout/Survey/etc.), paired with the deployed trickle.
  grantAbilityUseXp(unit);

  return {
    applied: true,
    detail: applied.detail,
    fatigueSpent: check.fatigueSpend,
    goldSpent: (ability.cost.gold ?? 0) > 0 ? ability.cost.gold : undefined,
  };
}

/** The outcome of a gated camp-skill use — the {@link CampOutcome} plus the gate verdict. */
export interface CampSkillResult extends ActionResult {
  /** When applied: what the camp skill changed + the levels its owner gained. */
  outcome?: CampOutcome & { levels: number };
}

/**
 * The {@link OverworldCost} a meta/camp {@link SkillDef} resolves through the gate
 * (D61): its per-node cap is the **pacing** knob. Costless signature actions (Cook
 * Stew) are limited entirely by `usesPerNode`; a priced camp job would add price knobs
 * here. (`usesPerNode` undefined ⇒ no cap, the legacy "pays its own way" escape.)
 */
function campSkillCost(skill: SkillDef): OverworldCost {
  return { usesPerNode: skill.usesPerNode };
}

/**
 * Use a **camp job skill** at the current node (D35/D61), routed through the same
 * {@link checkCost} gate as every overworld action — its `usesPerNode` is the pacing
 * knob ({@link OverworldEconomy.campUses}, reset each node-step). When the cap is
 * reached it **refuses** (never throws), so the render shows why; otherwise it applies
 * the effect (levelling the owner, D32/D53) and commits the use.
 */
export function useCampSkillAtNode(run: RunState, unit: Unit, skill: SkillDef): CampSkillResult {
  const cost = campSkillCost(skill);
  const check = checkOverworldCost(run, skill.id, cost, skill.name, unit);
  if (!check.ok) return { applied: false, reason: check.reason };

  const outcome = useCampJobSkill(unit, skill, run.camp);
  commitOverworldCost(run, skill.id, cost, check.fatigueSpend, unit);

  const parts: string[] = [];
  if (outcome.morale) parts.push(`+${outcome.morale} morale`);
  if (outcome.bankedHeal) parts.push(`banked +${outcome.bankedHeal} HP/unit`);
  if (outcome.levels > 0) parts.push(`${unit.name} reached L${unit.level}!`);
  return { applied: true, outcome, detail: `${skill.name}: ${parts.join(", ")}.` };
}

/** Apply an ability's effect; returns success + a detail string, or a refusal. */
function applyEffect(
  run: RunState,
  ability: OverworldAbility,
  opts: ActionOpts,
): { ok: true; detail: string } | { ok: false; reason: string } {
  const effect = ability.effect;
  switch (effect.kind) {
    case "scout": {
      const targetId = opts.targetNodeId;
      if (!targetId) return { ok: false, reason: "Scout needs a node to survey." };
      const reachable = reachableFrom(run.map, run.mapNodeId);
      if (!reachable.some((n) => n.id === targetId)) {
        return { ok: false, reason: "That node isn't reachable to scout." };
      }
      run.overworld.scouted[targetId] = scoutedTier(run.overworld, targetId) + effect.tierBump;
      return { ok: true, detail: `Scouted ${targetId} — preview raised ${effect.tierBump} tier.` };
    }
  }
}
