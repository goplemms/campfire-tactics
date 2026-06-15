import { describe, it, expect } from "vitest";
import {
  computeDamage,
  resolveAttack,
  battleOutcome,
  isAdjacent,
  isFlanked,
} from "./combat";
import { EventBus } from "./events";
import { createUnit, type Side, type Unit } from "./units";

function unit(id: string, side: Side, overrides: Partial<Unit> = {}): Unit {
  return {
    ...createUnit({
      id,
      side,
      pos: { col: 0, row: 0 },
      speed: 10,
      maxHp: 10,
      attack: 6,
      defense: 2,
      moveRange: 3,
      sightRadius: 4,
    }),
    ...overrides,
  };
}

describe("combat", () => {
  it("computes damage as attack minus defense, floored at 1", () => {
    const strong = unit("a", "player", { attack: 10 });
    const tanky = unit("b", "enemy", { defense: 3 });
    expect(computeDamage(strong, tanky)).toBe(7);

    const weak = unit("c", "player", { attack: 1 });
    const wall = unit("d", "enemy", { defense: 99 });
    expect(computeDamage(weak, wall)).toBe(1);
  });

  it("applies damage and emits onUnitDamaged", () => {
    const attacker = unit("att", "player", { attack: 5 });
    const defender = unit("def", "enemy", { defense: 1, hp: 10, maxHp: 10 });
    const bus = new EventBus();
    let damaged = 0;
    bus.on("unitDamaged", ({ amount }) => (damaged = amount));

    const dealt = resolveAttack(attacker, defender, bus);
    expect(dealt).toBe(4);
    expect(defender.hp).toBe(6);
    expect(damaged).toBe(4);
    expect(defender.alive).toBe(true);
  });

  it("defeats a unit at 0 HP and emits onUnitDefeated once", () => {
    const attacker = unit("att", "player", { attack: 100 });
    const defender = unit("def", "enemy", { hp: 5, maxHp: 5 });
    const bus = new EventBus();
    const defeated: string[] = [];
    bus.on("unitDefeated", ({ unit }) => defeated.push(unit.id));

    resolveAttack(attacker, defender, bus);
    expect(defender.hp).toBe(0);
    expect(defender.alive).toBe(false);
    expect(defeated).toEqual(["def"]);

    // Hitting a corpse doesn't re-fire defeat.
    resolveAttack(attacker, defender, bus);
    expect(defeated).toEqual(["def"]);
  });

  it("detects win/lose when a side is eliminated", () => {
    const p = unit("p", "player");
    const e = unit("e", "enemy");
    expect(battleOutcome([p, e])).toEqual({ over: false });

    e.alive = false;
    expect(battleOutcome([p, e])).toEqual({ over: true, winner: "player" });

    p.alive = false;
    expect(battleOutcome([p, e])).toEqual({ over: true });
  });

  it("treats a captured unit as not an active defender (D7)", () => {
    const rook = unit("rook", "player");
    const vale = unit("vale", "player", { captured: true });
    const foe = unit("foe", "enemy");

    // Rook still active → battle continues.
    expect(battleOutcome([rook, vale, foe])).toEqual({ over: false });

    // Rook falls; only a captured player unit remains → the enemy wins (Vale
    // becomes a rescue follow-up, not an active defender).
    rook.alive = false;
    expect(battleOutcome([rook, vale, foe])).toEqual({ over: true, winner: "enemy" });
  });

  it("knows orthogonal adjacency", () => {
    expect(isAdjacent({ col: 1, row: 1 }, { col: 1, row: 2 })).toBe(true);
    expect(isAdjacent({ col: 1, row: 1 }, { col: 2, row: 2 })).toBe(false);
    expect(isAdjacent({ col: 1, row: 1 }, { col: 1, row: 1 })).toBe(false);
  });
});

describe("isFlanked", () => {
  const victim = (col: number) => unit("v", "player", { pos: { col, row: 0 } });
  const foe = (id: string, col: number, over: Partial<Unit> = {}) => unit(id, "enemy", { pos: { col, row: 0 }, attackRange: 1, ...over });

  it("is flanked when ganged by two melee foes with no ally adjacent", () => {
    const v = victim(1);
    expect(isFlanked(v, [v, foe("a", 0), foe("b", 2)])).toBe(true);
  });

  it("is sheltered (not flanked) with an ally adjacent", () => {
    const v = victim(1);
    const ally = unit("c", "player", { pos: { col: 1, row: 1 } }); // adjacent above the victim
    expect(isFlanked(v, [v, foe("a", 0), foe("b", 2), ally])).toBe(false);
  });

  it("is not flanked by a single ordinary foe", () => {
    const v = victim(1);
    expect(isFlanked(v, [v, foe("a", 0)])).toBe(false);
  });

  it("is flanked by a lone solo-flanker (Scout)", () => {
    const v = victim(1);
    expect(isFlanked(v, [v, foe("a", 0, { passives: { flankSolo: 1 } })])).toBe(true);
  });

  it("is not flanked when both adjacent foes are ranged", () => {
    const v = victim(1);
    expect(isFlanked(v, [v, foe("a", 0, { attackRange: 2 }), foe("b", 2, { attackRange: 2 })])).toBe(false);
  });
});
