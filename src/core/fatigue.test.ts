import { describe, it, expect } from "vitest";
import {
  FATIGUE,
  fatigueTier,
  spendFatigue,
  restoreFatigue,
  nightlyFatigue,
  restCostMultiplier,
  isExhausted,
  exhaustionSlowSpeed,
  fatigueRisk,
} from "./fatigue";
import { createUnit, type Unit } from "./units";
import { createRun, type RunState } from "./run";
import { RunLoop } from "./runloop";
import { currentNode, reachableNodes, chooseNode } from "./run";

function roster(): Unit[] {
  return [
    createUnit({ id: "Rook", side: "player", pos: { col: 0, row: 1 }, jobId: "soldier", speed: 12, maxHp: 30, attack: 9, defense: 3, moveRange: 4, sightRadius: 5, awareness: 4, intelligence: 4 }),
    createUnit({ id: "Vale", side: "player", pos: { col: 0, row: 4 }, jobId: "survivalist", speed: 10, maxHp: 24, attack: 11, defense: 2, moveRange: 4, sightRadius: 5, awareness: 2 }),
  ];
}

function newRun(seed: string): RunState {
  return createRun(seed, { party: roster(), difficultyId: "normal", gold: 200 });
}

describe("fatigue — defaults & banding (D35/D73)", () => {
  it("a fresh unit starts Rested at 0", () => {
    const u = roster()[0];
    expect(u.fatigue).toBe(0);
    expect(fatigueTier(0)).toBe("Rested");
  });

  it("the floor is a wide, invisible allowance — no consequence within it", () => {
    // Every level within the allowance bands as Rested/Worn: no heal penalty, wiped by any night.
    for (let level = 0; level <= FATIGUE.floor; level++) {
      expect(restCostMultiplier(level)).toBe(1);
      expect(nightlyFatigue(level, false)).toBe(0);
      expect(isExhausted(level)).toBe(false);
      expect(["Rested", "Worn"]).toContain(fatigueTier(level));
    }
  });
});

describe("fatigue — the bands bite past the floor (D73)", () => {
  it("Weary: pricier rest-heal + carries the excess over the floor into the next day", () => {
    const weary = FATIGUE.floor + 2;
    expect(fatigueTier(weary)).toBe("Weary");
    // recovers poorly — heal chunks cost more RP
    expect(restCostMultiplier(weary)).toBe(FATIGUE.wearyRestMult);
    expect(restCostMultiplier(weary)).toBeGreaterThan(1);
    // an ordinary night carries the excess over the floor…
    expect(nightlyFatigue(weary, false)).toBe(weary - FATIGUE.floor);
    // …an improved rest (a clearing) wipes it.
    expect(nightlyFatigue(weary, true)).toBe(0);
    expect(isExhausted(weary)).toBe(false);
  });

  it("Exhausted: heaviest heal cost, full carryover, and the band that reaches combat", () => {
    const spent = FATIGUE.exhausted;
    expect(fatigueTier(spent)).toBe("Exhausted");
    expect(restCostMultiplier(spent)).toBe(FATIGUE.exhaustedRestMult);
    expect(restCostMultiplier(spent)).toBeGreaterThan(FATIGUE.wearyRestMult);
    expect(isExhausted(spent)).toBe(true);
    expect(nightlyFatigue(spent, false)).toBe(spent - FATIGUE.floor);
    expect(nightlyFatigue(spent, true)).toBe(0);
  });

  it("carryover compounds across un-rested days; a clearing resets it", () => {
    const HEAVY = 8; // a Train-like clearing verb: Rested → Weary in one exertion
    let level = 0;
    const peaks: number[] = [];
    for (let day = 0; day < 3; day++) {
      const peak = spendFatigue(level, HEAVY); // the day's exertion
      peaks.push(peak);
      level = nightlyFatigue(peak, false); // an ordinary night carries the excess
    }
    // each un-rested day starts deeper, so the in-day peak climbs into Exhausted
    expect(peaks[0]).toBeLessThan(FATIGUE.exhausted);
    expect(peaks[2]).toBeGreaterThanOrEqual(FATIGUE.exhausted);
    // a clearing wipes the accumulated carryover clean
    expect(nightlyFatigue(level, true)).toBe(0);
  });

  it("the Exhausted Slow is gentle and per-unit (a CT cap, never a power debuff)", () => {
    expect(exhaustionSlowSpeed(12)).toBe(Math.floor(12 * FATIGUE.slowKeepFraction));
    expect(exhaustionSlowSpeed(12)).toBeLessThan(12); // slower…
    expect(exhaustionSlowSpeed(12)).toBeGreaterThan(0); // …but never frozen
    expect(exhaustionSlowSpeed(1)).toBeGreaterThanOrEqual(1); // floored at 1
  });

  it("spend clamps at the hard ceiling (no unbounded runaway)", () => {
    let level = 0;
    for (let i = 0; i < 100; i++) level = spendFatigue(level, 5);
    expect(level).toBe(FATIGUE.ceiling);
  });

  it("fatigueRisk is a clamped 0..1 meter", () => {
    expect(fatigueRisk(0)).toBe(0);
    expect(fatigueRisk(FATIGUE.exhausted)).toBe(1);
    expect(fatigueRisk(FATIGUE.ceiling)).toBe(1); // clamped
  });
});

describe("fatigue — rest restores (rest's second job, D47/D73)", () => {
  it("restoreFatigue wipes any level back to Rested", () => {
    expect(restoreFatigue(FATIGUE.exhausted)).toBe(FATIGUE.rested);
    expect(restoreFatigue(3)).toBe(0);
  });

  it("a rest node restores every member's fatigue to Rested", () => {
    const run = newRun("fatigue-rest");
    const restNode = run.map.order
      .map((id) => currentNodeOf(run, id))
      .find((n) => n.kind === "rest" && n.layer > 0)!;
    run.mapNodeId = restNode.id;
    run.path.push(restNode.id);
    // Over-extend the whole party first.
    for (const u of run.party) u.fatigue = FATIGUE.exhausted;

    const loop = new RunLoop(run);
    const res = loop.restNode();

    expect(res.fatigueRestored.sort()).toEqual(run.party.map((u) => u.id).sort());
    for (const u of run.party) expect(u.fatigue).toBe(0);
  });
});

describe("fatigue — combat reads it but never writes it (D29/D73)", () => {
  it("a full battle leaves the actors' fatigue value untouched", () => {
    const run = newRun("fatigue-combat");
    // Pre-load fatigue (below Exhausted, so no Slow), then play a combat node to a decision.
    for (const u of run.party) u.fatigue = 4;
    const before = run.party.map((u) => u.fatigue);

    const loop = new RunLoop(run);
    // Walk to the first combat node and run the whole encounter.
    while (true) {
      const next = reachableNodes(run);
      const combat = next.find((n) => n.kind === "combat") ?? next[0];
      chooseNode(run, combat.id);
      if (currentNode(run).kind === "combat") break;
    }
    loop.camp();
    loop.startEncounter();
    loop.beginBattle();
    loop.autoBattle();
    loop.resolve();

    // Combat may *read* fatigue (to Slow the Exhausted) but never *writes* the meter.
    expect(run.party.map((u) => u.fatigue)).toEqual(before);
  });
});

/** Helper: resolve a node by id (avoids importing getNode just for the test). */
function currentNodeOf(run: RunState, id: string) {
  return run.map.nodes[id];
}
