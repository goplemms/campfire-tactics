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
import { spendFatigue, fatiguePenalty } from "./fatigue";
import { reachableFrom } from "./overworld";
import { applyCampSkill, type Camp } from "./camp";
import { getJob } from "./jobs";
import { grantAbilityUseXp } from "./leveling";

/**
 * The per-ability **cost menu** an overworld ability declares (D29). `cooldown`
 * (node-steps) is the always-present spine; `fatigue`/`gold` are optional
 * per-ability costs layered on top.
 */
export interface OverworldCost {
  /** Node-steps before this ability can be used again — the spine (D35). */
  cooldown: number;
  /** Fatigue spent on the acting character — the loose guardrail (D35). */
  fatigue?: number;
  /** Run gold spent (D34/D30 — the single existing pool; the purse split is M10). */
  gold?: number;
}

/** Raise a chosen reachable node's intel preview tier (leans on {@link "./intel"}). */
export interface ScoutEffect {
  kind: "scout";
  /** How many tiers to bump the target node's preview by. */
  tierBump: number;
}
/**
 * The Merchant's **ACCESS** verb (D30) reframed as an overworld action: the
 * existing camp Merchant economy effect (gold + storage under the cap), surfaced
 * between nodes. Reuses {@link "./jobs".MERCHANT}'s Trade skill via
 * {@link "./camp".applyCampSkill} — no parallel economy.
 */
export interface MarketEffect {
  kind: "market";
}

/** The declarative effect an overworld ability applies (interpreted by the resolver). */
export type OverworldEffect = ScoutEffect | MarketEffect;

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

/**
 * **Market** — the Merchant's ACCESS verb (D30) on the overworld: trade for gold +
 * storage (the existing camp effect). The demanding action: a longer cooldown and
 * heavier fatigue (so it locks first when a Merchant over-extends).
 */
export const MARKET: OverworldAbility = {
  id: "market",
  name: "Market",
  description: "Hike to market — earn gold and expand storage (the Merchant's access).",
  effect: { kind: "market" },
  cost: { cooldown: 3, fatigue: 2 },
  jobIds: ["merchant"],
};

/** The overworld-ability registry — the single source abilities load from. */
export const OVERWORLD_ABILITIES: Record<string, OverworldAbility> = {
  [SCOUT.id]: SCOUT,
  [MARKET.id]: MARKET,
};

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
}

/** A fresh, fully-ready economy (every ability off cooldown, nothing scouted). */
export function createOverworldEconomy(): OverworldEconomy {
  return { cooldowns: {}, scouted: {}, interestPerStep: 0, debt: 0, protection: 0 };
}

/** A deep copy of the economy (for snapshots / round-trips). */
export function cloneOverworldEconomy(eco: OverworldEconomy): OverworldEconomy {
  return {
    cooldowns: { ...eco.cooldowns },
    scouted: { ...eco.scouted },
    interestPerStep: eco.interestPerStep,
    debt: eco.debt,
    protection: eco.protection,
  };
}

/** Node-steps remaining on an ability's cooldown (0 = ready). */
export function cooldownRemaining(eco: OverworldEconomy, abilityId: string): number {
  return eco.cooldowns[abilityId] ?? 0;
}

/** The extra intel tier bought for a node so far (the Scout bump). */
export function scoutedTier(eco: OverworldEconomy, nodeId: string): number {
  return eco.scouted[nodeId] ?? 0;
}

/**
 * Advance the overworld clock **one node-step**: decrement every cooldown by 1
 * (floored at 0). Called once per node played from {@link "./run".recordNight}, so
 * both combat and rest nodes tick the spine.
 */
export function tickCooldowns(eco: OverworldEconomy): void {
  for (const id of Object.keys(eco.cooldowns)) {
    const next = eco.cooldowns[id] - 1;
    if (next <= 0) delete eco.cooldowns[id];
    else eco.cooldowns[id] = next;
  }
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

/**
 * Take an overworld action (D29/D35): the single interpreter. Checks the ability
 * is **off cooldown** and the actor has **fatigue headroom** (the loose guardrail —
 * deeply-exhausted actors can't push *demanding* actions) and **gold** if priced;
 * applies the effect; spends fatigue (base + over-extension surcharge) and gold;
 * and **arms the cooldown**. Returns an {@link ActionResult} the render reads —
 * never throws on a refusal, so the UI can show why.
 */
export function takeOverworldAction(
  run: RunState,
  unit: Unit,
  abilityId: string,
  opts: ActionOpts = {},
): ActionResult {
  const ability = getAbility(abilityId);
  if (!ability) return { applied: false, reason: `Unknown overworld ability "${abilityId}".` };

  const eco = run.overworld;

  // Spine — cooldown gate.
  const cd = cooldownRemaining(eco, abilityId);
  if (cd > 0) {
    return { applied: false, reason: `${ability.name} is on cooldown (${cd} node${cd === 1 ? "" : "s"}).` };
  }

  // Guardrail — the loose fatigue gate. Only *demanding* actions lock, and only
  // once the actor is over-extended; the cheap things always stay available.
  const baseFatigue = ability.cost.fatigue ?? 0;
  const penalty = fatiguePenalty(unit.fatigue);
  if (baseFatigue >= penalty.lockAtOrAbove) {
    return { applied: false, reason: `${unit.name} is too exhausted for ${ability.name} — rest first.` };
  }
  const fatigueCost = baseFatigue > 0 ? baseFatigue + penalty.surcharge : 0;

  // Gold gate (single run pool; the purse split is M10).
  const goldCost = ability.cost.gold ?? 0;
  if (goldCost > 0 && run.camp.gold < goldCost) {
    return { applied: false, reason: `Not enough gold for ${ability.name} (${goldCost}g).` };
  }

  // Apply the effect.
  const applied = applyEffect(run, ability, opts);
  if (!applied.ok) return { applied: false, reason: applied.reason };

  // Spend the costs and arm the cooldown.
  if (fatigueCost > 0) unit.fatigue = spendFatigue(unit.fatigue, fatigueCost);
  if (goldCost > 0) run.camp.gold -= goldCost;
  if (ability.cost.cooldown > 0) eco.cooldowns[abilityId] = ability.cost.cooldown;

  // Use-leveling (D53): a successful overworld ability use bumps its user — the
  // non-combat growth path (Scout/Survey/etc.), paired with the deployed trickle.
  grantAbilityUseXp(unit);

  return {
    applied: true,
    detail: applied.detail,
    fatigueSpent: fatigueCost,
    goldSpent: goldCost > 0 ? goldCost : undefined,
  };
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
    case "market": {
      // Reuse the existing camp Merchant economy effect (D30 ACCESS) — no parallel
      // economy. The storage cap is the master logistics cap (D6), kept in sync.
      const trade = getJob("merchant")?.skills.find((s) => s.effect.kind === "economy");
      if (!trade) return { ok: false, reason: "No Merchant trade available." };
      const out = applyCampSkill(trade, run.camp);
      run.inventory.storageCap = run.camp.storageCap;
      return { ok: true, detail: `Market: +${out.gold ?? 0} gold, +${out.storage ?? 0} storage.` };
    }
  }
}
