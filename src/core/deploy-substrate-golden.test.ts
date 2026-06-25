/**
 * D67 increment 0 — characterization safety net for the deployment substrate.
 *
 * Pins, for a fixed seed + scenario, the exact `DeployClock` turn order and the per-front-turn
 * capture outcomes. The D67 clock fold (`DeployClock` → `CTClock`, the front as a strict-lead
 * tempo source) must keep this trace **byte-identical** — if it diverges, the tie rule or the
 * seed fold is wrong, and that increment alone should be reverted. Also documents that the
 * deploy move budget reads raw `moveRange` today (so increment 2's switch to `effectiveMove`
 * is a visible change only under a Swift-style buff).
 *
 * Pure logic: no Phaser, no DOM.
 */
import { describe, it, expect } from "vitest";
import { DeployClock, createFront, createCampfire, resolveFrontTurn } from "./deployment";
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
  const clock = new DeployClock(party, front);
  const rng = new Rng(7); // one shared stream, like the battle's RNG seam
  const trace: string[] = [];
  clock.seed();
  for (let i = 0; i < 24; i++) {
    const t = clock.next();
    if (t.isFront || !t.unit) {
      const out = resolveFrontTurn(front, camp, party, rng);
      trace.push(`FRONT r${out.advancedTo}${out.captured ? ` caught ${out.captured.id}` : ""}`);
      clock.spendFront();
      if (out.alarm) break; // first catch raises the alarm → combat begins
    } else {
      trace.push(t.unit.id);
      clock.spend(t.unit, { acted: false }); // a deploy reposition
    }
  }
  return trace;
}

describe("D67 increment 0 — deployment substrate characterization (golden)", () => {
  it("pins the DeployClock turn order + front capture outcomes (the clock-fold guard)", () => {
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

  it("deploy move budget reads raw moveRange today (Swift extends only effectiveMove)", () => {
    const grid = new TileGrid(9, 9);
    const u = unit("scout", "player", { col: 4, row: 4 }, 10);
    applyStatus(u, swift(1, 2)); // +2 move while Swift
    expect(u.moveRange).toBe(3);
    expect(effectiveMove(u)).toBe(5); // 3 + 2
    // Today the deploy clamp (BattleScene.ts:815 / :2098) passes raw moveRange; increment 2
    // switches it to effectiveMove, extending reach under a buff. The two budgets differ:
    const byMoveRange = reachableTiles(u, [u], grid, u.moveRange).length;
    const byEffective = reachableTiles(u, [u], grid, effectiveMove(u)).length;
    expect(byEffective).toBeGreaterThan(byMoveRange);
  });
});
