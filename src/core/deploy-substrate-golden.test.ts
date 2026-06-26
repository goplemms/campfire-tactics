/**
 * D67 — characterization safety net for the deployment substrate.
 *
 * Pins, for a fixed seed + scenario, the exact deploy turn order and the per-front-turn
 * capture outcomes. The clock fold landed (`DeployClock` → the one `CTClock` carrying the
 * front as a strict-lead tempo source); this trace is the guard it kept **byte-identical** —
 * if it ever diverges, the tie rule or the seed fold is wrong. Also documents that the deploy
 * move budget reads `effectiveMove` (so a Swift-style buff extends reach).
 *
 * Pure logic: no Phaser, no DOM.
 */
import { describe, it, expect } from "vitest";
import { createDeployClock, createFront, createCampfire, resolveFrontTurn } from "./deployment";
import { Rng } from "./rng";
import { TileGrid } from "./grid";
import { reachableTiles } from "./ai";
import { effectiveMove } from "./combat";
import { applyStatus, swift } from "./status";
import { createUnit, type Side, type Unit } from "./units";

function unit(id: string, side: Side, pos: { col: number; row: number }, speed: number): Unit {
  return createUnit({
    id,
    side,
    pos,
    awareness: 2,
    speed,
    maxHp: 20,
    attack: 5,
    defense: 1,
    moveRange: 3,
    sightRadius: 4,
  });
}

/** Drive the deploy clock for a fixed scenario, recording the turn order + front outcomes. */
function deployTrace(): string[] {
  const grid = new TileGrid(8, 5);
  const party = [
    unit("bram", "player", { col: 4, row: 2 }, 12), // forward — first into the net
    unit("vale", "player", { col: 3, row: 2 }, 8),
    unit("cob", "player", { col: 2, row: 2 }, 6),
  ];
  const front = createFront(grid, [unit("ogre", "enemy", { col: 7, row: 2 }, 12)]);
  const camp = createCampfire(grid, party);
  const clock = createDeployClock(party, front); // the unified CTClock + front tempo source
  const rng = new Rng(7); // one shared stream, like the battle's RNG seam
  const trace: string[] = [];
  clock.seedFlat();
  for (let i = 0; i < 24; i++) {
    const t = clock.nextTurn();
    if (t.kind !== "unit") {
      // the front leads (tempo) — or idle, which the always-charging front never hits
      const out = resolveFrontTurn(front, camp, party, rng);
      trace.push(`FRONT r${out.advancedTo}${out.captured ? ` caught ${out.captured.id}` : ""}`);
      clock.spendTempo();
      if (out.alarm) break; // first catch raises the alarm → combat begins
    } else {
      trace.push(t.unit.id);
      clock.spend(t.unit, { acted: false }); // a deploy reposition
    }
  }
  return trace;
}

describe("D67 — deployment substrate characterization (golden)", () => {
  it("pins the deploy turn order + front capture outcomes (the clock-fold guard)", () => {
    expect(deployTrace()).toMatchInlineSnapshot(`
      [
        "bram",
        "FRONT r1 caught bram",
      ]
    `);
  });

  it("is deterministic — the same seed + scenario replays identically", () => {
    expect(deployTrace()).toEqual(deployTrace());
  });

  it("deploy reach honors effectiveMove — a Swift buff extends it past raw moveRange", () => {
    const grid = new TileGrid(9, 9);
    const u = unit("scout", "player", { col: 4, row: 4 }, 10);
    applyStatus(u, swift(1, 2)); // +2 move while Swift
    expect(u.moveRange).toBe(3);
    expect(effectiveMove(u)).toBe(5); // 3 + 2
    // The deploy clamp reads moveBudget = effectiveMove (the substrate fold), so the Swift
    // buff widens deploy reach exactly as it does in combat — the two budgets differ:
    const byMoveRange = reachableTiles(u, [u], grid, u.moveRange).length;
    const byEffective = reachableTiles(u, [u], grid, effectiveMove(u)).length;
    expect(byEffective).toBeGreaterThan(byMoveRange);
  });
});
