import { describe, it, expect } from "vitest";
import {
  computeFlankBonus,
  computeDamage,
  adjacentBodies,
  FLANK,
  PASSIVE,
  inAttackRange,
} from "./combat";
import { createUnit, type Side, type Unit } from "./units";

function at(id: string, side: Side, col: number, row: number, o: Partial<Unit> = {}): Unit {
  return {
    ...createUnit({
      id,
      side,
      pos: { col, row },
      speed: 10,
      maxHp: 20,
      attack: 8,
      defense: 2,
      moveRange: 4,
      sightRadius: 5,
    }),
    ...o,
  };
}

describe("flanking (D36)", () => {
  it("grants the bonus when two of the attacker's side gang an isolated target", () => {
    const a = at("a", "player", 1, 2); // left of T
    const b = at("b", "player", 3, 2); // right of T
    const t = at("t", "enemy", 2, 2);
    const units = [a, b, t];
    expect(adjacentBodies(t, units, "player")).toBe(2);
    expect(computeFlankBonus(a, t, units)).toBe(FLANK.bonus);
    // It feeds the damage formula on top of atk−def.
    expect(computeDamage(a, t, a.attack, units)).toBe(8 - 2 + FLANK.bonus);
  });

  it("does NOT flank a target that keeps formation (an ally is adjacent)", () => {
    const a = at("a", "player", 1, 2);
    const b = at("b", "player", 3, 2);
    const t = at("t", "enemy", 2, 2);
    const guard = at("g", "enemy", 2, 1); // a friend beside T → sheltered
    const units = [a, b, t, guard];
    expect(computeFlankBonus(a, t, units)).toBe(0);
  });

  it("needs a second blade — a lone attacker doesn't flank by default", () => {
    const a = at("a", "player", 1, 2);
    const t = at("t", "enemy", 2, 2);
    expect(computeFlankBonus(a, t, [a, t])).toBe(0);
  });

  it("the Scout's Quiet Footsteps passive flanks solo (at the baseline bonus)", () => {
    const scout = at("s", "player", 1, 2, {
      passives: { [PASSIVE.quietFootsteps]: 1 },
    });
    const t = at("t", "enemy", 2, 2);
    expect(computeFlankBonus(scout, t, [scout, t])).toBe(FLANK.bonus);
  });

  it("is melee-only: a ranged attacker never flanks", () => {
    const a = at("a", "player", 1, 2, { attackRange: 3 });
    const b = at("b", "player", 3, 2);
    const t = at("t", "enemy", 2, 2);
    expect(computeFlankBonus(a, t, [a, b, t])).toBe(0);
  });

  it("counts an Immobilized body but not a captured/downed one", () => {
    const a = at("a", "player", 1, 2);
    const b = at("b", "player", 3, 2, { captured: true }); // bound → not a body
    const t = at("t", "enemy", 2, 2);
    expect(adjacentBodies(t, [a, b, t], "player")).toBe(1);
    expect(computeFlankBonus(a, t, [a, b, t])).toBe(0);
    b.captured = false;
    expect(computeFlankBonus(a, t, [a, b, t])).toBe(FLANK.bonus);
  });

  it("ranged reach is honored by inAttackRange", () => {
    const archer = at("ar", "player", 0, 0, { attackRange: 3 });
    const near = at("n", "enemy", 2, 0);
    const far = at("f", "enemy", 5, 0);
    expect(inAttackRange(archer, near)).toBe(true);
    expect(inAttackRange(archer, far)).toBe(false);
  });
});
