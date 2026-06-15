import { describe, it, expect } from "vitest";
import { TileGrid } from "./grid";
import { planMove, planAttack, forecastAttack, flankTiles } from "./planning";
import { createUnit, type Side, type Unit } from "./units";

function at(id: string, side: Side, col: number, row: number, moveRange = 3, attackRange = 1): Unit {
  return createUnit({ id, side, pos: { col, row }, speed: 10, maxHp: 10, attack: 5, defense: 0, moveRange, sightRadius: 6, attackRange });
}

describe("planMove", () => {
  it("returns the path clamped to the unit's effective move", () => {
    const actor = at("a", "player", 0, 0, 3);
    const path = planMove(actor, { col: 5, row: 0 }, [actor], new TileGrid(8, 1));
    expect(path).toEqual([{ col: 1, row: 0 }, { col: 2, row: 0 }, { col: 3, row: 0 }]);
  });

  it("returns null when the destination is the unit's own tile (no move)", () => {
    const actor = at("a", "player", 2, 0);
    expect(planMove(actor, { col: 2, row: 0 }, [actor], new TileGrid(8, 1))).toBeNull();
  });
});

describe("planAttack", () => {
  it("attacks in place when already in range", () => {
    const actor = at("a", "player", 0, 0);
    const foe = at("f", "enemy", 1, 0);
    expect(planAttack(actor, foe, [actor, foe], new TileGrid(8, 1))).toEqual({ path: [], attackTarget: foe });
  });

  it("attacks from range without closing for a ranged unit", () => {
    const actor = at("a", "player", 0, 0, 3, 2);
    const foe = at("f", "enemy", 2, 0);
    expect(planAttack(actor, foe, [actor, foe], new TileGrid(8, 1))).toEqual({ path: [], attackTarget: foe });
  });

  it("closes to one tile short and strikes when it lands in range", () => {
    const actor = at("a", "player", 0, 0, 3, 1);
    const foe = at("f", "enemy", 4, 0);
    const plan = planAttack(actor, foe, [actor, foe], new TileGrid(8, 1));
    expect(plan).toEqual({ path: [{ col: 1, row: 0 }, { col: 2, row: 0 }, { col: 3, row: 0 }], attackTarget: foe });
  });

  it("moves but does not strike when the foe stays out of reach", () => {
    const actor = at("a", "player", 0, 0, 1, 1);
    const foe = at("f", "enemy", 5, 0);
    const plan = planAttack(actor, foe, [actor, foe], new TileGrid(8, 1));
    expect(plan).toEqual({ path: [{ col: 1, row: 0 }], attackTarget: null });
  });
});

describe("forecastAttack", () => {
  it("forecasts base damage on an isolated foe (no flank)", () => {
    const actor = at("a", "player", 0, 0); // atk 5
    const foe = at("f", "enemy", 4, 0); // def 0, hp 10
    const f = forecastAttack(actor, foe, [actor, foe], new TileGrid(8, 1));
    expect(f).toEqual({ damage: 5, lethal: false, flank: false });
  });

  it("flags a lethal strike when the best damage drops the foe", () => {
    const actor = at("a", "player", 0, 0);
    const foe = createUnit({ id: "f", side: "enemy", pos: { col: 4, row: 0 }, speed: 10, maxHp: 4, attack: 5, defense: 0, moveRange: 3, sightRadius: 6, attackRange: 1 });
    expect(forecastAttack(actor, foe, [actor, foe], new TileGrid(8, 1))?.lethal).toBe(true);
  });

  it("returns null when the foe can't be reached and struck this turn", () => {
    const actor = at("a", "player", 0, 0, 1, 1); // move 1, melee
    const foe = at("f", "enemy", 6, 0);
    expect(forecastAttack(actor, foe, [actor, foe], new TileGrid(8, 1))).toBeNull();
  });

  it("restores the actor's position after scanning strike tiles", () => {
    const actor = at("a", "player", 0, 0, 3, 1);
    const foe = at("f", "enemy", 4, 0);
    forecastAttack(actor, foe, [actor, foe], new TileGrid(8, 1));
    expect(actor.pos).toEqual({ col: 0, row: 0 });
  });

  it("detects an available flank (two blades on a lone foe)", () => {
    const a = at("a", "player", 0, 0); // adjacent west of the foe
    const b = at("b", "player", 2, 0); // adjacent east of the foe — two attacker bodies
    const foe = at("f", "enemy", 1, 0);
    const f = forecastAttack(a, foe, [a, b, foe], new TileGrid(8, 3));
    expect(f?.flank).toBe(true);
    expect(f!.damage).toBeGreaterThan(5); // base 5 + flank bonus
  });
});

describe("flankTiles", () => {
  it("lists the in-place tile when standing there already flanks", () => {
    const a = at("a", "player", 0, 0, 0); // no move budget — only the current tile
    const b = at("b", "player", 2, 0);
    const foe = at("f", "enemy", 1, 0);
    expect(flankTiles(a, [a, b, foe], new TileGrid(8, 3))).toContainEqual({ col: 0, row: 0 });
  });

  it("is empty for a ranged unit (can't flank)", () => {
    const a = at("a", "player", 0, 0, 3, 2);
    const b = at("b", "player", 2, 0);
    const foe = at("f", "enemy", 1, 0);
    expect(flankTiles(a, [a, b, foe], new TileGrid(8, 3))).toEqual([]);
  });

  it("is empty with no second blade to gang up", () => {
    const a = at("a", "player", 0, 0);
    const foe = at("f", "enemy", 1, 0);
    expect(flankTiles(a, [a, foe], new TileGrid(8, 3))).toEqual([]);
  });
});
