import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import { createRun, reachableNodes, breakCamp, type RunState } from "./run";
import {
  getAbility,
  takeOverworldAction,
  tickCooldowns,
  cooldownRemaining,
  scoutedTier,
  createOverworldEconomy,
  SCOUT,
  MARKET,
} from "./overworld-actions";
import { previewNode } from "./intel";
import { FATIGUE } from "./fatigue";

function roster(): Unit[] {
  return [
    createUnit({ id: "Rook", side: "player", pos: { col: 0, row: 1 }, jobId: "soldier", speed: 12, maxHp: 30, attack: 9, defense: 3, moveRange: 4, sightRadius: 5, awareness: 4, intelligence: 1 }),
    createUnit({ id: "Coin", side: "player", pos: { col: -1, row: -1 }, jobId: "merchant", speed: 8, maxHp: 16, attack: 2, defense: 1, moveRange: 3, sightRadius: 4 }),
  ];
}

function newRun(seed: string): RunState {
  return createRun(seed, { party: roster(), difficultyId: "normal", gold: 200, storageCap: 6 });
}

/** The acting Merchant (for Market). */
function merchant(run: RunState): Unit {
  return run.party.find((u) => u.jobId === "merchant")!;
}

describe("overworld-actions — registry (D29)", () => {
  it("abilities are data with a cost menu (cooldown + optional fatigue/gold/vancian)", () => {
    expect(getAbility("scout")).toBe(SCOUT);
    expect(getAbility("market")).toBe(MARKET);
    expect(getAbility("nope")).toBeUndefined();
    // The cooldown spine is always present; the vancian stub is left unwired.
    expect(SCOUT.cost.cooldown).toBeGreaterThan(0);
    expect(MARKET.cost.cooldown).toBeGreaterThan(0);
    expect(SCOUT.cost.vancian).toBeUndefined();
  });
});

describe("overworld-actions — the cooldown spine (D35)", () => {
  it("applying arms the cooldown and spends fatigue", () => {
    const run = newRun("cd-arm");
    const actor = run.party[0];
    const target = reachableNodes(run)[0];
    const res = takeOverworldAction(run, actor, "scout", { targetNodeId: target.id });

    expect(res.applied).toBe(true);
    expect(res.fatigueSpent).toBe(SCOUT.cost.fatigue);
    expect(actor.fatigue).toBe(SCOUT.cost.fatigue);
    expect(cooldownRemaining(run.overworld, "scout")).toBe(SCOUT.cost.cooldown);
  });

  it("refuses while on cooldown, with a reason", () => {
    const run = newRun("cd-refuse");
    const actor = run.party[0];
    const target = reachableNodes(run)[0];
    takeOverworldAction(run, actor, "scout", { targetNodeId: target.id });
    const again = takeOverworldAction(run, actor, "scout", { targetNodeId: target.id });

    expect(again.applied).toBe(false);
    expect(again.reason).toMatch(/cooldown/i);
  });

  it("cooldowns tick per node-step; reaching 0 re-enables", () => {
    const eco = createOverworldEconomy();
    eco.cooldowns["scout"] = 2;
    tickCooldowns(eco);
    expect(cooldownRemaining(eco, "scout")).toBe(1);
    tickCooldowns(eco);
    expect(cooldownRemaining(eco, "scout")).toBe(0);
    // Idle ticks never go negative.
    tickCooldowns(eco);
    expect(cooldownRemaining(eco, "scout")).toBe(0);
  });

  it("departing a node (breakCamp) ticks the spine — the node-step fires at departure (D46)", () => {
    const run = newRun("cd-node-tick");
    const actor = run.party[0];
    const target = reachableNodes(run)[0];
    takeOverworldAction(run, actor, "scout", { targetNodeId: target.id });
    expect(cooldownRemaining(run.overworld, "scout")).toBe(SCOUT.cost.cooldown);

    // Break Camp is the node-step that ticks cooldowns — at departure, not the event.
    for (let i = 0; i < SCOUT.cost.cooldown; i++) {
      breakCamp(run);
    }
    expect(cooldownRemaining(run.overworld, "scout")).toBe(0);
  });
});

describe("overworld-actions — the loose fatigue guardrail (D35)", () => {
  it("refuses a demanding action when the actor is exhausted, but never a cheap one", () => {
    const run = newRun("fatigue-lock");
    const coin = merchant(run);
    coin.fatigue = FATIGUE.exhausted; // deeply over-extended

    // Market is demanding (cost >= demandingCost) → locked out.
    const market = takeOverworldAction(run, coin, "market");
    expect(market.applied).toBe(false);
    expect(market.reason).toMatch(/exhausted/i);

    // Scout is cheap (cost 1 < demandingCost) → still available even when exhausted.
    const target = reachableNodes(run)[0];
    const scout = takeOverworldAction(run, coin, "scout", { targetNodeId: target.id });
    expect(scout.applied).toBe(true);
  });

  it("an over-extended actor pays the gentle surcharge on top of the base cost", () => {
    const run = newRun("fatigue-surcharge");
    const actor = run.party[0];
    actor.fatigue = FATIGUE.floor + 1; // just over the floor → surcharge of 1
    const target = reachableNodes(run)[0];
    const before = actor.fatigue;
    const res = takeOverworldAction(run, actor, "scout", { targetNodeId: target.id });

    expect(res.applied).toBe(true);
    expect(res.fatigueSpent!).toBeGreaterThan(SCOUT.cost.fatigue!); // base + surcharge
    expect(actor.fatigue).toBe(before + res.fatigueSpent!);
  });
});

describe("overworld-actions — Scout raises a reachable node's preview tier", () => {
  it("scouting a reachable node bumps its banded intel preview", () => {
    const run = newRun("scout-tier");
    const actor = run.party[0];
    const target = reachableNodes(run).find((n) => n.kind === "combat")!;

    const before = previewNode(run, target.id, scoutedTier(run.overworld, target.id));
    const res = takeOverworldAction(run, actor, "scout", { targetNodeId: target.id });
    expect(res.applied).toBe(true);
    expect(scoutedTier(run.overworld, target.id)).toBe(SCOUT.effect.kind === "scout" ? SCOUT.effect.tierBump : 0);

    const after = previewNode(run, target.id, scoutedTier(run.overworld, target.id));
    expect(after.intel!.tier).toBeGreaterThan(before.intel!.tier);
  });

  it("refuses to scout an unreachable node", () => {
    const run = newRun("scout-unreach");
    const actor = run.party[0];
    const res = takeOverworldAction(run, actor, "scout", { targetNodeId: run.map.finalIds[0] });
    expect(res.applied).toBe(false);
    expect(res.reason).toMatch(/reachable/i);
  });

  it("refuses with no target node", () => {
    const run = newRun("scout-notarget");
    const res = takeOverworldAction(run, run.party[0], "scout");
    expect(res.applied).toBe(false);
  });
});

describe("overworld-actions — Market moves gold/provision under the cap", () => {
  it("marketing earns gold and expands storage (the existing Merchant effect)", () => {
    const run = newRun("market-gold");
    const coin = merchant(run);
    const goldBefore = run.camp.gold;
    const capBefore = run.camp.storageCap;

    const res = takeOverworldAction(run, coin, "market");
    expect(res.applied).toBe(true);
    expect(run.camp.gold).toBeGreaterThan(goldBefore);
    expect(run.camp.storageCap).toBeGreaterThan(capBefore);
    // The master logistics cap (D6) is kept in sync with the inventory.
    expect(run.inventory.storageCap).toBe(run.camp.storageCap);
    // Market is on cooldown afterward.
    expect(cooldownRemaining(run.overworld, "market")).toBe(MARKET.cost.cooldown);
  });
});
