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
} from "./overworld-actions";
import { getJob } from "./jobs";
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
