import { describe, it, expect } from "vitest";
import { TileGrid } from "./grid";
import { createUnit } from "./units";
import {
  makeGate, openGate, canLockpickGate, lockpickableGates, gatesOpenedByDeath,
  applyGatesToGrid, openGateOnGrid,
} from "./gates";

const STATS = { speed: 10, maxHp: 20, attack: 5, defense: 2, moveRange: 4, sightRadius: 5, attackRange: 1 };

/** A Thief carries the Expert Lockpick capability via its job; a plain soldier does not. */
const thief = (pos = { col: 0, row: 0 }) => createUnit({ id: "thief", name: "Thief", side: "player", pos, jobId: "thief", primaryJob: "thief", ...STATS });
const soldier = (pos = { col: 0, row: 0 }) => createUnit({ id: "sol", name: "Sol", side: "player", pos, jobId: "soldier", primaryJob: "soldier", ...STATS });
/** A bare enemy at a tile (optionally tagged), for the keyholder-death cases. */
const foe = (id: string, extra: Record<string, unknown> = {}) => createUnit({ id, name: id, side: "enemy", pos: { col: 0, row: 0 }, ...STATS, ...extra });

describe("gates (D103) — the prison-break substrate", () => {
  it("a locked gate blocks its tile; opening it clears the block", () => {
    const grid = new TileGrid(5, 5);
    const gate = makeGate("cell-1", { col: 2, row: 2 }, [{ kind: "lockpick" }]);
    expect(grid.isWalkable({ col: 2, row: 2 })).toBe(true);
    applyGatesToGrid(grid, [gate]);
    expect(grid.isWalkable({ col: 2, row: 2 })).toBe(false); // locked ⇒ impassable (encloses)
    openGateOnGrid(grid, gate);
    expect(gate.locked).toBe(false);
    expect(grid.isWalkable({ col: 2, row: 2 })).toBe(true); // open ⇒ a doorway
  });

  it("lockpick: only an adjacent Expert-Lockpick unit (the Thief) can pick it", () => {
    const gate = makeGate("cell-1", { col: 2, row: 2 }, [{ kind: "lockpick" }]);
    expect(canLockpickGate(gate, thief({ col: 2, row: 1 }))).toBe(true); // adjacent Thief
    expect(canLockpickGate(gate, thief({ col: 4, row: 4 }))).toBe(false); // Thief, but not adjacent
    expect(canLockpickGate(gate, soldier({ col: 2, row: 1 }))).toBe(false); // adjacent, but no capability
  });

  it("an already-open gate can't be re-picked, and a keyholder-only gate ignores lockpicks", () => {
    const open = makeGate("g", { col: 2, row: 2 }, [{ kind: "lockpick" }], false);
    expect(canLockpickGate(open, thief({ col: 2, row: 1 }))).toBe(false); // not locked
    const keyOnly = makeGate("cell-2", { col: 2, row: 2 }, [{ kind: "keyholder", tag: { role: "captain" } }]);
    expect(canLockpickGate(keyOnly, thief({ col: 2, row: 1 }))).toBe(false); // no lockpick condition
  });

  it("lockpickableGates lists exactly the gates the Thief can reach + pick", () => {
    const near = makeGate("a", { col: 2, row: 1 }, [{ kind: "lockpick" }]);
    const far = makeGate("b", { col: 4, row: 4 }, [{ kind: "lockpick" }]);
    const list = lockpickableGates([near, far], thief({ col: 2, row: 2 }));
    expect(list.map((g) => g.id)).toEqual(["a"]);
  });

  it("keyholder: defeating the tagged unit (the Captain) opens every matching locked cell", () => {
    const cellA = makeGate("cell-a", { col: 1, row: 1 }, [{ kind: "keyholder", tag: { role: "captain" } }, { kind: "lockpick" }]);
    const cellB = makeGate("cell-b", { col: 3, row: 1 }, [{ kind: "keyholder", tag: { role: "captain" } }]);
    const noKey = makeGate("cell-c", { col: 5, row: 1 }, [{ kind: "lockpick" }]);
    const gates = [cellA, cellB, noKey];

    const captain = foe("warden", { role: "captain" });
    const opened = gatesOpenedByDeath(gates, captain);
    expect(opened.map((g) => g.id).sort()).toEqual(["cell-a", "cell-b"]); // both keyholder cells, not the lockpick-only one

    // A non-captain death opens nothing.
    const thug = foe("thug");
    expect(gatesOpenedByDeath(gates, thug)).toEqual([]);

    // An already-open cell isn't re-opened (no double-fire).
    openGate(cellA);
    expect(gatesOpenedByDeath(gates, captain).map((g) => g.id)).toEqual(["cell-b"]);
  });

  it("keyholder matches by explicit id too, not just role", () => {
    const gate = makeGate("cell", { col: 1, row: 1 }, [{ kind: "keyholder", tag: { id: "the-warden" } }]);
    const warden = foe("the-warden");
    const other = foe("someone");
    expect(gatesOpenedByDeath([gate], warden).map((g) => g.id)).toEqual(["cell"]);
    expect(gatesOpenedByDeath([gate], other)).toEqual([]);
  });
});
