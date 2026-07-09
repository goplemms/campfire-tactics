import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import { createRun, reachableNodes, breakCamp, type RunState } from "./run";
import {
  useOverworldSkill,
  applyOverworldEffect,
  DEAL_PRIMED_FLAG,
} from "./overworld-actions";
import {
  overworldCostOf,
  validateOverworldCost,
  hasPacing,
  hasPrice,
  resolveKnob,
  knobDeclared,
  checkOverworldCost,
  type OverworldCost,
} from "./overworld-cost";
import {
  campSkillUses,
  campSkillUsesLeft,
  tickCooldowns,
  cooldownRemaining,
  scoutedTier,
  createOverworldEconomy,
  setNodeFlag,
  hasNodeFlag,
  primeFlag,
  consumeFlag,
  isPrimed,
  cloneOverworldEconomy,
} from "./overworld-state";
import { triage, isHealer, TRIAGE, TRIAGE_COST, PATRONIZE_COST, BANKER_PROTECT_COST, MERCHANT_SELL_COST, BANKER_BORROW_COST, BANKER_INTEREST_COST, MERCHANT_BUY_COST, VERB_COSTS } from "./economy-actions";
import { getJob, JOBS, SURVEY, FORAGE, unitHasCapability, CAPABILITY_PREDICATES, type JobDef, type JobLookup } from "./jobs";
import { PASSIVE } from "./combat";
import { skillContexts } from "./skills";
import { availableSkills } from "./leveling";
import { computeUpkeep, payUpkeep, satisfyUpkeepLine } from "./upkeep";
import { effectiveMarketTier, marketOpenedFlag, type MapNode } from "./overworld";
import type { SkillDef, OverworldActionEffect } from "./skills";
import { previewNode } from "./intel";
import { countOf } from "./inventory";
import { FATIGUE, FATIGUE_TIER_FLOORS } from "./fatigue";

function roster(): Unit[] {
  return [
    // Rook is a Scout so it carries the Survey skill (D72: Survey lives on the Scout job).
    createUnit({ id: "Rook", side: "player", pos: { col: 0, row: 1 }, jobId: "scout", speed: 12, maxHp: 30, attack: 9, defense: 3, moveRange: 4, sightRadius: 5, awareness: 4, intelligence: 1 }),
    createUnit({ id: "Coin", side: "player", pos: { col: -1, row: -1 }, jobId: "merchant", speed: 8, maxHp: 16, attack: 2, defense: 1, moveRange: 3, sightRadius: 4 }),
  ];
}

function newRun(seed: string): RunState {
  return createRun(seed, { party: roster(), difficultyId: "normal", gold: 200, storageCap: 6 });
}

/** The acting party member — party[0] is the Scout, so it may perform Survey (the fatigue/cap mechanics don't care which job). */
function actor(run: RunState): Unit {
  return run.party[0];
}

/**
 * A costless, per-node-capped morale camp skill (the old Cook Stew shape) — a **fixture** for the
 * per-node-cap machinery tests, decoupled from the real Cook kit (whose Cook Stew is now a
 * computed-cost `provisionMeal`, D71). The cap/reset machinery is what these tests exercise.
 */
function cookSkill(): SkillDef {
  return { id: "fx-stew", name: "Fixture Stew", description: "", phase: "meta", target: "party", range: 0, spend: "act", usesPerNode: 1, effect: { kind: "morale", morale: 1, partyHeal: 8 } };
}

describe("overworld-actions — Survey is the Scout's overworld skill (D74)", () => {
  it("Survey lives on the Scout job and surfaces (at L2) through availableSkills (no hardcoded id)", () => {
    expect(getJob("scout")!.skills).toContain(SURVEY);
    expect(SURVEY.overworldCost!.cooldown).toBeGreaterThan(0); // the cooldown spine is present
    expect(SURVEY.effect.kind).toBe("survey"); // scouts a node's intel
    // Survey is the Scout's **L2** overworld growth (D74), so level the scout before checking.
    const scout = roster()[0];
    scout.jobLevels = { scout: { level: 2, xp: 0 } };
    // The render reads the one projection — a leveled Scout surfaces Survey, a Merchant doesn't.
    expect(availableSkills(scout, "overworld").map((s) => s.id)).toContain("survey");
    expect(availableSkills(roster()[1], "overworld").map((s) => s.id)).not.toContain("survey");
  });
});

describe("overworld-actions — the cooldown spine (D35)", () => {
  it("applying arms the cooldown and spends fatigue", () => {
    const run = newRun("cd-arm");
    const actor = run.party[0];
    const target = reachableNodes(run)[0];
    const res = useOverworldSkill(run, actor, SURVEY, { targetNodeId: target.id });

    expect(res.applied).toBe(true);
    expect(res.fatigueSpent).toBe(SURVEY.overworldCost!.fatigue);
    expect(actor.fatigue).toBe(SURVEY.overworldCost!.fatigue);
    expect(cooldownRemaining(run.overworld, "survey")).toBe(SURVEY.overworldCost!.cooldown);
  });

  it("refuses while on cooldown, with a reason", () => {
    const run = newRun("cd-refuse");
    const actor = run.party[0];
    const target = reachableNodes(run)[0];
    useOverworldSkill(run, actor, SURVEY, { targetNodeId: target.id });
    const again = useOverworldSkill(run, actor, SURVEY, { targetNodeId: target.id });

    expect(again.applied).toBe(false);
    expect(again.reason).toMatch(/cooldown/i);
  });

  it("cooldowns tick per node-step; reaching 0 re-enables", () => {
    const eco = createOverworldEconomy();
    eco.cooldowns["survey"] = 2;
    tickCooldowns(eco);
    expect(cooldownRemaining(eco, "survey")).toBe(1);
    tickCooldowns(eco);
    expect(cooldownRemaining(eco, "survey")).toBe(0);
    // Idle ticks never go negative.
    tickCooldowns(eco);
    expect(cooldownRemaining(eco, "survey")).toBe(0);
  });

  it("departing a node (breakCamp) ticks the spine — the node-step fires at departure (D46)", () => {
    const run = newRun("cd-node-tick");
    const actor = run.party[0];
    const target = reachableNodes(run)[0];
    useOverworldSkill(run, actor, SURVEY, { targetNodeId: target.id });
    expect(cooldownRemaining(run.overworld, "survey")).toBe(SURVEY.overworldCost!.cooldown!);

    // Break Camp is the node-step that ticks cooldowns — at departure, not the event.
    for (let i = 0; i < SURVEY.overworldCost!.cooldown!; i++) {
      breakCamp(run);
    }
    expect(cooldownRemaining(run.overworld, "survey")).toBe(0);
  });
});

describe("overworld-actions — the loose fatigue guardrail (D35)", () => {
  it("never refuses an action for fatigue, even when the actor is exhausted (D73)", () => {
    const run = newRun("fatigue-lock");
    const a = actor(run);
    a.fatigue = FATIGUE.exhausted; // deeply over-extended

    // D73 dropped the demanding-action lock — fatigue never gates a cast; the bite is the
    // deferred consequence (pricier rest-heal, carryover, the Exhausted combat Slow).
    const target = reachableNodes(run)[0];
    const scout = useOverworldSkill(run, a, SURVEY, { targetNodeId: target.id });
    expect(scout.applied).toBe(true);
  });

  it("an over-extended actor pays only the base fatigue — no surcharge (D73)", () => {
    const run = newRun("fatigue-surcharge");
    const actor = run.party[0];
    actor.fatigue = FATIGUE_TIER_FLOORS[2]; // Weary (past the safe bands)
    const target = reachableNodes(run)[0];
    const before = actor.fatigue;
    const res = useOverworldSkill(run, actor, SURVEY, { targetNodeId: target.id });

    expect(res.applied).toBe(true);
    expect(res.fatigueSpent!).toBe(SURVEY.overworldCost!.fatigue!); // base only — no over-extension surcharge
    expect(actor.fatigue).toBe(before + SURVEY.overworldCost!.fatigue!);
  });
});

describe("overworld-actions — Survey raises a reachable node's preview tier", () => {
  it("scouting a reachable node bumps its banded intel preview", () => {
    const run = newRun("scout-tier");
    const actor = run.party[0];
    const target = reachableNodes(run).find((n) => n.kind === "combat")!;

    const before = previewNode(run, target.id, scoutedTier(run.overworld, target.id));
    const res = useOverworldSkill(run, actor, SURVEY, { targetNodeId: target.id });
    expect(res.applied).toBe(true);
    expect(scoutedTier(run.overworld, target.id)).toBe((SURVEY.effect as { tierBump: number }).tierBump);

    const after = previewNode(run, target.id, scoutedTier(run.overworld, target.id));
    expect(after.intel!.tier).toBeGreaterThan(before.intel!.tier);
  });

  it("refuses to scout an unreachable node", () => {
    const run = newRun("scout-unreach");
    const actor = run.party[0];
    const res = useOverworldSkill(run, actor, SURVEY, { targetNodeId: run.map.finalIds[0] });
    expect(res.applied).toBe(false);
    expect(res.reason).toMatch(/reachable/i);
  });

  it("refuses with no target node", () => {
    const run = newRun("scout-notarget");
    const res = useOverworldSkill(run, run.party[0], SURVEY);
    expect(res.applied).toBe(false);
  });
});

describe("overworld-actions — Triage is the healer's fatigue-fuelled camp heal (audit)", () => {
  /** A Medic — the healing class (its job def carries the Triage passive). */
  function medic(): Unit {
    return createUnit({ id: "Mreni", side: "player", pos: { col: -1, row: -1 }, jobId: "medic", speed: 9, maxHp: 20, attack: 4, defense: 2, moveRange: 3, sightRadius: 4 });
  }

  it("isHealer recognises the Medic (Triage passive) and not a plain fighter", () => {
    expect(isHealer(medic())).toBe(true);
    expect(isHealer(run0Party())).toBe(false); // a Scout — no Triage passive
  });
  function run0Party(): Unit {
    return createUnit({ id: "grunt", side: "player", pos: { col: -1, row: -1 }, jobId: "soldier", speed: 10, maxHp: 20, attack: 6, defense: 2, moveRange: 4, sightRadius: 4 });
  }

  it("a healer spends FATIGUE (not RP) to mend the most-wounded for more than the flat base", () => {
    const run = newRun("triage-heal");
    const doc = medic();
    run.party.push(doc);
    const hurt = run.party[0]; // the Scout
    hurt.hp = 1; // deeply wounded → the Triage-scaling on missing HP kicks in
    const rpBefore = run.rp;

    const res = triage(run, doc);
    expect(res.applied).toBe(true);
    expect(res.targetId).toBe(hurt.id);
    expect(res.healed!).toBeGreaterThan(TRIAGE.base); // base + triage×missing
    expect(hurt.hp).toBeGreaterThan(1);
    // Pure fatigue: the healer is worn out, the RP pool is untouched.
    expect(doc.fatigue).toBeGreaterThanOrEqual(TRIAGE.fatigue);
    expect(res.fatigueSpent!).toBeGreaterThanOrEqual(TRIAGE.fatigue);
    expect(run.rp).toBe(rpBefore);
  });

  it("refuses (spending nothing) without a healer in the party", () => {
    const run = newRun("triage-nohealer");
    run.party[0].hp = 1; // wounded, but no Medic to treat them
    const res = triage(run, run.party[0]); // a Scout can't triage
    expect(res.applied).toBe(false);
    expect(res.reason).toMatch(/only a healer/i);
    expect(run.party[0].hp).toBe(1);
  });

  it("refuses when no one is wounded (no empty drain)", () => {
    const run = newRun("triage-fullhp");
    const doc = medic();
    run.party.push(doc);
    const res = triage(run, doc);
    expect(res.applied).toBe(false);
    expect(res.reason).toMatch(/no wounded/i);
    expect(doc.fatigue).toBe(0); // nothing spent
  });

  it("an exhausted healer can still Triage (no lock, D73) — the consequence is the limiter", () => {
    const run = newRun("triage-exhausted");
    const doc = medic();
    doc.fatigue = FATIGUE.exhausted; // deeply over-extended — but D73 has no hard lock
    run.party.push(doc);
    run.party[0].hp = 1;
    const res = triage(run, doc);
    expect(res.applied).toBe(true); // applies — the mounting consequence (pricier heal, the Slow) limits it, not a lock
    expect(run.party[0].hp).toBeGreaterThan(1);
    expect(res.fatigueSpent).toBe(TRIAGE.fatigue); // base only (no surcharge)
    expect(doc.fatigue).toBeGreaterThanOrEqual(FATIGUE.exhausted); // stays Exhausted → fields Slowed next fight
  });
});

describe("overworld-actions — the per-node camp-skill cap (D35)", () => {
  it("declares the cap on the skill (Cook Stew is once per node)", () => {
    expect(cookSkill().usesPerNode).toBe(1);
  });

  it("a costless camp skill applies up to its cap, then refuses (no more unlimited use)", () => {
    const run = newRun("camp-cap");
    const a = actor(run);
    const cook = cookSkill();
    const moraleBefore = run.camp.morale;

    expect(campSkillUsesLeft(run.overworld, cook)).toBe(1);
    const first = useOverworldSkill(run, a, cook);
    expect(first.applied).toBe(true);
    expect(run.camp.morale).toBe(moraleBefore + 1);
    expect(campSkillUses(run.overworld, cook.id)).toBe(1);

    // The second use this node is refused — the buff is spent, not doubled.
    const second = useOverworldSkill(run, a, cook);
    expect(second.applied).toBe(false);
    expect(second.reason).toMatch(/spent for tonight/i);
    expect(run.camp.morale).toBe(moraleBefore + 1);
  });

  it("the cap resets on the node-step (Break Camp), so each node grants a fresh use", () => {
    const run = newRun("camp-reset");
    const a = actor(run);
    const cook = cookSkill();

    expect(useOverworldSkill(run, a, cook).applied).toBe(true);
    expect(useOverworldSkill(run, a, cook).applied).toBe(false); // spent

    breakCamp(run); // the node-step tick clears the per-node allowance
    expect(campSkillUses(run.overworld, cook.id)).toBe(0);
    expect(useOverworldSkill(run, a, cook).applied).toBe(true); // fresh node, fresh use
  });

  it("an uncapped camp skill (no usesPerNode) is gated by its own cost, not the node-cap", () => {
    const run = newRun("camp-uncapped");
    const a = actor(run);
    // A hypothetical resource-paid action: no per-node cap → fires repeatedly.
    const uncapped: SkillDef = { ...cookSkill(), id: "cook-uncapped", usesPerNode: undefined };
    expect(campSkillUsesLeft(run.overworld, uncapped)).toBe(Infinity);
    expect(useOverworldSkill(run, a, uncapped).applied).toBe(true);
    expect(useOverworldSkill(run, a, uncapped).applied).toBe(true);
  });
});

describe("the two-axis limiter invariant (D61)", () => {
  it("rejects a free-and-unlimited cost (no pacing, no price, not self-limited)", () => {
    expect(() => validateOverworldCost("Exploit", {})).toThrow(/free and unlimited/);
  });

  it("accepts a cost paced by either axis", () => {
    expect(() => validateOverworldCost("Cooldowned", { cooldown: 2 })).not.toThrow();
    expect(() => validateOverworldCost("Capped", { usesPerNode: 1 })).not.toThrow();
  });

  it("accepts a cost priced by any knob", () => {
    expect(() => validateOverworldCost("Fatiguing", { fatigue: 1 })).not.toThrow();
    expect(() => validateOverworldCost("Gilded", { gold: 10 })).not.toThrow();
    expect(() => validateOverworldCost("Political", { influence: 2 })).not.toThrow();
    expect(() => validateOverworldCost("Restful", { rp: 1 })).not.toThrow();
  });

  it("accepts an unpaced, unpriced action only when it is selfLimited (e.g. Merchant sell)", () => {
    expect(() => validateOverworldCost("Sell", { selfLimited: true })).not.toThrow();
  });

  it("classifies pacing vs price knobs", () => {
    expect(hasPacing({ cooldown: 2 })).toBe(true);
    expect(hasPacing({ usesPerNode: 0 })).toBe(true); // a 0-cap is still a (zero) pacing declaration
    expect(hasPacing({ gold: 5 })).toBe(false);
    expect(hasPrice({ gold: 5 })).toBe(true);
    expect(hasPrice({ cooldown: 2 })).toBe(false);
  });

  it("every overworld/camp skill in the live registry satisfies the invariant (D72)", () => {
    // The home is now JobDef.skills (A2): Survey, Cook Stew, and any future verb. The
    // load-time guard in overworld-actions runs this same check at import.
    for (const job of Object.values(JOBS)) {
      for (const skill of job.skills) {
        if (skillContexts(skill).includes("overworld")) {
          expect(() => validateOverworldCost(skill.name, overworldCostOf(skill))).not.toThrow();
        }
      }
    }
  });
});

describe("the standalone-verb cost registry — the D61 invariant is total (#112 step 1)", () => {
  // The load-time validator in overworld-actions walks JOBS[*].skills; economy-actions'
  // walks VERB_COSTS. Together the two homes make an ungated verb fail at import. This
  // guard makes the registry itself total: every exported function of the two verb
  // modules must be classified below — a NEW export that is none of these fails BY NAME
  // until it is classified, and classifying it as a verb requires a VERB_COSTS row.

  it("every VERB_COSTS entry is paced or priced (the load-time walk's assertion)", () => {
    expect(Object.keys(VERB_COSTS).length).toBeGreaterThan(0);
    for (const [id, cost] of Object.entries(VERB_COSTS)) {
      expect(() => validateOverworldCost(id, cost)).not.toThrow();
    }
  });

  it("the hoisted per-verb consts ARE the registry entries (one source of truth)", () => {
    expect(VERB_COSTS["triage"]).toBe(TRIAGE_COST);
    expect(VERB_COSTS["patronize"]).toBe(PATRONIZE_COST);
    expect(VERB_COSTS["banker-protect"]).toBe(BANKER_PROTECT_COST);
    expect(VERB_COSTS["merchant-sell"]).toBe(MERCHANT_SELL_COST);
    expect(VERB_COSTS["banker-borrow"]).toBe(BANKER_BORROW_COST);
    expect(VERB_COSTS["banker-interest"]).toBe(BANKER_INTEREST_COST);
    expect(VERB_COSTS["merchant-buy"]).toBe(MERCHANT_BUY_COST);
  });

  // Verb resolvers: exported function → its VERB_COSTS row. A new verb registers here
  // AND in VERB_COSTS (the registry walk at module load validates its cost).
  const VERB_RESOLVERS: Record<string, string> = {
    merchantBuy: "merchant-buy",
    merchantSell: "merchant-sell",
    bankerEngageInterest: "banker-interest",
    bankerBorrow: "banker-borrow",
    bankerProtect: "banker-protect",
    patronize: "patronize",
    triage: "triage",
  };

  // Verbs whose cost gate lives elsewhere — each with the WHERE, never silently exempt.
  const GATED_ELSEWHERE: Record<string, string> = {
    useOverworldSkill: "its SkillDef's overworldCost — the JOBS[*].skills load-time walk",
    bribeEnemy: "spends Influence off-gate via spendInfluence — the noted D112-step-2 (R4) migration target onto the gate's influence knob",
  };

  // Non-verb exports: pure reads, predicates, state plumbing, and the passive faucets
  // breakCamp fires (not player verbs). A new helper joins this list explicitly.
  const NON_VERBS = new Set([
    // economy-actions — pure reads / predicates
    "merchantPrice", "sellPrice", "bribeCost", "bribeChance",
    "hasBanker", "hasNoble", "hasThief", "declaredFaucetInfluence",
    // economy-actions — passive per-node-step faucets (fired by breakCamp, not chosen)
    "accrueDeclaredFaucets", "deftHandsSkim",
    // overworld-actions — the gate + cost grammar itself
    "checkOverworldCost", "validateOverworldCost", "resolveKnob", "knobDeclared",
    "hasPacing", "hasPrice", "overworldCostOf",
    // overworld-actions — economy sub-state plumbing + reads
    "createOverworldEconomy", "cloneOverworldEconomy", "tickCooldowns", "accruePurseInterest",
    "cooldownRemaining", "campSkillUses", "campSkillUsesLeft", "scoutedTier",
    "setNodeFlag", "hasNodeFlag", "primeFlag", "consumeFlag", "isPrimed",
    // overworld-actions — effect interpreter + predicates
    "applyOverworldEffect", "isOverworldActionEffect", "isHealer",
  ]);

  it("every exported verb resolver has a registered cost — a new ungated verb fails by name", async () => {
    const economyModule = await import("./economy-actions");
    const overworldModule = await import("./overworld-actions");
    const exportedFns = (mod: Record<string, unknown>) =>
      Object.keys(mod).filter((k) => typeof mod[k] === "function");
    const names = [...exportedFns(economyModule), ...exportedFns(overworldModule)];
    expect(names).toContain("merchantSell"); // sanity: the enumeration sees the verbs
    for (const name of names) {
      const classified = name in VERB_RESOLVERS || name in GATED_ELSEWHERE || NON_VERBS.has(name);
      expect(
        classified,
        `unclassified export "${name}" — a verb resolver must register a VERB_COSTS row (D61/#112); ` +
          `a verb gated elsewhere joins GATED_ELSEWHERE with the where; a helper joins NON_VERBS`,
      ).toBe(true);
    }
    // And every claimed resolver actually resolves to a registered cost.
    for (const [name, id] of Object.entries(VERB_RESOLVERS)) {
      expect(VERB_COSTS[id], `verb "${name}" maps to unregistered cost id "${id}"`).toBeDefined();
    }
  });
});

describe("computed (provider) costs (D72)", () => {
  it("resolveKnob: a static number passes through; a provider is sanitized to a non-negative int", () => {
    const run = newRun("knob-resolve");
    expect(resolveKnob(7, run)).toBe(7);
    expect(resolveKnob(undefined, run)).toBe(0);
    expect(resolveKnob((r) => r.party.length * 2, run)).toBe(run.party.length * 2);
    expect(resolveKnob(() => -3, run)).toBe(0); // never a negative price
    expect(resolveKnob(() => 4.9, run)).toBe(4); // floored
  });

  it("a provider knob still satisfies the two-axis invariant (it counts as priced)", () => {
    expect(knobDeclared(() => 0)).toBe(true); // a provider always counts — its value isn't known at load
    expect(knobDeclared(0)).toBe(false);
    expect(hasPrice({ gold: () => 10 })).toBe(true);
    expect(() => validateOverworldCost("Computed", { gold: (r) => r.party.length })).not.toThrow();
  });

  it("the gate resolves a provider at check time — refuses when the purse can't cover the computed value", () => {
    const run = newRun("knob-refuse");
    const cost: OverworldCost = { cooldown: 1, gold: () => 999_999 };
    const check = checkOverworldCost(run, "pricey", cost, "Pricey");
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toMatch(/Not enough gold for Pricey \(999999g\)/);
  });

  it("priced at 'the night's Food value' — commit spends exactly the computed amount (the Cook Stew shape)", () => {
    const run = newRun("knob-food");
    const foodValue = computeUpkeep(run.party).total;
    expect(foodValue).toBeGreaterThan(0);
    const cost: OverworldCost = { usesPerNode: 1, gold: (r) => computeUpkeep(r.party).total };

    const before = run.camp.gold;
    const check = checkOverworldCost(run, "stew-fixture", cost, "Cook Stew");
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.prices.gold).toBe(foodValue); // the check captured the resolved price (#126)
      check.commit();
    }
    expect(run.camp.gold).toBe(before - foodValue); // the dynamic price was billed, not a static guess
  });
});

describe("per-node / one-shot ability-flag bag (D72)", () => {
  /** A barren (`none` market) node with no merchant in the party — so only the flag can lift it. */
  function barrenNode(): MapNode {
    return { id: "nFlag", layer: 1, index: 0, kind: "combat", market: "none", edges: [] };
  }

  it("a per-node flag is set + read, and cleared on the node-step (the Find-Trade shape)", () => {
    const eco = createOverworldEconomy();
    expect(hasNodeFlag(eco, "market-opened")).toBe(false);
    setNodeFlag(eco, "market-opened");
    expect(hasNodeFlag(eco, "market-opened")).toBe(true);
    // The node boundary clears it — the mark never leaks to the next node.
    tickCooldowns(eco);
    expect(hasNodeFlag(eco, "market-opened")).toBe(false);
  });

  it("a one-shot primed flag is consumed on read and persists across node-steps until then (the Savvy-Barter shape)", () => {
    const eco = createOverworldEconomy();
    expect(consumeFlag(eco, "deal")).toBe(false); // nothing primed
    primeFlag(eco, "deal");
    expect(isPrimed(eco, "deal")).toBe(true); // a non-consuming peek
    tickCooldowns(eco); // a node-step passes — a primed treat you haven't cashed waits
    expect(isPrimed(eco, "deal")).toBe(true);
    expect(consumeFlag(eco, "deal")).toBe(true); // cashed once...
    expect(consumeFlag(eco, "deal")).toBe(false); // ...and only once
    expect(isPrimed(eco, "deal")).toBe(false);
  });

  it("effectiveMarketTier folds the per-node flag — a barren node trades at `poor` for the node-step", () => {
    const node = barrenNode();
    const eco = createOverworldEconomy();
    expect(effectiveMarketTier(node, [], eco)).toBe("none"); // no merchant, no flag → barren
    setNodeFlag(eco, marketOpenedFlag(node.id));
    expect(effectiveMarketTier(node, [], eco)).toBe("poor"); // the impromptu market opened here
    tickCooldowns(eco);
    expect(effectiveMarketTier(node, [], eco)).toBe("none"); // closes again on departure
  });

  it("the flag is node-keyed — opening a market here doesn't lift a different node", () => {
    const here = barrenNode();
    const elsewhere: MapNode = { ...here, id: "nOther" };
    const eco = createOverworldEconomy();
    setNodeFlag(eco, marketOpenedFlag(here.id));
    expect(effectiveMarketTier(here, [], eco)).toBe("poor");
    expect(effectiveMarketTier(elsewhere, [], eco)).toBe("none");
  });

  it("clone round-trips both flag bags (snapshot safety)", () => {
    const eco = createOverworldEconomy();
    setNodeFlag(eco, "n");
    primeFlag(eco, "p");
    const copy = cloneOverworldEconomy(eco);
    expect(hasNodeFlag(copy, "n")).toBe(true);
    expect(isPrimed(copy, "p")).toBe(true);
    // A deep copy — mutating the clone doesn't touch the original.
    setNodeFlag(copy, "n2");
    expect(hasNodeFlag(eco, "n2")).toBe(false);
  });
});

describe("capability-gate taxonomy (D72)", () => {
  const mk = (id: string, jobId: string) =>
    createUnit({ id, side: "player", pos: { col: -1, row: -1 }, jobId: jobId as never, speed: 9, maxHp: 20, attack: 4, defense: 2, moveRange: 3, sightRadius: 4 });

  it("a unit holds a capability by carrying its passive/flag, not a hard-coded job id", () => {
    expect(unitHasCapability(mk("doc", "medic"), "healer")).toBe(true); // Triage passive
    expect(unitHasCapability(mk("rook", "scout"), "healer")).toBe(false);
    expect(unitHasCapability(mk("sly", "thief"), "lockpick")).toBe(true); // Expert Lockpick flag
    expect(unitHasCapability(mk("rook", "scout"), "lockpick")).toBe(false);
    expect(unitHasCapability(mk("doc", "medic"), "lockpick")).toBe(false);
  });

  it("isHealer is the named alias of the `healer` capability (parity, no drift)", () => {
    for (const job of ["medic", "scout", "thief", "soldier"]) {
      const u = mk("u", job);
      expect(isHealer(u)).toBe(unitHasCapability(u, "healer"));
    }
  });

  it("the predicate registry is exhaustive (one predicate per capability id)", () => {
    expect(Object.keys(CAPABILITY_PREDICATES).sort()).toEqual(["healer", "lockpick"]);
  });

  it("respects an injected lookup — a throwaway capability-bearing job, never in JOBS (fixture-safe)", () => {
    const scout = mk("rook", "scout");
    const fixtureHealer: JobDef = { id: "scout", name: "Fixture Healer", description: "", skills: [], passives: { [PASSIVE.triage]: 0.5 } };
    const lookup: JobLookup = (id) => (id === "scout" ? fixtureHealer : getJob(id));
    expect(unitHasCapability(scout, "healer")).toBe(false); // the real Scout job has no Triage
    expect(unitHasCapability(scout, "healer", lookup)).toBe(true); // the fixture lookup injects it — no registry pollution
  });

  it("a SkillDef.requires expresses the gate as data, layered on the class home", () => {
    // The gate predicate the interpreter (inc 5) and the projection apply.
    const passes = (u: Unit, skill: SkillDef) => !skill.requires || unitHasCapability(u, skill.requires);
    const gated: SkillDef = { id: "fx-triage", name: "Field Triage", description: "", phase: "meta", target: "party", range: 0, spend: "act", requires: "healer", effect: { kind: "morale", morale: 0, partyHeal: 0 } };
    expect(passes(mk("doc", "medic"), gated)).toBe(true);
    expect(passes(mk("rook", "scout"), gated)).toBe(false);
    // An ungated action (no `requires`) is open to its class home.
    const open: SkillDef = { ...gated, requires: undefined };
    expect(passes(mk("rook", "scout"), open)).toBe(true);
  });
});

describe("the overworld-effect registry (D72)", () => {
  it("openMarket sets the per-node 'market opened here' flag (the Find-Trade mechanism)", () => {
    const run = newRun("fx-openmkt");
    expect(hasNodeFlag(run.overworld, marketOpenedFlag(run.mapNodeId))).toBe(false);
    const res = applyOverworldEffect({ kind: "openMarket" }, { run, unit: actor(run), opts: {} });
    expect(res.ok).toBe(true);
    expect(hasNodeFlag(run.overworld, marketOpenedFlag(run.mapNodeId))).toBe(true);
  });

  it("primeDeal primes the one-shot deal flag, consumed by the next trade (the Savvy-Barter mechanism)", () => {
    const run = newRun("fx-prime");
    applyOverworldEffect({ kind: "primeDeal" }, { run, unit: actor(run), opts: {} });
    expect(isPrimed(run.overworld, DEAL_PRIMED_FLAG)).toBe(true);
    expect(consumeFlag(run.overworld, DEAL_PRIMED_FLAG)).toBe(true); // the follow-up trade cashes it...
    expect(consumeFlag(run.overworld, DEAL_PRIMED_FLAG)).toBe(false); // ...exactly once
  });

  it("provisionMeal banks RP and satisfies the Food line (the Cook-Stew mechanism)", () => {
    const run = newRun("fx-meal");
    const before = run.rp;
    const res = applyOverworldEffect({ kind: "provisionMeal", rp: 3 }, { run, unit: actor(run), opts: {} });
    expect(res.ok).toBe(true);
    expect(run.rp).toBe(before + 3); // RP banked into the run pool
    expect(run.camp.satisfiedUpkeep).toContain("food"); // Food prepaid for the night
  });

  it("the Upkeep coupling: a satisfied Food line is not billed and applies no consequence (no double-charge)", () => {
    const run = newRun("fx-coupling");
    const bill = computeUpkeep(run.party);
    const foodCost = bill.lines.find((l) => l.id === "food")!.cost;
    expect(foodCost).toBeGreaterThan(0);

    // Cook the meal: it pays its own (dynamic) cost elsewhere and marks Food satisfied.
    applyOverworldEffect({ kind: "provisionMeal", rp: 2 }, { run, unit: actor(run), opts: {} });

    const goldBefore = run.camp.gold;
    const moraleBefore = run.camp.morale;
    const result = payUpkeep(run.camp, run.party, { skip: [] });

    expect(result.paid).toBe(bill.total - foodCost); // Repairs billed, Food was already covered
    expect(run.camp.gold).toBe(goldBefore - (bill.total - foodCost)); // Food not double-charged
    expect(result.underfunded).not.toContain("food");
    expect(result.skipped).not.toContain("food");
    expect(run.camp.morale).toBe(moraleBefore); // no hunger morale hit — Food was provisioned, not breached
    expect(run.camp.satisfiedUpkeep).toEqual([]); // a single-night provision, consumed by billing
  });

  it("satisfyUpkeepLine is idempotent and only the satisfied line is spared", () => {
    const run = newRun("fx-idem");
    satisfyUpkeepLine(run.camp, "food");
    satisfyUpkeepLine(run.camp, "food"); // idempotent
    expect(run.camp.satisfiedUpkeep).toEqual(["food"]);
    const result = payUpkeep(run.camp, run.party, { skip: [] });
    expect(result.paid).toBe(computeUpkeep(run.party).lines.find((l) => l.id === "repairs")!.cost);
  });

  it("the new effect kinds surface on the overworld beat (skillContexts)", () => {
    const base = { name: "Fx", description: "", phase: "meta", target: "party", range: 0, spend: "act" } as const;
    expect(skillContexts({ id: "a", ...base, effect: { kind: "openMarket" } })).toEqual(["overworld"]);
    expect(skillContexts({ id: "b", ...base, effect: { kind: "primeDeal" } })).toEqual(["overworld"]);
    expect(skillContexts({ id: "c", ...base, effect: { kind: "provisionMeal", rp: 1 } })).toEqual(["overworld"]);
    expect(skillContexts({ id: "d", ...base, effect: { kind: "forage", guaranteed: ["wild-herbs"], table: [{ id: "wild-herbs", weight: 1 }], baseRolls: 1, rollsPerLevel: 0 } })).toEqual(["overworld"]);
  });
});

describe("Forage — the Survivalist's clearing verb (D73)", () => {
  const countAll = (inv: { counts: Record<string, number> }) =>
    Object.values(inv.counts).reduce((a, b) => a + b, 0);
  function survivalist(): Unit {
    return createUnit({ id: "Bram", side: "player", pos: { col: -1, row: -1 }, jobId: "survivalist", speed: 10, maxHp: 24, attack: 11, defense: 2, moveRange: 4, sightRadius: 5 });
  }
  const forageEffect = FORAGE.effect as OverworldActionEffect; // FORAGE.effect is the broad SkillEffect; narrow for applyOverworldEffect

  it("Forage lives on the Survivalist and surfaces on the overworld beat (class-gated)", () => {
    expect(getJob("survivalist")!.skills).toContain(FORAGE);
    expect(skillContexts(FORAGE)).toEqual(["overworld"]);
    expect(availableSkills(survivalist(), "overworld").map((s) => s.id)).toContain("forage");
    expect(availableSkills(roster()[0], "overworld").map((s) => s.id)).not.toContain("forage"); // a Scout doesn't forage
    // the two-budget cost: paced within a clearing × priced in fatigue across clearings
    expect(FORAGE.overworldCost!.usesPerNode).toBeGreaterThan(0);
    expect(FORAGE.overworldCost!.fatigue).toBeGreaterThan(0);
  });

  it("always yields the guaranteed floor + job-level-scaled rolls", () => {
    const run = newRun("forage-yield");
    const before = countAll(run.inventory);
    const res = applyOverworldEffect(forageEffect,{ run, unit: survivalist(), opts: {} });
    expect(res.ok).toBe(true);
    expect(countOf(run.inventory, "wild-herbs")).toBeGreaterThan(0); // the guaranteed floor
    expect(countAll(run.inventory)).toBeGreaterThan(before); // net items gained
  });

  it("is deterministic — same seed + node + night replays the same haul (no live RNG)", () => {
    const a = newRun("forage-determinism");
    const b = newRun("forage-determinism");
    applyOverworldEffect(forageEffect,{ run: a, unit: survivalist(), opts: {} });
    applyOverworldEffect(forageEffect,{ run: b, unit: survivalist(), opts: {} });
    expect(a.inventory.counts).toEqual(b.inventory.counts);
  });

  it("higher job level forages more (the non-combat use-leveling payoff)", () => {
    const lowRun = newRun("forage-lvl-low");
    const highRun = newRun("forage-lvl-high");
    const veteran = survivalist();
    veteran.jobLevels = { survivalist: { level: 5, xp: 0 } };
    applyOverworldEffect(forageEffect,{ run: lowRun, unit: survivalist(), opts: {} }); // job level 1
    applyOverworldEffect(forageEffect,{ run: highRun, unit: veteran, opts: {} }); // job level 5
    expect(countAll(highRun.inventory)).toBeGreaterThan(countAll(lowRun.inventory));
  });

  it("full path: spends base fatigue, paced at twice per node", () => {
    const run = newRun("forage-path");
    const bram = survivalist();
    run.party.push(bram);
    const first = useOverworldSkill(run, bram, FORAGE);
    expect(first.applied).toBe(true);
    expect(first.fatigueSpent).toBe(FORAGE.overworldCost!.fatigue); // base only (no surcharge, D73)
    expect(bram.fatigue).toBe(FORAGE.overworldCost!.fatigue);

    const second = useOverworldSkill(run, bram, FORAGE);
    expect(second.applied).toBe(true); // usesPerNode 2 — a second forage this night

    const third = useOverworldSkill(run, bram, FORAGE);
    expect(third.applied).toBe(false); // spent for tonight
    expect(third.reason).toMatch(/spent for tonight/i);
  });
});
