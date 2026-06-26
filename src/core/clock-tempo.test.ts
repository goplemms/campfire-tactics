/**
 * D67 clock fold (increment C1) — the `CTClock` tempo source reproduces `DeployClock`.
 *
 * Drives the **same** fixed scenario as `deploy-substrate-golden.test.ts`, but through a
 * unified {@link CTClock} carrying the front as a {@link TempoSource} (strict-lead tie)
 * instead of the bespoke {@link DeployClock}. It must yield the **byte-identical** trace —
 * the proof that the front folds onto the one clock without changing initiative. C2 then
 * retires `DeployClock` and repoints the golden test itself at this path.
 *
 * Pure logic: no Phaser, no DOM.
 */
import { describe, it, expect } from "vitest";
import { CTClock, type TempoSource } from "./clock";
import { DeployClock, createFront, createCampfire, resolveFrontTurn } from "./deployment";
import { Rng } from "./rng";
import { TileGrid } from "./grid";
import { createUnit, type Side, type Unit } from "./units";

function unit(id: string, side: Side, pos: { col: number; row: number }, speed: number): Unit {
  return createUnit({ id, side, pos, awareness: 2, speed, maxHp: 20, attack: 5, defense: 1, moveRange: 3, sightRadius: 4 });
}

function scenario() {
  const grid = new TileGrid(8, 5);
  const party = [
    unit("bram", "player", { col: 4, row: 2 }, 12), // forward — first into the net
    unit("vale", "player", { col: 3, row: 2 }, 8),
    unit("cob", "player", { col: 2, row: 2 }, 6),
  ];
  const front = createFront(grid, [unit("ogre", "enemy", { col: 7, row: 2 }, 12)]);
  const camp = createCampfire(grid, party);
  return { party, front, camp };
}

/** The reference trace, driven by the legacy DeployClock (mirrors the golden test). */
function deployClockTrace(): string[] {
  const { party, front, camp } = scenario();
  const clock = new DeployClock(party, front);
  const rng = new Rng(7);
  const trace: string[] = [];
  clock.seed();
  for (let i = 0; i < 24; i++) {
    const t = clock.next();
    if (t.isFront || !t.unit) {
      const out = resolveFrontTurn(front, camp, party, rng);
      trace.push(`FRONT r${out.advancedTo}${out.captured ? ` caught ${out.captured.id}` : ""}`);
      clock.spendFront();
      if (out.alarm) break;
    } else {
      trace.push(t.unit.id);
      clock.spend(t.unit, { acted: false });
    }
  }
  return trace;
}

/** The same trace, driven by the unified CTClock + a front tempo source. */
function ctClockTrace(): string[] {
  const { party, front, camp } = scenario();
  const tempo: TempoSource = { id: "front", ct: 0, speed: front.speed, strictLeadTie: true };
  const clock = new CTClock(party, undefined, tempo);
  const rng = new Rng(7);
  const trace: string[] = [];
  clock.seedFlat();
  for (let i = 0; i < 24; i++) {
    const t = clock.nextTurn();
    if (t.kind === "tempo") {
      const out = resolveFrontTurn(front, camp, party, rng);
      trace.push(`FRONT r${out.advancedTo}${out.captured ? ` caught ${out.captured.id}` : ""}`);
      clock.spendTempo();
      if (out.alarm) break;
    } else if (t.kind === "unit") {
      trace.push(t.unit.id);
      clock.spend(t.unit, { acted: false });
    } else {
      break; // idle — can't progress (won't happen with the front charging)
    }
  }
  return trace;
}

describe("D67 clock fold — CTClock tempo source == DeployClock (increment C1)", () => {
  it("reproduces the golden deploy trace byte-identically", () => {
    expect(ctClockTrace()).toEqual(["bram", "FRONT r1 caught bram"]);
  });

  it("matches the legacy DeployClock trace exactly", () => {
    expect(ctClockTrace()).toEqual(deployClockTrace());
  });
});
