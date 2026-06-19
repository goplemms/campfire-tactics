import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import type { JobId } from "./jobs";
import { createCamp } from "./camp";
import { createRun } from "./run";
import { simulateRun } from "./sim";
import { earn, spend, openingPurseLog, purseFromLog, purseTotalBySource } from "./purse-journal";

describe("purse journal — the earn/spend chokepoint (substrate)", () => {
  it("earn/spend mutate the purse and log a signed, sourced entry", () => {
    const camp = createCamp({ gold: 50 }); // seeds an opening entry
    expect(camp.purseLog).toEqual([{ delta: 50, source: "opening", label: "Carried into the field" }]);

    earn(camp, 30, "loot", "Loot @ wolf-den", { nodeId: "wolf-den", night: 1 });
    spend(camp, 8, "action", "Buy Trap Kit");

    expect(camp.gold).toBe(72);
    expect(camp.purseLog).toHaveLength(3);
    expect(camp.purseLog[1]).toMatchObject({ delta: 30, source: "loot", nodeId: "wolf-den", night: 1 });
    expect(camp.purseLog[2]).toMatchObject({ delta: -8, source: "action" });
  });

  it("the log reconciles to the balance, and totals group by source", () => {
    const camp = createCamp({ gold: 100 });
    earn(camp, 40, "loot", "Loot");
    earn(camp, 25, "loot", "Loot");
    spend(camp, 10, "upkeep", "Food");
    spend(camp, 6, "toll", "Toll");

    expect(purseFromLog(camp)).toBe(camp.gold); // the invariant, by construction
    expect(purseTotalBySource(camp, "loot")).toBe(65);
    expect(purseTotalBySource(camp, "upkeep")).toBe(-10);
    expect(purseTotalBySource(camp, "opening")).toBe(100);
  });

  it("non-positive movements are no-ops (no entry, no mutation)", () => {
    const camp = createCamp({ gold: 0 }); // no opening entry at 0
    expect(camp.purseLog).toEqual([]);
    expect(earn(camp, 0, "loot", "nothing")).toBe(0);
    expect(spend(camp, -5, "toll", "nothing")).toBe(0);
    expect(camp.purseLog).toEqual([]);
    expect(camp.gold).toBe(0);
  });

  it("openingPurseLog seeds only when carrying gold", () => {
    expect(openingPurseLog(0)).toEqual([]);
    expect(openingPurseLog(80)).toEqual([{ delta: 80, source: "opening", label: "Carried into the field" }]);
  });
});

function starterParty(): Unit[] {
  const mk = (id: string, jobId: JobId, o: Partial<Unit> = {}): Unit =>
    createUnit({
      id, name: id, side: "player", pos: { col: -1, row: -1 }, jobId,
      speed: 11, maxHp: 28, attack: 9, defense: 3, moveRange: 4, sightRadius: 5,
      awareness: 4, intelligence: 4, ...o,
    });
  return [
    mk("Rook", "soldier", { maxHp: 34, defense: 4 }),
    mk("Vale", "scout", { speed: 13, moveRange: 5, attack: 8 }),
    mk("Bram", "hunter", { attackRange: 2, attack: 10, maxHp: 24 }),
    mk("Wynn", "medic", { maxHp: 22, attack: 7 }),
  ];
}

describe("purse journal — invariant across a full real run (no site missed)", () => {
  // Drive several full procedural runs and assert the journal reconciles to the
  // purse afterwards. simulateRun drives the run instance in place, so any gold
  // mutation that bypassed earn/spend (a missed site) would break the reconcile.
  const seeds = ["sim-1", "sim-7", "sim-23", "sim-42", "sim-58"];

  it("sum(purse log) === camp.gold after each run", () => {
    for (const seed of seeds) {
      const run = createRun(seed, { party: starterParty(), gold: 140 });
      simulateRun(() => run);
      expect(purseFromLog(run.camp)).toBe(run.camp.gold);
    }
  });

  it("a real run actually exercises the journal (opening + real flows recorded)", () => {
    const run = createRun("sim-7", { party: starterParty(), gold: 140 });
    simulateRun(() => run);
    expect(purseTotalBySource(run.camp, "opening")).toBe(140);
    // A full traversal pays nightly upkeep and banks at least some loot — the journal
    // is doing real work, not just carrying the opening entry.
    expect(run.camp.purseLog.length).toBeGreaterThan(1);
    expect(purseTotalBySource(run.camp, "upkeep")).toBeLessThan(0);
  });
});
