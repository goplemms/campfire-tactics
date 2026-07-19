import { describe, it, expect } from "vitest";
import { TileGrid } from "./grid";

describe("TileGrid", () => {
  it("reports its dimensions and treats fresh tiles as walkable", () => {
    const grid = new TileGrid(4, 3);
    expect(grid.cols).toBe(4);
    expect(grid.rows).toBe(3);
    expect(grid.isWalkable({ col: 0, row: 0 })).toBe(true);
    expect(grid.isWalkable({ col: 3, row: 2 })).toBe(true);
  });

  it("marks blocked tiles as unwalkable", () => {
    const grid = new TileGrid(4, 4, [{ col: 1, row: 1 }]);
    expect(grid.isWalkable({ col: 1, row: 1 })).toBe(false);
    expect(grid.isWalkable({ col: 1, row: 2 })).toBe(true);
  });

  it("treats out-of-bounds coordinates as neither in-bounds nor walkable", () => {
    const grid = new TileGrid(2, 2);
    expect(grid.inBounds({ col: -1, row: 0 })).toBe(false);
    expect(grid.inBounds({ col: 2, row: 0 })).toBe(false);
    expect(grid.isWalkable({ col: 0, row: 5 })).toBe(false);
  });

  it("returns only in-bounds, walkable, 4-connected neighbours", () => {
    const grid = new TileGrid(3, 3, [{ col: 1, row: 0 }]);
    // Corner tile (0,0): up is out of bounds, right (1,0) is blocked → only
    // down remains.
    expect(grid.walkableNeighbors({ col: 0, row: 0 })).toEqual([
      { col: 0, row: 1 },
    ]);
    // Centre tile (1,1): up (1,0) is blocked; the other three are open. Order
    // is up, right, down, left.
    expect(grid.walkableNeighbors({ col: 1, row: 1 })).toEqual([
      { col: 2, row: 1 },
      { col: 1, row: 2 },
      { col: 0, row: 1 },
    ]);
  });

  it("rejects non-positive dimensions", () => {
    expect(() => new TileGrid(0, 5)).toThrow();
    expect(() => new TileGrid(5, -1)).toThrow();
  });

  it("keeps permanent walls blocked even when the gate overlay is cleared (C1)", () => {
    // A gate that sits on a wall tile must not dissolve the terrain when opened:
    // setWalkable(true) only clears the runtime overlay, never the base wall.
    const grid = new TileGrid(3, 3, [{ col: 1, row: 1 }]);
    expect(grid.isWalkable({ col: 1, row: 1 })).toBe(false);
    grid.setWalkable({ col: 1, row: 1 }, true); // e.g. a gate on this tile opens
    expect(grid.isWalkable({ col: 1, row: 1 })).toBe(false); // wall still stands
  });

  it("toggles the gate overlay on a floor tile in both directions (C1)", () => {
    const grid = new TileGrid(3, 3); // no walls — a plain floor
    expect(grid.isWalkable({ col: 1, row: 1 })).toBe(true);
    grid.setWalkable({ col: 1, row: 1 }, false); // a locked gate blocks it
    expect(grid.isWalkable({ col: 1, row: 1 })).toBe(false);
    grid.setWalkable({ col: 1, row: 1 }, true); // the gate opens
    expect(grid.isWalkable({ col: 1, row: 1 })).toBe(true);
  });
});
