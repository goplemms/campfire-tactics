import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import { createRun, reachableNodes, breakCamp, type RunState } from "./run";
import {
  getAbility,
  takeOverworldAction,
  useCampSkillAtNode,
  campSkillUses,
  campSkillUsesLeft,
  tickCooldowns,
  cooldownRemaining,
  scoutedTier,
  createOverworldEconomy,
  validateOverworldCost,
  hasPacing,
  hasPrice,
  OVERWORLD_ABILITIES,
  SURVEY,
  triage,
  isHealer,
  TRIAGE,
  resolveKnob,
  knobDeclared,
  checkOverworldCost,
  commitOverworldCost,
  setNodeFlag,
  hasNodeFlag,
  primeFlag,
  consumeFlag,
  isPrimed,
  cloneOverworldEconomy,
  applyOverworldEffect,
  DEAL_PRIMED_FLAG,
  type OverworldCost,
} from "./overworld-actions";
import { getJob, unitHasCapability, CAPABILITY_PREDICATES, type JobDef, type JobLookup } from "./jobs";
import { PASSIVE } from "./combat";
import { skillContexts } from "./skills";
import { computeUpkeep, payUpkeep, satisfyUpkeepLine } from "./upkeep";
import { effectiveMarketTier, marketOpenedFlag, type MapNode } from "./overworld";
import type { SkillDef } from "./skills";
import { previewNode } from "./intel";
import { FATIGUE } from "./fatigue";

function roster(): Unit[] {
  return [
    // Rook is a Scout so it can perform the job-gated Survey ability (jobIds: ["scout"]).
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

/** The Chef's costless camp skill (Cook Stew) — the per-node-capped signature action. */
function cookSkill(): SkillDef {
  return getJob("chef")!.skills[0];
}

describe("overworld-actions — registry (D29)", () => {
  it("abilities are data with a cost menu (cooldown + optional fatigue/gold)", () => {
    expect(getAbility("survey")).toBe(SURVEY);
    expect(getAbility("nope")).toBeUndefined();
    // The cooldown spine is always present.
    expect(SURVEY.cost.cooldown).toBeGreaterThan(0);
  });
});

describe("overworld-actions — the cooldown spine (D35)", () => {
  it("applying arms the cooldown and spends fatigue", () => {
    const run = newRun("cd-arm");
    const actor = run.party[0];
    const target = reachableNodes(run)[0];
    const res = takeOverworldAction(run, actor, "survey", { targetNodeId: target.id });

    expect(res.applied).toBe(true);
    expect(res.fatigueSpent).toBe(SURVEY.cost.fatigue);
    expect(actor.fatigue).toBe(SURVEY.cost.fatigue);
    expect(cooldownRemaining(run.overworld, "survey")).toBe(SURVEY.cost.cooldown);
  });

  it("refuses while on cooldown, with a reason", () => {
    const run = newRun("cd-refuse");
    const actor = run.party[0];
    const target = reachableNodes(run)[0];
    takeOverworldAction(run, actor, "survey", { targetNodeId: target.id });
    const again = takeOverworldAction(run, actor, "survey", { targetNodeId: target.id });

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
    takeOverworldAction(run, actor, "survey", { targetNodeId: target.id });
    expect(cooldownRemaining(run.overworld, "survey")).toBe(SURVEY.cost.cooldown!);

    // Break Camp is the node-step that ticks cooldowns — at departure, not the event.
    for (let i = 0; i < SURVEY.cost.cooldown!; i++) {
      breakCamp(run);
    }
    expect(cooldownRemaining(run.overworld, "survey")).toBe(0);
  });
});

describe("overworld-actions — the loose fatigue guardrail (D35)", () => {
  it("never locks out a cheap action, even when the actor is exhausted", () => {
    const run = newRun("fatigue-lock");
    const a = actor(run);
    a.fatigue = FATIGUE.exhausted; // deeply over-extended

    // Scout is cheap (cost 1 < demandingCost 2) → still available even when exhausted.
    // (The demanding-action *lock* itself is unit-tested in fatigue.test via
    // fatiguePenalty; no demanding overworld ability exists post-D61.)
    const target = reachableNodes(run)[0];
    const scout = takeOverworldAction(run, a, "survey", { targetNodeId: target.id });
    expect(scout.applied).toBe(true);
  });

  it("an over-extended actor pays the gentle surcharge on top of the base cost", () => {
    const run = newRun("fatigue-surcharge");
    const actor = run.party[0];
    actor.fatigue = FATIGUE.floor + 1; // just over the floor → surcharge of 1
    const target = reachableNodes(run)[0];
    const before = actor.fatigue;
    const res = takeOverworldAction(run, actor, "survey", { targetNodeId: target.id });

    expect(res.applied).toBe(true);
    expect(res.fatigueSpent!).toBeGreaterThan(SURVEY.cost.fatigue!); // base + surcharge
    expect(actor.fatigue).toBe(before + res.fatigueSpent!);
  });
});

describe("overworld-actions — Survey raises a reachable node's preview tier", () => {
  it("scouting a reachable node bumps its banded intel preview", () => {
    const run = newRun("scout-tier");
    const actor = run.party[0];
    const target = reachableNodes(run).find((n) => n.kind === "combat")!;

    const before = previewNode(run, target.id, scoutedTier(run.overworld, target.id));
    const res = takeOverworldAction(run, actor, "survey", { targetNodeId: target.id });
    expect(res.applied).toBe(true);
    expect(scoutedTier(run.overworld, target.id)).toBe(SURVEY.effect.kind === "survey" ? SURVEY.effect.tierBump : 0);

    const after = previewNode(run, target.id, scoutedTier(run.overworld, target.id));
    expect(after.intel!.tier).toBeGreaterThan(before.intel!.tier);
  });

  it("refuses to scout an unreachable node", () => {
    const run = newRun("scout-unreach");
    const actor = run.party[0];
    const res = takeOverworldAction(run, actor, "survey", { targetNodeId: run.map.finalIds[0] });
    expect(res.applied).toBe(false);
    expect(res.reason).toMatch(/reachable/i);
  });

  it("refuses with no target node", () => {
    const run = newRun("scout-notarget");
    const res = takeOverworldAction(run, run.party[0], "survey");
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

  it("a worn-out healer's Triage locks until they rest (the fatigue limiter)", () => {
    const run = newRun("triage-exhausted");
    const doc = medic();
    doc.fatigue = FATIGUE.exhausted; // too worn out for a demanding action
    run.party.push(doc);
    run.party[0].hp = 1;
    const res = triage(run, doc);
    expect(res.applied).toBe(false);
    expect(res.reason).toMatch(/exhausted|worn|rest/i);
    expect(run.party[0].hp).toBe(1);
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
    const first = useCampSkillAtNode(run, a, cook);
    expect(first.applied).toBe(true);
    expect(run.camp.morale).toBe(moraleBefore + 1);
    expect(campSkillUses(run.overworld, cook.id)).toBe(1);

    // The second use this node is refused — the buff is spent, not doubled.
    const second = useCampSkillAtNode(run, a, cook);
    expect(second.applied).toBe(false);
    expect(second.reason).toMatch(/spent for tonight/i);
    expect(run.camp.morale).toBe(moraleBefore + 1);
  });

  it("the cap resets on the node-step (Break Camp), so each node grants a fresh use", () => {
    const run = newRun("camp-reset");
    const a = actor(run);
    const cook = cookSkill();

    expect(useCampSkillAtNode(run, a, cook).applied).toBe(true);
    expect(useCampSkillAtNode(run, a, cook).applied).toBe(false); // spent

    breakCamp(run); // the node-step tick clears the per-node allowance
    expect(campSkillUses(run.overworld, cook.id)).toBe(0);
    expect(useCampSkillAtNode(run, a, cook).applied).toBe(true); // fresh node, fresh use
  });

  it("an uncapped camp skill (no usesPerNode) is gated by its own cost, not the node-cap", () => {
    const run = newRun("camp-uncapped");
    const a = actor(run);
    // A hypothetical resource-paid action: no per-node cap → fires repeatedly.
    const uncapped: SkillDef = { ...cookSkill(), id: "cook-uncapped", usesPerNode: undefined };
    expect(campSkillUsesLeft(run.overworld, uncapped)).toBe(Infinity);
    expect(useCampSkillAtNode(run, a, uncapped).applied).toBe(true);
    expect(useCampSkillAtNode(run, a, uncapped).applied).toBe(true);
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

  it("every registered overworld ability satisfies the invariant", () => {
    for (const ability of Object.values(OVERWORLD_ABILITIES)) {
      expect(() => validateOverworldCost(ability.name, ability.cost)).not.toThrow();
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
    if (check.ok) commitOverworldCost(run, "stew-fixture", cost, check.fatigueSpend);
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
  });
});
