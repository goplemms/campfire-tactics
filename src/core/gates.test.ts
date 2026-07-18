import { describe, it, expect } from "vitest";
import { TileGrid } from "./grid";
import { createUnit } from "./units";
import {
  makeGate, openGate, canLockpickGate, lockpickableGates, gatesOpenedByDeath,
  applyGatesToGrid, openGateOnGrid, isBreakable, canAttackGate, damageGate, breakableGates,
  makeLever, lockGateOnGrid, canPullLever, pullableLevers,
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

  it("destructible: makeGate seeds durability; damage chips it and breaks it at 0", () => {
    const door = makeGate("door", { col: 2, row: 2 }, [{ kind: "destructible", hp: 15 }]);
    expect(door.hp).toBe(15);
    expect(door.maxHp).toBe(15);
    expect(isBreakable(door)).toBe(true);
    expect(damageGate(door, 9)).toBe(false); // 15 → 6, holds
    expect(door.hp).toBe(6);
    expect(damageGate(door, 9)).toBe(true); // 6 → 0, breaks
    expect(door.hp).toBe(0);
    // A broken/open door is no longer breakable, and further damage is a no-op.
    openGate(door);
    expect(isBreakable(door)).toBe(false);
    expect(damageGate(door, 9)).toBe(false);
  });

  it("destructible: only a unit within attack range can hit it (any unit — a door isn't lockpick-gated)", () => {
    const door = makeGate("door", { col: 2, row: 2 }, [{ kind: "destructible", hp: 10 }]);
    expect(canAttackGate(door, soldier({ col: 2, row: 1 }))).toBe(true); // adjacent melee (range 1)
    expect(canAttackGate(door, soldier({ col: 2, row: 4 }))).toBe(false); // 2 tiles off, range 1
    const archer = createUnit({ id: "arc", name: "Arc", side: "player", pos: { col: 2, row: 4 }, jobId: "soldier", primaryJob: "soldier", ...STATS, attackRange: 3 });
    expect(canAttackGate(door, archer)).toBe(true); // in range at 2 with attackRange 3
    expect(breakableGates([door], soldier({ col: 2, row: 1 })).map((g) => g.id)).toEqual(["door"]);
    // A non-destructible gate is never breakable, even point-blank.
    const cell = makeGate("cell", { col: 2, row: 2 }, [{ kind: "lockpick" }]);
    expect(canAttackGate(cell, soldier({ col: 2, row: 1 }))).toBe(false);
  });

  it("lever: lockGateOnGrid re-seals + re-blocks a gate and restores a destructible door's durability", () => {
    const grid = new TileGrid(5, 5);
    const door = makeGate("door", { col: 2, row: 2 }, [{ kind: "destructible", hp: 20 }], false); // starts open
    expect(grid.isWalkable(door.pos)).toBe(true);
    damageGate(door, 8); // chipped to 12 while open (contrived) — sealing restores it
    lockGateOnGrid(grid, door);
    expect(door.locked).toBe(true);
    expect(grid.isWalkable(door.pos)).toBe(false); // tile re-blocked
    expect(door.hp).toBe(20); // a freshly-shut door is whole again
  });

  it("lever: canPullLever / pullableLevers is a reach test (on the switch or a step away)", () => {
    const lever = makeLever("switch", { col: 2, row: 2 }, ["door"]);
    expect(lever.targets).toEqual(["door"]);
    expect(canPullLever(lever, soldier({ col: 2, row: 1 }))).toBe(true); // adjacent
    expect(canPullLever(lever, soldier({ col: 2, row: 2 }))).toBe(true); // standing on it
    expect(canPullLever(lever, soldier({ col: 4, row: 4 }))).toBe(false); // too far
    expect(pullableLevers([lever], soldier({ col: 2, row: 1 })).map((l) => l.id)).toEqual(["switch"]);
  });
});
