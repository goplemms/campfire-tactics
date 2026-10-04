import { describe, it, expect } from "vitest";
import { createUnit, type Unit, type Side } from "./units";
import { Battle } from "./turn";
import { TileGrid } from "./grid";
import { makeSupplyCrate, isSupplyCrate, takenCrates } from "./entities";
import { FIELD_FINDS, getFieldFind } from "./field-finds";
import { effectiveMove } from "./combat";
import { SURE_FOOTED, SWIFT, swift, applyStatus, hasStatus, tickStatuses } from "./status";

/**
 * The supply crate + its field find: a fixed board spot whose find the first player unit onto it puts
 * on, gaining a fight-long status. The undo case is the one that catches a desync (the find is a status
 * on the unit + two flags on the entity, and all three must roll back together).
 */

const at = (id: string, side: Side, col: number, row: number): Unit =>
  createUnit({ id, side, pos: { col, row }, speed: 10, maxHp: 10, attack: 1, defense: 0, moveRange: 3, sightRadius: 8, attackRange: 1 });

// A 6×1 corridor with the crate at (2,0).
function setup() {
  const grid = new TileGrid(6, 1);
  const runner = at("runner", "player", 0, 0);
  const grunt = at("grunt", "enemy", 5, 0);
  const battle = new Battle(grid, [runner, grunt]);
  battle.entities.register(makeSupplyCrate("crate", { col: 2, row: 0 }, "smugglers-wraps"));
  const crate = () => battle.entities.all().find(isSupplyCrate)!;
  return { battle, runner, grunt, crate };
}

describe("supply crate (field finds)", () => {
  it("the first player unit onto the crate puts the find on: +1 move for the rest of the fight", () => {
    const { battle, runner, crate } = setup();
    expect(effectiveMove(runner)).toBe(3);
    battle.moveUnit(runner, [{ col: 1, row: 0 }, { col: 2, row: 0 }]);
    expect(crate().pickedUp).toBe(true);
    expect(crate().takenBy).toBe("runner");
    expect(hasStatus(runner, SURE_FOOTED)).toBe(true);
    expect(effectiveMove(runner)).toBe(4);
    // Fight-long: turn ticks never expire it.
    for (let i = 0; i < 20; i++) tickStatuses(runner);
    expect(effectiveMove(runner)).toBe(4);
  });

  it("an ENEMY walking over the crate takes nothing", () => {
    const { battle, grunt, crate } = setup();
    battle.moveUnit(grunt, [{ col: 4, row: 0 }, { col: 3, row: 0 }, { col: 2, row: 0 }]);
    expect(crate().pickedUp).toBe(false);
    expect(hasStatus(grunt, SURE_FOOTED)).toBe(false);
  });

  it("one-shot: a second player unit onto the emptied crate gains nothing", () => {
    const { battle, runner, crate } = setup();
    const second = at("second", "player", 3, 0);
    battle.units.push(second);
    battle.moveUnit(runner, [{ col: 1, row: 0 }, { col: 2, row: 0 }]);
    battle.moveUnit(runner, [{ col: 1, row: 0 }]);
    battle.moveUnit(second, [{ col: 2, row: 0 }]);
    expect(crate().takenBy).toBe("runner");
    expect(hasStatus(second, SURE_FOOTED)).toBe(false);
  });

  it("stacks with Swift instead of replacing it (its own status id)", () => {
    const { battle, runner } = setup();
    applyStatus(runner, swift(1, 2));
    battle.moveUnit(runner, [{ col: 1, row: 0 }, { col: 2, row: 0 }]);
    expect(hasStatus(runner, SWIFT)).toBe(true);
    expect(effectiveMove(runner)).toBe(3 + 2 + 1);
  });

  it("UNDO puts the find back in the crate: status, pickedUp and takenBy all roll back", () => {
    const { battle, runner, crate } = setup();
    battle.beginUndo();
    battle.moveUnit(runner, [{ col: 1, row: 0 }, { col: 2, row: 0 }]);
    expect(takenCrates(battle.entities)).toHaveLength(1);
    battle.undo();
    expect(hasStatus(runner, SURE_FOOTED)).toBe(false);
    expect(crate().pickedUp).toBe(false);
    expect(crate().takenBy).toBeUndefined();
    expect(takenCrates(battle.entities)).toHaveLength(0);
    // …and it can be taken again after the undo.
    battle.moveUnit(runner, [{ col: 1, row: 0 }, { col: 2, row: 0 }]);
    expect(crate().takenBy).toBe("runner");
  });

  it("an unknown find id fails loud at staging, not silently as an empty crate", () => {
    expect(() => makeSupplyCrate("c", { col: 0, row: 0 }, "no-such-find")).toThrow(/unknown field find/);
  });

  it("the registry resolves every find, and each confers a fight-long buff", () => {
    for (const def of Object.values(FIELD_FINDS)) {
      expect(getFieldFind(def.id)).toBe(def);
      const s = def.confers();
      expect(s.kind).toBe("buff");
      expect(s.duration).toBe(Infinity);
    }
  });
});
