import { describe, it, expect } from "vitest";
import {
  FATIGUE,
  FATIGUE_TIER_FLOORS,
  fatigueTier,
  fatigueTierIndex,
  isFatigueTier0,
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
import { currentNode, reachableNodes, chooseNode, recordNight } from "./run";
import { hasStatus, SLOWED } from "./status";
import { effectiveSpeed } from "./clock";

function roster(): Unit[] {
  return [
    createUnit({ id: "Rook", side: "player", pos: { col: 0, row: 1 }, jobId: "soldier", speed: 12, maxHp: 30, attack: 9, defense: 3, moveRange: 4, sightRadius: 5, awareness: 4, intelligence: 4 }),
    createUnit({ id: "Vale", side: "player", pos: { col: 0, row: 4 }, jobId: "survivalist", speed: 10, maxHp: 24, attack: 11, defense: 2, moveRange: 4, sightRadius: 5, awareness: 2 }),
  ];
}

function newRun(seed: string): RunState {
  return createRun(seed, { party: roster(), difficultyId: "normal", gold: 200 });
}

describe("fatigue — defaults & banding (D35/D73/D80)", () => {
  it("a fresh unit starts Rested at 0", () => {
    const u = roster()[0];
    expect(u.fatigue).toBe(0);
    expect(fatigueTier(0)).toBe("Rested");
  });

  it("the narrowing bands map values to their named tier (Rested/Worn/Weary/Exhausted)", () => {
    // Floors are [0,4,7,9,…]: Tier 0 = Rested, 1 = Worn, 2 = Weary, 3+ = Exhausted.
    expect(fatigueTier(0)).toBe("Rested");
    expect(fatigueTier(3)).toBe("Rested"); // top of Tier 0
    expect(fatigueTier(4)).toBe("Worn"); // first step out
    expect(fatigueTier(6)).toBe("Worn");
    expect(fatigueTier(7)).toBe("Weary");
    expect(fatigueTier(8)).toBe("Weary");
    expect(fatigueTier(9)).toBe("Exhausted");
    expect(fatigueTier(FATIGUE.ceiling)).toBe("Exhausted");
  });

  it("Rested & Worn are the wide, consequence-free bands — no heal penalty, cleared in one night", () => {
    const wearyFloor = FATIGUE_TIER_FLOORS[2]; // 7 — the first tier that bites
    for (let level = 0; level < wearyFloor; level++) {
      expect(restCostMultiplier(level)).toBe(1);
      expect(nightlyFatigue(level, false)).toBe(0); // Tier 0/1 both step down to Rested
      expect(isExhausted(level)).toBe(false);
      expect(["Rested", "Worn"]).toContain(fatigueTier(level));
    }
  });

  it("tier index & Tier-0 gate track the band floors", () => {
    expect(fatigueTierIndex(0)).toBe(0);
    expect(fatigueTierIndex(3)).toBe(0);
    expect(fatigueTierIndex(4)).toBe(1);
    expect(fatigueTierIndex(7)).toBe(2);
    expect(fatigueTierIndex(9)).toBe(3);
    // The big-heal gate: only within Tier 0 (a light ~0-effort action stays eligible).
    expect(isFatigueTier0(0)).toBe(true);
    expect(isFatigueTier0(3)).toBe(true);
    expect(isFatigueTier0(4)).toBe(false); // one heavy skill (Survey ≈ 4) tips out of Tier 0
  });
});

describe("fatigue — the bands bite past the safe tiers (D73/D80)", () => {
  it("Weary: pricier rest-heal + an ordinary night only steps it down one tier", () => {
    const weary = FATIGUE_TIER_FLOORS[2]; // 7 — Tier 2
    expect(fatigueTier(weary)).toBe("Weary");
    // recovers poorly — heal chunks cost more RP
    expect(restCostMultiplier(weary)).toBe(FATIGUE.wearyRestMult);
    expect(restCostMultiplier(weary)).toBeGreaterThan(1);
    // an ordinary night steps down to the floor of the tier below (Weary → Worn)…
    expect(nightlyFatigue(weary, false)).toBe(FATIGUE_TIER_FLOORS[1]);
    expect(fatigueTier(nightlyFatigue(weary, false))).toBe("Worn");
    // …a Deep Rest (a clearing) wipes it fully.
    expect(nightlyFatigue(weary, true)).toBe(0);
    expect(isExhausted(weary)).toBe(false);
  });

  it("Exhausted: heaviest heal cost, the band that reaches combat, one tier shed per night", () => {
    const spent = FATIGUE.exhausted; // 9 — Tier 3
    expect(fatigueTier(spent)).toBe("Exhausted");
    expect(restCostMultiplier(spent)).toBe(FATIGUE.exhaustedRestMult);
    expect(restCostMultiplier(spent)).toBeGreaterThan(FATIGUE.wearyRestMult);
    expect(isExhausted(spent)).toBe(true);
    // steps down one tier (Exhausted → Weary floor), not a full wipe
    expect(nightlyFatigue(spent, false)).toBe(FATIGUE_TIER_FLOORS[2]);
    expect(nightlyFatigue(spent, true)).toBe(0);
  });

  it("carryover compounds across un-rested days; a clearing resets it", () => {
    const HEAVY = 8; // a Train-like clearing verb: Rested → Weary in one exertion
    let level = 0;
    const peaks: number[] = [];
    for (let day = 0; day < 3; day++) {
      const peak = spendFatigue(level, HEAVY); // the day's exertion
      peaks.push(peak);
      level = nightlyFatigue(peak, false); // an ordinary night steps down only one tier
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
    // The battle itself never *writes* the fatigue meter (it only *reads* it, to Slow the Exhausted).
    expect(run.party.map((u) => u.fatigue)).toEqual(before);

    // Resolving the node is a **night** on the overworld clock (D73) — it wipes the safe Worn band.
    loop.resolve();
    for (const u of run.party) expect(u.fatigue).toBe(0);
  });
});

describe("fatigue — the nightly resolution (ordinary vs deep rest, D73/D80)", () => {
  it("an ordinary night (recordNight) steps each unit down one tier", () => {
    const run = newRun("nightly-ordinary");
    run.party[0].fatigue = FATIGUE.exhausted; // Exhausted (9) → floor of Weary (7)
    run.party[1].fatigue = FATIGUE_TIER_FLOORS[1]; // Worn (4) → Rested (0)
    const node = currentNode(run);
    recordNight(run, { nodeId: node.id, layer: node.layer, kind: "combat", goldEarned: 0, fallen: [] });
    expect(run.party[0].fatigue).toBe(FATIGUE_TIER_FLOORS[2]); // 7
    expect(run.party[1].fatigue).toBe(0);
  });

  it("a rest-kind night does not resolve here — the Deep Rest wipe lives in RunLoop.restNode", () => {
    const run = newRun("nightly-rest");
    run.party[0].fatigue = FATIGUE.exhausted; // 9
    const node = currentNode(run);
    recordNight(run, { nodeId: node.id, layer: node.layer, kind: "rest", goldEarned: 0, fallen: [] });
    expect(run.party[0].fatigue).toBe(FATIGUE.exhausted); // untouched — recordNight skips rest (restNode does the wipe)
  });
});

describe("fatigue — Exhausted reaches combat as a tempo Slow (D73)", () => {
  it("an Exhausted unit fields Slowed at battle setup; a Rested one doesn't", () => {
    const run = newRun("fatigue-slow");
    const loop = new RunLoop(run);
    // Walk to a combat node.
    while (true) {
      const next = reachableNodes(run);
      const combat = next.find((n) => n.kind === "combat") ?? next[0];
      chooseNode(run, combat.id);
      if (currentNode(run).kind === "combat") break;
    }
    run.party[0].fatigue = FATIGUE.exhausted; // Exhausted → fields Slowed
    run.party[1].fatigue = 0; // Rested → not

    loop.camp();
    loop.startEncounter(); // the Battle constructor stamps the Slow from each unit's fatigue

    expect(hasStatus(run.party[0], SLOWED)).toBe(true);
    expect(hasStatus(run.party[1], SLOWED)).toBe(false);
    // Tempo-only: effective speed is capped (gentle, ~70% of base); the rested unit is untouched.
    expect(effectiveSpeed(run.party[0])).toBe(exhaustionSlowSpeed(run.party[0].speed));
    expect(effectiveSpeed(run.party[0])).toBeLessThan(run.party[0].speed);
    expect(effectiveSpeed(run.party[1])).toBe(run.party[1].speed);
  });
});

/** Helper: resolve a node by id (avoids importing getNode just for the test). */
function currentNodeOf(run: RunState, id: string) {
  return run.map.nodes[id];
}
