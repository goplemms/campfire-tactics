/**
 * The combat event log (D117 M2a) — the pure `exchangedDamageSince` window query, plus a
 * live-`Battle` suite proving the log is bus-fed, replay-reconstructed, and undo-truncated,
 * and that `in-combat` reads it correctly (the finale-critical "hit on a foe's turn ⇒
 * in-combat on my next turn" case + the self-clearing window).
 *
 * The window is `(a's last turnEnd, now]` — the replay-safe realization (only `turnEnd` is
 * apply-reachable; a `turnStart` fires outside `apply` and wouldn't reconstruct). So a unit
 * is engaged by **receiving** real damage since it last finished a turn.
 */
import { describe, it, expect } from "vitest";
import { Battle, replay } from "./turn";
import { TileGrid } from "./grid";
import { createUnit, type Side, type Unit } from "./units";
import { hasTag, IN_COMBAT } from "./tags";
import { exchangedDamageSince, type CombatLogEntry } from "./combat-log";

// --- pure query -------------------------------------------------------------

const dmg = (targetId: string, sourceId: string, amount = 5): CombatLogEntry => ({
  kind: "damage",
  time: 0,
  targetId,
  sourceId,
  amount,
});
const turnEnd = (unitId: string): CombatLogEntry => ({ kind: "turnEnd", time: 0, unitId });

describe("exchangedDamageSince — the in-combat clause-1 window", () => {
  it("false on an empty log", () => {
    expect(exchangedDamageSince([], "a", "b")).toBe(false);
  });

  it("true when a and b traded damage and a has not completed a turn (window = battle open)", () => {
    expect(exchangedDamageSince([dmg("b", "a")], "a", "b")).toBe(true); // a dealt to b
    expect(exchangedDamageSince([dmg("a", "b")], "a", "b")).toBe(true); // a received from b (either direction)
  });

  it("a 0-damage swing is not an exchange (the whiff the command log couldn't see)", () => {
    expect(exchangedDamageSince([dmg("a", "b", 0)], "a", "b")).toBe(false);
  });

  it("damage BEFORE a's last turnEnd is outside the window (self-clears on the clock)", () => {
    // b hit a, then a finished a turn → at a's next turn the hit is last-turn, excluded.
    expect(exchangedDamageSince([dmg("a", "b"), turnEnd("a")], "a", "b")).toBe(false);
  });

  it("damage AFTER a's last turnEnd is inside the window (received-damage engages)", () => {
    // a finished a turn, then b hit a → in window.
    expect(exchangedDamageSince([turnEnd("a"), dmg("a", "b")], "a", "b")).toBe(true);
  });

  it("stops at a's MOST RECENT turnEnd, not an older one", () => {
    // ... turnEnd a (old) · dmg · turnEnd a (recent) · [no dmg after] → false
    expect(
      exchangedDamageSince([turnEnd("a"), dmg("a", "b"), turnEnd("a")], "a", "b"),
    ).toBe(false);
  });

  it("is first-arg-anchored — same log, different window per first arg", () => {
    // turnEnd a · dmg(b→a) · turnEnd b : the hit is AFTER a's turnEnd but BEFORE b's.
    const log = [turnEnd("a"), dmg("a", "b"), turnEnd("b")];
    expect(exchangedDamageSince(log, "a", "b")).toBe(true); // in a's window
    expect(exchangedDamageSince(log, "b", "a")).toBe(false); // outside b's window
  });

  it("ignores a foe a never traded with", () => {
    expect(exchangedDamageSince([dmg("a", "c")], "a", "b")).toBe(false);
  });
});

// --- live Battle ------------------------------------------------------------

function at(id: string, side: Side, col: number, row: number, over: Partial<Unit> = {}): Unit {
  return {
    ...createUnit({ id, side, pos: { col, row }, speed: 10, maxHp: 40, attack: 6, defense: 1, moveRange: 4, sightRadius: 6 }),
    ...over,
  };
}
/** Adjacent hero (player) + foe (enemy), both melee, full HP — the engagement fixture. */
function duel(): { grid: TileGrid; hero: Unit; foe: Unit; battle: Battle } {
  const grid = new TileGrid(8, 1);
  const hero = at("hero", "player", 1, 0);
  const foe = at("foe", "enemy", 2, 0);
  return { grid, hero, foe, battle: new Battle(grid, [hero, foe]) };
}

describe("combat event log — live Battle", () => {
  it("is fed from the bus (damage + turnEnd) as combat resolves", () => {
    const { battle, hero, foe } = duel();
    battle.attack(foe, hero); // foe hits hero
    battle.endTurn(foe, { acted: true, moved: false });
    const log = battle.eventLog;
    expect(log.some((e) => e.kind === "damage" && e.targetId === "hero" && e.sourceId === "foe" && e.amount > 0)).toBe(true);
    expect(log.some((e) => e.kind === "turnEnd" && e.unitId === "foe")).toBe(true);
  });

  it("in-combat engages on damage RECEIVED since the unit's last turnEnd (the finale case)", () => {
    const { battle, hero, foe } = duel();
    battle.endTurn(hero, { acted: false, moved: false }); // hero's boundary
    battle.attack(foe, hero); // foe hits hero AFTER that boundary
    expect(hasTag(hero, IN_COMBAT, battle.tagContext())).toBe(true);
  });

  it("in-combat self-clears — a hit BEFORE the unit's last turnEnd does not engage", () => {
    const { battle, hero, foe } = duel();
    battle.attack(foe, hero); // foe hits hero
    battle.endTurn(hero, { acted: false, moved: false }); // ... then hero finishes a turn
    expect(hasTag(hero, IN_COMBAT, battle.tagContext())).toBe(false); // the hit is now last-turn
  });

  it("replay reconstructs the event log identically (derived, not a replay source)", () => {
    const { grid, battle } = duel();
    battle.seed();
    let guard = 0;
    while (!battle.outcome().over && guard++ < 200) {
      const actor = battle.nextActor();
      if (!actor) break;
      battle.runPolicyTurn(actor);
    }
    const replayed = replay(grid, [at("hero", "player", 1, 0), at("foe", "enemy", 2, 0)], battle.log);
    expect(replayed.eventLog).toEqual(battle.eventLog);
    expect(battle.eventLog.some((e) => e.kind === "damage" && e.amount > 0)).toBe(true); // the run actually traded blows
  });

  it("undo truncates the event log and flips in-combat back", () => {
    const { battle, hero, foe } = duel();
    battle.endTurn(hero, { acted: false, moved: false });
    battle.seed();
    battle.beginUndo();
    const before = battle.eventLog.length;
    battle.attack(foe, hero); // logs a damage event → hero now in-combat
    expect(battle.eventLog.length).toBeGreaterThan(before);
    expect(hasTag(hero, IN_COMBAT, battle.tagContext())).toBe(true);
    battle.undo();
    expect(battle.eventLog.length).toBe(before); // event truncated
    expect(hasTag(hero, IN_COMBAT, battle.tagContext())).toBe(false); // engagement rolled back
  });
});
