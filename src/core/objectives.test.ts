import { describe, it, expect } from "vitest";
import { createUnit, type Unit, type UnitSpec } from "./units";
import { CTClock } from "./clock";
import { applyStatus, immobilized } from "./status";
import {
  armObjectives,
  withDefaultGoal,
  DEFAULT_GOAL,
  type ObjectiveSpec,
} from "./objectives";

function unit(id: string, side: "player" | "enemy", over: Partial<UnitSpec> = {}): Unit {
  return createUnit({
    id,
    side,
    pos: { col: 0, row: 0 },
    speed: 10,
    maxHp: 20,
    attack: 5,
    defense: 1,
    moveRange: 3,
    sightRadius: 5,
    attackRange: 1,
    ...over,
  });
}

const CLOSING_GATE: ObjectiveSpec = {
  id: "gate",
  kind: "closing-gate",
  required: true,
  label: "Hold the bridge",
  speed: 5, // ~20 ticks to fill
  span: [{ col: 4, row: 2 }],
  driver: { role: "sapper" },
};

const EXIT = [{ col: 0, row: 5 }, { col: 1, row: 5 }];
const EXTRACTION: ObjectiveSpec = {
  id: "extract",
  kind: "extraction",
  required: true,
  label: "Escort the prisoners to the exit",
  span: EXIT,
  escort: { role: "prisoner" },
};

/** A bound prisoner: player-side, role-tagged, captured until freed. */
function prisoner(id: string, pos = { col: 6, row: 0 }): Unit {
  const p = unit(id, "player", { role: "prisoner", pos });
  p.captured = true;
  return p;
}

describe("withDefaultGoal (D50/D97)", () => {
  it("injects the elimination goal when none is listed", () => {
    expect(withDefaultGoal()).toEqual([DEFAULT_GOAL]);
    expect(withDefaultGoal([CLOSING_GATE])).toEqual([DEFAULT_GOAL, CLOSING_GATE]);
  });

  it("leaves an explicit goal untouched", () => {
    const goal: ObjectiveSpec = { id: "g", kind: "eliminate-all", required: true, label: "win" };
    expect(withDefaultGoal([goal])).toEqual([goal]);
  });

  it("treats extraction as an explicit goal — no default elimination injected (D97)", () => {
    // An extraction-only encounter wins solely by getting the prisoners out.
    expect(withDefaultGoal([EXTRACTION])).toEqual([EXTRACTION]);
    // …but a closing-gate + extraction still has its goal, so still no injection.
    expect(withDefaultGoal([CLOSING_GATE, EXTRACTION])).toEqual([CLOSING_GATE, EXTRACTION]);
  });
});

describe("extraction (D97)", () => {
  it("met only once every freed prisoner stands on an exit tile", () => {
    const p1 = prisoner("p1");
    const hero = unit("hero", "player", { pos: { col: 0, row: 0 } });
    const foe = unit("foe", "enemy", { pos: { col: 6, row: 2 } });
    const units = [hero, p1, foe];
    const clock = new CTClock(units);
    const [obj] = armObjectives(clock, units, [EXTRACTION]);

    expect(obj.status()).toBe("pending"); // still cuffed
    p1.captured = false; // the Thief picks the lock
    expect(obj.status()).toBe("pending"); // freed, but not yet at the exit
    p1.pos = { col: 0, row: 5 }; // escorted onto an exit tile
    expect(obj.status()).toBe("met");
  });

  it("stays pending (never fails) if a prisoner is lost — the frontal path stays open", () => {
    const p1 = prisoner("p1");
    const p2 = prisoner("p2", { col: 7, row: 0 });
    const units = [unit("hero", "player"), p1, p2, unit("foe", "enemy", { pos: { col: 6, row: 2 } })];
    const clock = new CTClock(units);
    const [obj] = armObjectives(clock, units, [EXTRACTION]);

    // p1 freed and out, but p2 is downed — extraction can't complete, yet never "failed".
    p1.captured = false; p1.pos = { col: 0, row: 5 };
    p2.alive = false;
    expect(obj.status()).toBe("pending");
  });

  it("a still-captured prisoner sitting on an exit tile does NOT count", () => {
    const p1 = prisoner("p1", { col: 0, row: 5 }); // bound, but happens to be on the exit
    const units = [unit("hero", "player"), p1];
    const clock = new CTClock(units);
    const [obj] = armObjectives(clock, units, [EXTRACTION]);
    expect(obj.status()).toBe("pending"); // captured ⇒ not extracted
  });

  it("progress reports the fraction of prisoners freed-and-at-the-exit", () => {
    const p1 = prisoner("p1");
    const p2 = prisoner("p2", { col: 7, row: 0 });
    const units = [unit("hero", "player"), p1, p2];
    const clock = new CTClock(units);
    const [obj] = armObjectives(clock, units, [EXTRACTION]);
    expect(obj.progress()).toBe(0);
    p1.captured = false; p1.pos = { col: 0, row: 5 };
    expect(obj.progress()).toBe(0.5);
    p2.captured = false; p2.pos = { col: 1, row: 5 };
    expect(obj.progress()).toBe(1);
    expect(obj.status()).toBe("met");
  });

  it("pending with no tagged escortees (nothing to extract)", () => {
    const units = [unit("hero", "player"), unit("foe", "enemy", { pos: { col: 6, row: 2 } })];
    const clock = new CTClock(units);
    const [obj] = armObjectives(clock, units, [EXTRACTION]);
    expect(obj.status()).toBe("pending");
    expect(obj.progress()).toBeUndefined();
  });
});

describe("eliminate-all (D50)", () => {
  it("reads the win primitive: pending until the field is cleared, then met", () => {
    const hero = unit("hero", "player");
    const foe = unit("foe", "enemy", { pos: { col: 5, row: 0 } });
    const units = [hero, foe];
    const clock = new CTClock(units);
    const [obj] = armObjectives(clock, units, [DEFAULT_GOAL]);
    expect(obj.status()).toBe("pending");
    foe.alive = false;
    expect(obj.status()).toBe("met");
  });
});

describe("closing-gate (D50)", () => {
  it("fails when the gauge completes (driver left alone), sweeping its span", () => {
    const onSpan = unit("victim", "player", { pos: { col: 4, row: 2 } });
    const sapper = unit("sap", "enemy", { pos: { col: 7, row: 0 }, role: "sapper" });
    const units = [onSpan, sapper];
    const clock = new CTClock(units);
    const [gate] = armObjectives(clock, units, [CLOSING_GATE]);
    expect(gate.status()).toBe("pending");
    for (let i = 0; i < 40 && gate.status() === "pending"; i++) clock.tick();
    expect(gate.status()).toBe("failed");
    expect(onSpan.hp).toBeLessThanOrEqual(0); // the span collapsed onto its occupant
  });

  it("fizzles to met when the driver is killed before it lands", () => {
    const sapper = unit("sap", "enemy", { pos: { col: 7, row: 0 }, role: "sapper" });
    const units = [unit("hero", "player"), sapper];
    const clock = new CTClock(units);
    const [gate] = armObjectives(clock, units, [CLOSING_GATE]);
    sapper.alive = false; // killed → the gate can never land
    expect(gate.status()).toBe("met");
  });

  it("fizzles to met when the driver is immobilized at completion (span spared)", () => {
    const onSpan = unit("victim", "player", { pos: { col: 4, row: 2 } });
    const sapper = unit("sap", "enemy", { pos: { col: 7, row: 0 }, role: "sapper" });
    const units = [onSpan, sapper];
    const clock = new CTClock(units);
    const [gate] = armObjectives(clock, units, [CLOSING_GATE]);
    applyStatus(sapper, immobilized(999));
    for (let i = 0; i < 40 && gate.status() === "pending"; i++) clock.tick();
    expect(gate.status()).toBe("met");
    expect(onSpan.hp).toBeGreaterThan(0); // the cut never landed
  });

  it("progress reports the gauge fill 0..1 while pending", () => {
    const sapper = unit("sap", "enemy", { role: "sapper", pos: { col: 7, row: 0 } });
    const units = [unit("hero", "player"), sapper];
    const clock = new CTClock(units);
    const [gate] = armObjectives(clock, units, [CLOSING_GATE]);
    const start = gate.progress() ?? 0;
    clock.tick();
    clock.tick();
    expect((gate.progress() ?? 0)).toBeGreaterThan(start);
  });
});
