import { describe, it, expect } from "vitest";
import { createUnit, type Unit, type UnitSpec } from "./units";
import { TileGrid } from "./grid";
import { Battle } from "./turn";
import type { EncounterDef } from "./generation";
import type { AuthoredEncounter } from "./authored";
import type { ArmedObjective, ObjectiveStatus } from "./objectives";
import {
  stageEncounter,
  encounterOutcome,
  isAuthoredEncounter,
  type StagedEncounter,
} from "./staging";

function player(id: string, over: Partial<UnitSpec> = {}): Unit {
  return createUnit({
    id, side: "player", pos: { col: 0, row: 0 },
    speed: 10, maxHp: 20, attack: 6, defense: 2, moveRange: 3, sightRadius: 5, attackRange: 1, ...over,
  });
}

const PROCEDURAL: EncounterDef = {
  index: 0,
  type: "open-field",
  cols: 8,
  rows: 6,
  blocked: [],
  enemies: [
    { id: "thug", name: "Thug", side: "enemy", pos: { col: 6, row: 2 }, speed: 9, maxHp: 18, attack: 6, defense: 2, moveRange: 3, sightRadius: 4, attackRange: 1 },
  ],
  reward: { gold: 50, materials: [] },
};

const AUTHORED: AuthoredEncounter = {
  id: "set-piece",
  name: "A Set-Piece",
  cols: 8,
  rows: 6,
  blocked: [{ col: 4, row: 1 }],
  playerSpawns: [{ col: 2, row: 2 }, { col: 2, row: 3 }],
  enemies: [{ templateId: "bandit-thug", pos: { col: 6, row: 2 } }],
  reward: { gold: 80, materials: [] },
  objectives: [
    { id: "gate", kind: "closing-gate", required: true, label: "Hold", speed: 5, span: [], driver: { id: "drv" } },
  ],
};

describe("stageEncounter — one shape for both sources (D50)", () => {
  it("stages a procedural source: auto-edge placement + default elimination goal", () => {
    const roster = [player("a"), player("b")];
    const staged = stageEncounter(PROCEDURAL, roster);
    // Both sides on the board.
    expect(staged.battle.units.filter((u) => u.side === "player")).toHaveLength(2);
    expect(staged.battle.units.filter((u) => u.side === "enemy")).toHaveLength(1);
    // Auto home edge: the left columns (0/1).
    for (const u of roster) expect(u.pos.col).toBeLessThanOrEqual(1);
    // Default elimination goal injected.
    expect(staged.objectives).toHaveLength(1);
    expect(staged.objectives[0].spec.kind).toBe("eliminate-all");
  });

  it("stages an authored source: honors playerSpawns + arms its objectives (+ default goal)", () => {
    const roster = [player("a"), player("b")];
    const staged = stageEncounter(AUTHORED, roster);
    expect(roster[0].pos).toEqual({ col: 2, row: 2 });
    expect(roster[1].pos).toEqual({ col: 2, row: 3 });
    // The default goal is injected ahead of the authored closing-gate.
    expect(staged.objectives.map((o) => o.spec.kind)).toEqual(["eliminate-all", "closing-gate"]);
  });

  it("resets combat-scoped transient state on the placed roster", () => {
    const u = player("a", { hp: 20 });
    u.ct = 99;
    u.captured = true;
    stageEncounter(PROCEDURAL, [u]);
    expect(u.ct).toBe(0);
    expect(u.captured).toBe(false);
    expect(u.statuses).toEqual([]);
  });

  it("isAuthoredEncounter discriminates the union", () => {
    expect(isAuthoredEncounter(AUTHORED)).toBe(true);
    expect(isAuthoredEncounter(PROCEDURAL)).toBe(false);
  });
});

// --- encounterOutcome truth table (D50/D51) ---------------------------------

function fakeObjective(required: boolean, status: ObjectiveStatus): ArmedObjective {
  return { spec: { id: status, kind: "eliminate-all", required, label: status }, status: () => status, progress: () => undefined };
}

function staged(players: Unit[], enemies: Unit[], objectives: ArmedObjective[]): StagedEncounter {
  const battle = new Battle(new TileGrid(8, 6, []), [...players, ...enemies]);
  return { battle, objectives, source: PROCEDURAL };
}

describe("encounterOutcome (D50/D51)", () => {
  const hero = () => player("hero");
  const foe = () => createUnit({ id: "foe", side: "enemy", pos: { col: 6, row: 2 }, speed: 9, maxHp: 10, attack: 4, defense: 1, moveRange: 2, sightRadius: 4, attackRange: 1 });

  it("win: all required met, players standing", () => {
    const s = staged([hero()], [], [fakeObjective(true, "met")]);
    expect(encounterOutcome(s)).toBe("win");
  });

  it("objective-failure: a required objective failed (enemies may still stand)", () => {
    const s = staged([hero()], [foe()], [fakeObjective(true, "failed")]);
    expect(encounterOutcome(s)).toBe("objective-failure");
  });

  it("wipe: no combat-capable player remains (precedence over a failed objective)", () => {
    const down = hero();
    down.alive = false;
    const s = staged([down], [foe()], [fakeObjective(true, "failed")]);
    expect(encounterOutcome(s)).toBe("wipe");
  });

  it("pending: a required objective is still undecided", () => {
    const s = staged([hero()], [foe()], [fakeObjective(true, "pending")]);
    expect(encounterOutcome(s)).toBeUndefined();
  });

  it("an optional failure does NOT downgrade a win", () => {
    const s = staged([hero()], [], [fakeObjective(true, "met"), fakeObjective(false, "failed")]);
    expect(encounterOutcome(s)).toBe("win");
  });
});
