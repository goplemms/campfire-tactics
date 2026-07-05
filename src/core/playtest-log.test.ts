import { describe, it, expect } from "vitest";
import {
  RunLoop,
  createRunFromExpedition,
  THE_HOLLOW_MILL,
  createPlaytestLog,
  summarizePlaytest,
  type PlaytestLog,
  type LeverSnapshot,
} from "./index";

describe("playtest-log — the logistics-integrity instrument", () => {
  it("captures nothing when no log is attached (zero behaviour change)", () => {
    const run = createRunFromExpedition(THE_HOLLOW_MILL);
    const loop = new RunLoop(run);
    expect(loop.log).toBeUndefined();
    loop.autoTraverse();
    // The run still reaches a terminal; the optional sink simply stays dark.
    expect(loop.log).toBeUndefined();
    expect(loop.isTerminal()).toBe(true);
  });

  it("records an ordered timeline across a full Hollow Mill traversal", () => {
    const run = createRunFromExpedition(THE_HOLLOW_MILL);
    const loop = new RunLoop(run);
    loop.log = createPlaytestLog(run, "hollow-mill");
    loop.autoTraverse();

    const log = loop.log;
    expect(log.expeditionId).toBe(THE_HOLLOW_MILL.id);
    expect(log.events.length).toBeGreaterThan(0);

    // Every event carries a monotonic seq and a populated party snapshot.
    log.events.forEach((e, i) => {
      expect(e.snapshot.seq).toBe(i);
      expect(e.snapshot.party.length).toBeGreaterThan(0);
      expect(e.snapshot.nodeId).toBeTruthy();
    });

    // The authored arc pays upkeep at camp and resolves authored fights.
    expect(log.events.some((e) => e.at === "camp")).toBe(true);
    expect(log.events.some((e) => e.at === "encounter")).toBe(true);
  });

  it("summarizes a real traversal into per-lever engagement flags", () => {
    const run = createRunFromExpedition(THE_HOLLOW_MILL);
    const loop = new RunLoop(run);
    loop.log = createPlaytestLog(run, "hollow-mill");
    loop.autoTraverse();

    const s = summarizePlaytest(loop.log);
    expect(s.runId).toBe("hollow-mill");
    expect(s.encounters).toBeGreaterThan(0);
    expect(s.outcomes.win + s.outcomes["objective-failure"] + s.outcomes.wipe).toBe(s.encounters);
    expect(s.goldEarned).toBeGreaterThanOrEqual(0);
    // Every lever gets a boolean — the headline readout the reviewer scans.
    expect(Object.keys(s.engaged).sort()).toEqual(
      ["feltTraps", "goldPressure", "leveled", "moraleMoved", "restedInPlace", "skippedFood", "storagePressure", "tookCaptureRisk"].sort(),
    );
  });
});

describe("summarizePlaytest — derives lever engagement from a timeline", () => {
  function snap(over: Partial<LeverSnapshot> = {}): LeverSnapshot {
    return {
      seq: 0,
      night: 0,
      nodeId: "n0",
      layer: 0,
      kind: "combat",
      purse: 100,
      morale: 0,
      moraleTier: "Neutral",
      rp: 0,
      gearWear: 0,
      storageUsed: 0,
      storageFree: 4,
      storageCap: 4,
      party: [{ id: "u1", jobId: "soldier", hp: 10, maxHp: 10, fatigue: 0, alive: true, captured: false }],
      ...over,
    };
  }

  it("flags skip-food, gold pressure, capture risk and leveling when they occur", () => {
    const log: PlaytestLog = {
      runId: "synthetic",
      seq: 0,
      events: [
        {
          at: "camp",
          snapshot: snap({ purse: 5, gearWear: 2 }),
          upkeep: { paid: 4, skipped: ["food"], underfunded: [], moraleDelta: -3 },
        },
        {
          at: "encounter",
          snapshot: snap({ purse: 45, moraleTier: "High", morale: 2 }),
          result: "win",
          goldEarned: 40,
          captured: ["ally2"],
          rescued: [],
          permadeaths: [],
          leveled: ["u1"],
          traps: { staged: 5, spotted: 2, sprung: 1, disarmed: 1 },
        },
      ],
    };

    const s = summarizePlaytest(log);
    expect(s.foodSkips).toBe(1);
    expect(s.goldEarned).toBe(40);
    expect(s.goldSpentUpkeep).toBe(4);
    expect(s.captures).toBe(1);
    expect(s.levelUps).toBe(1);
    expect(s.peakGearWear).toBe(2);
    expect(s.outcomes.win).toBe(1);
    expect(s.engaged.skippedFood).toBe(true);
    expect(s.engaged.goldPressure).toBe(true); // purse dipped to 5 (≤ floor)
    expect(s.engaged.tookCaptureRisk).toBe(true);
    expect(s.engaged.leveled).toBe(true);
    expect(s.engaged.moraleMoved).toBe(true); // saw a non-Neutral tier
    expect(s.traps).toEqual({ staged: 5, spotted: 2, sprung: 1, disarmed: 1 });
    expect(s.engaged.feltTraps).toBe(true);
  });

  it("reads a comfortable run as low-engagement (the loud 'lever never bit' signal)", () => {
    const log: PlaytestLog = {
      runId: "comfortable",
      seq: 0,
      events: [
        {
          at: "camp",
          snapshot: snap({ purse: 200 }),
          upkeep: { paid: 6, skipped: [], underfunded: [], moraleDelta: 0 },
        },
        {
          at: "encounter",
          snapshot: snap({ purse: 240 }),
          result: "win",
          goldEarned: 40,
          captured: [],
          rescued: [],
          permadeaths: [],
          leveled: [],
          // Traps staged but never touched — the loud "field never felt" read.
          traps: { staged: 5, spotted: 0, sprung: 0, disarmed: 0 },
        },
      ],
    };

    const s = summarizePlaytest(log);
    expect(s.engaged.skippedFood).toBe(false);
    expect(s.engaged.goldPressure).toBe(false); // never dipped near broke
    expect(s.engaged.tookCaptureRisk).toBe(false);
    expect(s.engaged.moraleMoved).toBe(false); // stayed Neutral the whole run
    expect(s.engaged.feltTraps).toBe(false); // 5 staged, none touched — the miss reads loud
    expect(s.traps.staged).toBe(5);
    expect(s.purseMin).toBe(200);
  });
});
