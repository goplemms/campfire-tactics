import { describe, it, expect } from "vitest";
import { advanceOutcome, adjacentRevealedTrap, noActionsAvailable } from "./battle-flow";
import { createUnit, type Unit, type Side } from "./units";
import { TileGrid } from "./grid";
import { EntityRegistry, makeConcealedTrap, type ConcealedTrap } from "./entities";
import { EventBus } from "./event-bus";

function unit(id: string, side: Side, over: Partial<Parameters<typeof createUnit>[0]> = {}): Unit {
  return createUnit({
    id, side, pos: { col: 0, row: 0 },
    speed: 10, maxHp: 30, attack: 6, defense: 0, moveRange: 4, sightRadius: 5,
    ...over,
  });
}
const reg = () => new EntityRegistry(new EventBus());
const revealed = (t: ConcealedTrap): ConcealedTrap => { t.revealed = true; return t; };

describe("advanceOutcome — the clock-advance branch (D60)", () => {
  it("a decided encounter resolves the battle, whatever the actor", () => {
    expect(advanceOutcome(unit("p", "player"), true).kind).toBe("finish");
  });

  it("an empty clock (no actor) resolves the battle", () => {
    expect(advanceOutcome(null, false).kind).toBe("finish");
  });

  it("a hidden actor just passes until scouted", () => {
    const amb = unit("amb", "enemy");
    amb.hidden = true;
    const out = advanceOutcome(amb, false);
    expect(out).toEqual({ kind: "ambushPass", actor: amb });
  });

  it("a visible enemy takes an AI turn", () => {
    expect(advanceOutcome(unit("e", "enemy"), false).kind).toBe("enemyTurn");
  });

  it("a player opens a free-move turn", () => {
    expect(advanceOutcome(unit("p", "player"), false).kind).toBe("playerTurn");
  });
});

describe("adjacentRevealedTrap — the disarm target scan", () => {
  it("finds a revealed, un-sprung trap within one tile", () => {
    const r = reg();
    r.register(revealed(makeConcealedTrap("t", { col: 1, row: 1 }, "enemy", 12, 4)));
    const actor = unit("h", "player", { pos: { col: 0, row: 0 } }); // chebyshev 1
    expect(adjacentRevealedTrap(actor, r)?.id).toBe("t");
  });

  it("ignores traps that are still concealed", () => {
    const r = reg();
    r.register(makeConcealedTrap("t", { col: 1, row: 1 }, "enemy", 12, 4)); // not revealed
    expect(adjacentRevealedTrap(unit("h", "player", { pos: { col: 0, row: 0 } }), r)).toBeUndefined();
  });

  it("ignores traps that are already sprung, and ones out of reach", () => {
    const r = reg();
    const sprung = revealed(makeConcealedTrap("s", { col: 1, row: 0 }, "enemy", 12, 4));
    sprung.sprung = true;
    r.register(sprung);
    r.register(revealed(makeConcealedTrap("far", { col: 3, row: 3 }, "enemy", 12, 4)));
    expect(adjacentRevealedTrap(unit("h", "player", { pos: { col: 0, row: 0 } }), r)).toBeUndefined();
  });
});

describe("noActionsAvailable — the D55 auto-pass backstop", () => {
  const grid = () => new TileGrid(8, 6);

  it("a unit that can move has actions", () => {
    const g = grid();
    const actor = unit("h", "player", { pos: { col: 3, row: 3 }, moveRange: 3 });
    expect(noActionsAvailable({ actor, units: [actor], grid: g, entities: reg(), hasGuild: false })).toBe(false);
  });

  it("a unit that can strike an adjacent foe has actions even when boxed in", () => {
    const g = grid();
    const actor = unit("h", "player", { pos: { col: 1, row: 1 }, moveRange: 0 });
    const foe = unit("e", "enemy", { pos: { col: 1, row: 2 } });
    expect(noActionsAvailable({ actor, units: [actor, foe], grid: g, entities: reg(), hasGuild: false })).toBe(false);
  });

  it("a boxed-in unit can still always Defend, so the backstop no longer fires (#123 flip)", () => {
    // A 1x1 grid pins the unit; no foes, no entities, no guild. The backstop now reads
    // availableSkills('combat') (the authoritative projection), which always offers the universal
    // Defend — so no combat turn is truly action-less. This is the increment-4 flip of the
    // increment-0 witness: unlockedSkills('battle') used to report "nothing to do" here.
    const g = new TileGrid(1, 1);
    const actor = unit("h", "player", { pos: { col: 0, row: 0 }, moveRange: 0 });
    expect(noActionsAvailable({ actor, units: [actor], grid: g, entities: reg(), hasGuild: false })).toBe(false);
  });

  it("the same stuck unit gains an action when a guild lets it bribe a living enemy", () => {
    const g = new TileGrid(1, 1);
    const actor = unit("h", "player", { pos: { col: 0, row: 0 }, moveRange: 0 });
    const foe = unit("e", "enemy", { pos: { col: 0, row: 0 } }); // off-grid for movement, but alive
    expect(noActionsAvailable({ actor, units: [actor, foe], grid: g, entities: reg(), hasGuild: true })).toBe(false);
  });

  it("a hidden trap on the field offers Search, so it's not a dead turn", () => {
    const g = new TileGrid(1, 1);
    const actor = unit("h", "player", { pos: { col: 0, row: 0 }, moveRange: 0 });
    const r = reg();
    r.register(makeConcealedTrap("t", { col: 5, row: 5 }, "enemy", 12, 4)); // concealed → Search available
    expect(noActionsAvailable({ actor, units: [actor], grid: g, entities: r, hasGuild: false })).toBe(false);
  });
});
