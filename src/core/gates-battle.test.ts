import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import { stageEncounter } from "./staging";
import type { AuthoredEncounter } from "./authored";
import type { Gate } from "./gates";

/**
 * Gates wired into a real staged {@link Battle} (D103 Phase 2a) — the mechanic end to end:
 * a locked gate blocks its tile, a Thief opens it via the interact Act, defeating the keyholder
 * (the Captain) pops the keyholder cells, and undo re-locks. Proves the pure `gates.ts` primitives
 * come alive through staging + the Battle without a scene.
 */

const thief = () => createUnit({ id: "thief", side: "player", pos: { col: 0, row: 0 }, jobId: "thief", primaryJob: "thief", speed: 12, maxHp: 20, attack: 6, defense: 1, moveRange: 4, sightRadius: 5, attackRange: 1 });
const bruiser = () => createUnit({ id: "bruiser", side: "player", pos: { col: 0, row: 0 }, jobId: "soldier", primaryJob: "soldier", speed: 10, maxHp: 30, attack: 50, defense: 2, moveRange: 3, sightRadius: 5, attackRange: 1 });

/** A prison: a lockpick+keyholder cell at (4,2), a keyholder-only cell at (4,4), the Captain at (5,2). */
const PRISON: AuthoredEncounter = {
  id: "prison-test",
  name: "Prison Test",
  cols: 8,
  rows: 6,
  blocked: [],
  playerSpawns: [{ col: 3, row: 2 }, { col: 5, row: 3 }], // thief next to cell-a; bruiser next to the Captain
  enemies: [{ templateId: "bandit-captain", pos: { col: 5, row: 2 }, id: "warden", role: "captain", overrides: { maxHp: 1 } }],
  gates: [
    { id: "cell-a", pos: { col: 4, row: 2 }, openBy: [{ kind: "lockpick" }, { kind: "keyholder", tag: { role: "captain" } }] },
    { id: "cell-b", pos: { col: 4, row: 4 }, openBy: [{ kind: "keyholder", tag: { role: "captain" } }] },
  ],
  reward: { gold: 0, materials: [] },
};

const gate = (units: { gates: Gate[] }, id: string) => units.gates.find((g) => g.id === id)!;
const unit = (us: readonly Unit[], id: string) => us.find((u) => u.id === id)!;

describe("gates in a staged battle (D103 Phase 2a)", () => {
  it("a locked gate blocks its tile from turn one", () => {
    const { battle } = stageEncounter(PRISON, [thief(), bruiser()]);
    expect(battle.grid.isWalkable({ col: 4, row: 2 })).toBe(false);
    expect(battle.grid.isWalkable({ col: 4, row: 4 })).toBe(false);
    expect(gate(battle, "cell-a").locked).toBe(true);
  });

  it("a Thief opens an adjacent lockpick cell via the interact Act (tile clears + gateOpened fires)", () => {
    const { battle } = stageEncounter(PRISON, [thief(), bruiser()]);
    const cellA = gate(battle, "cell-a");
    let fired: string | null = null;
    battle.bus.on("gateOpened", ({ cause }) => (fired = cause));

    battle.openGate(cellA, unit(battle.units, "thief"));
    expect(cellA.locked).toBe(false);
    expect(battle.grid.isWalkable({ col: 4, row: 2 })).toBe(true);
    expect(fired).toBe("lockpick");
    expect(gate(battle, "cell-b").locked).toBe(true); // keyholder-only cell untouched
  });

  it("a non-adjacent or non-lockpick unit can't open it (a refused no-op)", () => {
    const { battle } = stageEncounter(PRISON, [thief(), bruiser()]);
    const cellA = gate(battle, "cell-a");
    battle.openGate(cellA, unit(battle.units, "bruiser")); // adjacent-ish but no lockpick capability
    expect(cellA.locked).toBe(true); // refused
  });

  it("defeating the Captain (keyholder) pops every keyholder cell", () => {
    const { battle } = stageEncounter(PRISON, [thief(), bruiser()]);
    const cellA = gate(battle, "cell-a");
    const cellB = gate(battle, "cell-b");
    battle.attack(unit(battle.units, "bruiser"), unit(battle.units, "warden"));
    expect(unit(battle.units, "warden").alive).toBe(false);
    expect(cellA.locked).toBe(false); // both keyholder-tagged cells open
    expect(cellB.locked).toBe(false);
    expect(battle.grid.isWalkable({ col: 4, row: 4 })).toBe(true);
  });

  it("undo re-locks a lockpicked gate and re-blocks its tile", () => {
    const { battle } = stageEncounter(PRISON, [thief(), bruiser()]);
    const cellA = gate(battle, "cell-a");
    battle.beginUndo();
    battle.openGate(cellA, unit(battle.units, "thief"));
    expect(cellA.locked).toBe(false);
    battle.undo();
    expect(cellA.locked).toBe(true); // re-locked
    expect(battle.grid.isWalkable({ col: 4, row: 2 })).toBe(false); // tile re-blocked
  });
});
