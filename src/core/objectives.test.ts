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

describe("withDefaultGoal (D50)", () => {
  it("injects the elimination goal when none is listed", () => {
    expect(withDefaultGoal()).toEqual([DEFAULT_GOAL]);
    expect(withDefaultGoal([CLOSING_GATE])).toEqual([DEFAULT_GOAL, CLOSING_GATE]);
  });

  it("leaves an explicit goal untouched", () => {
    const goal: ObjectiveSpec = { id: "g", kind: "eliminate-all", required: true, label: "win" };
    expect(withDefaultGoal([goal])).toEqual([goal]);
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
