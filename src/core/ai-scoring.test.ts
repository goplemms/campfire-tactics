import { describe, it, expect } from "vitest";
import { planEnemyTurn } from "./ai";
import { TileGrid } from "./grid";
import { createUnit, type Side, type Unit } from "./units";
import { manhattan, isAdjacent, computeFlankBonus } from "./combat";
import { Battle } from "./turn";
import { stampPassives, getJob } from "./jobs";
import { getEnemyTemplate, BANDIT_TEMPLATES } from "./generation";
import { hasStatus } from "./status";

function at(
  id: string,
  side: Side,
  col: number,
  row: number,
  o: Partial<Unit> = {},
): Unit {
  const u = {
    ...createUnit({
      id,
      side,
      pos: { col, row },
      speed: 10,
      maxHp: 20,
      attack: 8,
      defense: 0,
      moveRange: 4,
      sightRadius: 8,
    }),
    ...o,
  };
  stampPassives(u);
  return u;
}

describe("scoring AI — ranged (D42)", () => {
  it("a ranged enemy attacks from range without closing", () => {
    const grid = new TileGrid(8, 1);
    const bowman = at("b", "enemy", 0, 0, { attackRange: 3 });
    const player = at("p", "player", 3, 0);
    const plan = planEnemyTurn(bowman, [bowman, player], grid);
    expect(plan.target).toBe(player);
    expect(plan.path).toEqual([]); // already in range — holds its ground
    expect(manhattan(plan.destination, player.pos)).toBeGreaterThan(1);
  });
});

describe("scoring AI — target priority (D42)", () => {
  it("prefers the squishy/wounded over the literally-nearest", () => {
    const grid = new TileGrid(6, 1);
    const enemy = at("e", "enemy", 2, 0);
    const beefy = at("beefy", "player", 3, 0, { maxHp: 40, hp: 40 });
    const squishy = at("squishy", "player", 1, 0, { maxHp: 10, hp: 8 });
    const plan = planEnemyTurn(enemy, [enemy, beefy, squishy], grid);
    expect(plan.target).toBe(squishy);
  });
});

describe("scoring AI — flank exploit + avoid (D42)", () => {
  it("moves to gang an isolated foe with a second blade (flank)", () => {
    const grid = new TileGrid(6, 6);
    const player = at("p", "player", 2, 2);
    const e1 = at("e1", "enemy", 1, 2); // already on the player's left
    const e2 = at("e2", "enemy", 4, 4); // swings around to flank
    const plan = planEnemyTurn(e2, [player, e1, e2], grid);
    expect(plan.target).toBe(player);
    expect(isAdjacent(plan.destination, player.pos)).toBe(true);
    // From the chosen tile the flank actually lands.
    const moved = { ...e2, pos: plan.destination };
    expect(computeFlankBonus(moved, player, [player, e1, moved])).toBeGreaterThan(0);
  });

  it("avoids ending isolated between two foes when a safer attacking tile exists", () => {
    const grid = new TileGrid(5, 5);
    const enemy = at("e", "enemy", 2, 0);
    const pa = at("pa", "player", 1, 2);
    const pb = at("pb", "player", 3, 2);
    const plan = planEnemyTurn(enemy, [enemy, pa, pb], grid);
    // (2,2) sits adjacent to BOTH players (flankable); the AI should pick a tile
    // adjacent to at most one.
    const foesAdjacent = [pa, pb].filter((p) => isAdjacent(plan.destination, p.pos)).length;
    expect(foesAdjacent).toBeLessThan(2);
  });
});

describe("scoring AI — tarpit-cost pathing (D42)", () => {
  it("routes around the Heavy Knight's ring rather than through it", () => {
    const grid = new TileGrid(6, 3);
    const enemy = at("e", "enemy", 0, 1, { moveRange: 5 });
    const player = at("p", "player", 4, 1);
    // Beefy so the squishy player stays the prize; ring includes (2,1).
    const knight = at("k", "player", 2, 2, { jobId: "heavy-knight", maxHp: 60, hp: 60, defense: 6 });
    stampPassives(knight);
    const plan = planEnemyTurn(enemy, [enemy, player, knight], grid);
    expect(plan.target).toBe(player);
    expect(isAdjacent(plan.destination, player.pos)).toBe(true);
    // The direct approach (2,1) is a tarpit ring tile — the route avoids it.
    expect(plan.path.some((t) => t.col === 2 && t.row === 1)).toBe(false);
  });
});

describe("scoring AI — fog-respecting (D42)", () => {
  it("acts only on seen foes; advances toward an unseen one (search)", () => {
    const grid = new TileGrid(8, 1);
    const enemy = at("e", "enemy", 0, 0, { sightRadius: 2, moveRange: 3 });
    const player = at("p", "player", 6, 0); // chebyshev 6 > sight 2 → unseen
    const plan = planEnemyTurn(enemy, [enemy, player], grid);
    expect(plan.target).toBeNull(); // can't act on what it can't see
    expect(plan.path.length).toBeGreaterThan(0); // but it advances to search
    expect(manhattan(plan.destination, player.pos)).toBeLessThan(manhattan(enemy.pos, player.pos));
  });
});

describe("bandit archetypes (D42/D44)", () => {
  it("registers the demo roster (thug · bowman · snare · sapper · captain)", () => {
    expect(getEnemyTemplate("bandit-bowman")?.attackRange).toBe(3);
    expect(getEnemyTemplate("bandit-captain")?.maxHp).toBeGreaterThan(40);
    expect(Object.keys(BANDIT_TEMPLATES)).toContain("snare-trapper");
    expect(getJob("snare-trapper")).toBeTruthy();
  });

  it("the Snare-Trapper applies a cleanse-worthy Immobilize via the AI", () => {
    const grid = new TileGrid(6, 1);
    const tpl = getEnemyTemplate("snare-trapper")!;
    const trapper = at("t", "enemy", 0, 0, { jobId: tpl.jobId, attackRange: 1 });
    const player = at("p", "player", 2, 0); // within Snare range 2, undebuffed
    const battle = new Battle(grid, [trapper, player]);
    trapper.ct = 100;
    const plan = planEnemyTurn(trapper, battle.units, grid);
    expect(plan.ability?.id).toBe("snare");
    expect(plan.target).toBe(player);
    battle.runPolicyTurn(trapper);
    expect(hasStatus(player, "immobilized")).toBe(true);
  });
});
