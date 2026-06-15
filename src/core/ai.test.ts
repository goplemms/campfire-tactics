import { describe, it, expect } from "vitest";
import { planEnemyTurn, reachableTiles, forecastEnemyAction, threatenedTiles } from "./ai";
import { TileGrid } from "./grid";
import { isAdjacent } from "./combat";
import { applyStatus, immobilized } from "./status";
import { createUnit, type Side, type Unit } from "./units";

function at(id: string, side: Side, col: number, row: number, moveRange = 3): Unit {
  return createUnit({
    id,
    side,
    pos: { col, row },
    speed: 10,
    maxHp: 10,
    attack: 5,
    defense: 0,
    moveRange,
    sightRadius: 6,
  });
}

describe("planEnemyTurn", () => {
  it("moves toward the nearest enemy and attacks when it reaches adjacency", () => {
    const grid = new TileGrid(8, 1);
    const enemy = at("e", "enemy", 0, 0);
    const player = at("p", "player", 4, 0);
    const plan = planEnemyTurn(enemy, [enemy, player], grid);

    // From col 0 toward col 4: closes to col 3 (moveRange 3), adjacent to player.
    expect(plan.destination).toEqual({ col: 3, row: 0 });
    expect(plan.target).toBe(player);
    expect(isAdjacent(plan.destination, player.pos)).toBe(true);
    // Every step is a legal walkable tile.
    for (const step of plan.path) expect(grid.isWalkable(step)).toBe(true);
  });

  it("attacks without moving when already adjacent", () => {
    const grid = new TileGrid(8, 1);
    const enemy = at("e", "enemy", 3, 0);
    const player = at("p", "player", 4, 0);
    const plan = planEnemyTurn(enemy, [enemy, player], grid);
    expect(plan.path).toEqual([]);
    expect(plan.target).toBe(player);
  });

  it("picks the nearer of two enemies", () => {
    const grid = new TileGrid(10, 1);
    const enemy = at("e", "enemy", 5, 0);
    const near = at("near", "player", 7, 0);
    const far = at("far", "player", 0, 0);
    const plan = planEnemyTurn(enemy, [enemy, near, far], grid);
    expect(plan.target ?? near).toBe(near);
    expect(plan.destination).toEqual({ col: 6, row: 0 });
  });

  it("does not move while immobilized but still attacks an adjacent foe", () => {
    const grid = new TileGrid(8, 1);
    const enemy = at("e", "enemy", 0, 0);
    const player = at("p", "player", 4, 0);
    applyStatus(enemy, immobilized(2));
    const plan = planEnemyTurn(enemy, [enemy, player], grid);
    expect(plan.path).toEqual([]);
    expect(plan.destination).toEqual({ col: 0, row: 0 });
    expect(plan.target).toBeNull();
  });

  it("stays put when there are no enemies left", () => {
    const grid = new TileGrid(8, 1);
    const enemy = at("e", "enemy", 2, 0);
    const plan = planEnemyTurn(enemy, [enemy], grid);
    expect(plan.path).toEqual([]);
    expect(plan.target).toBeNull();
  });
});

describe("reachableTiles (shared by the AI + the render-side move preview)", () => {
  const keys = (rs: { tile: { col: number; row: number } }[]) =>
    new Set(rs.map((r) => `${r.tile.col},${r.tile.row}`));

  it("floods every tile within the move budget, including the start tile", () => {
    const grid = new TileGrid(7, 7);
    const u = at("u", "player", 3, 3, 2);
    const reach = reachableTiles(u, [u], grid);
    const k = keys(reach);
    expect(k.has("3,3")).toBe(true); // start, cost 0
    expect(k.has("3,1")).toBe(true); // 2 straight up
    expect(k.has("2,2")).toBe(true); // 1 left + 1 up
    expect(k.has("3,0")).toBe(false); // 3 away — beyond a budget of 2
    // The Manhattan disc of radius 2 on an open board is 13 tiles.
    expect(reach.length).toBe(13);
  });

  it("routes around other units (they block tiles) and honors the budget override", () => {
    const grid = new TileGrid(7, 1);
    const u = at("u", "player", 0, 0, 5);
    const wall = at("w", "player", 2, 0); // a friendly body blocks col 2
    const base = keys(reachableTiles(u, [u, wall], grid));
    expect(base.has("1,0")).toBe(true);
    expect(base.has("2,0")).toBe(false); // occupied
    expect(base.has("3,0")).toBe(false); // unreachable past the block on a 1-row map
    // A Swift-style budget override only widens what the default flood would reach.
    const wide = keys(reachableTiles(u, [u], grid, 6));
    expect(wide.has("6,0")).toBe(true);
  });

  it("returns only the start tile when immobilized (budget 0)", () => {
    const grid = new TileGrid(5, 5);
    const u = at("u", "player", 2, 2, 3);
    applyStatus(u, immobilized(2));
    const reach = reachableTiles(u, [u], grid);
    expect(reach.length).toBe(1);
    expect(reach[0].tile).toEqual({ col: 2, row: 2 });
  });
});

describe("forecastEnemyAction", () => {
  it("telegraphs who an enemy will strike, from where, and for how much", () => {
    const grid = new TileGrid(8, 1);
    const enemy = at("e", "enemy", 0, 0); // atk 5
    const player = at("p", "player", 4, 0); // def 0, hp 10
    const intent = forecastEnemyAction(enemy, [enemy, player], grid);
    expect(intent?.target).toBe(player);
    expect(intent?.destination).toEqual({ col: 3, row: 0 }); // closes to adjacency
    expect(intent?.damage).toBe(5);
    expect(intent?.lethal).toBe(false);
  });

  it("flags a lethal incoming strike", () => {
    const grid = new TileGrid(8, 1);
    const enemy = at("e", "enemy", 3, 0);
    const player = createUnit({ id: "p", side: "player", pos: { col: 4, row: 0 }, speed: 10, maxHp: 4, attack: 5, defense: 0, moveRange: 3, sightRadius: 6 });
    expect(forecastEnemyAction(enemy, [enemy, player], grid)?.lethal).toBe(true);
  });

  it("returns null when the enemy would only advance (no target in reach)", () => {
    const grid = new TileGrid(12, 1);
    const enemy = at("e", "enemy", 0, 0, 2); // move 2 — can't reach
    const player = at("p", "player", 10, 0);
    expect(forecastEnemyAction(enemy, [enemy, player], grid)).toBeNull();
  });

  it("does not permanently move the enemy", () => {
    const grid = new TileGrid(8, 1);
    const enemy = at("e", "enemy", 0, 0);
    const player = at("p", "player", 4, 0);
    forecastEnemyAction(enemy, [enemy, player], grid);
    expect(enemy.pos).toEqual({ col: 0, row: 0 });
  });
});

describe("threatenedTiles", () => {
  it("marks every tile a pinned melee enemy could strike", () => {
    const grid = new TileGrid(8, 3);
    const enemy = at("e", "enemy", 3, 0, 0); // moveRange 0 → strikes from its own tile only
    const keys = new Set(threatenedTiles([enemy], grid, "player").map((t) => `${t.col},${t.row}`));
    // the diamond within attack range 1 of (3,0), clipped to the board
    expect([...keys].sort()).toEqual(["2,0", "3,0", "3,1", "4,0"]);
  });

  it("is empty when the victim side has no enemies", () => {
    const grid = new TileGrid(8, 3);
    const ally = at("a", "player", 3, 0, 0);
    expect(threatenedTiles([ally], grid, "player")).toEqual([]);
  });
});
