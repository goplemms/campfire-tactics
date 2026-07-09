import { describe, it, expect } from "vitest";
import { resolveSkill, isValidSkillTarget, type SkillDef } from "./skills";
import { EventBus } from "./event-bus";
import { computeDamage } from "./combat";
import { isImmobilized } from "./status";
import { createUnit, type Side, type Unit } from "./units";

function at(id: string, side: Side, col: number, row: number, o: Partial<Unit> = {}): Unit {
  return {
    ...createUnit({
      id,
      side,
      pos: { col, row },
      speed: 10,
      maxHp: 30,
      attack: 8,
      defense: 2,
      moveRange: 3,
      sightRadius: 5,
    }),
    ...o,
  };
}

const powerStrike: SkillDef = {
  id: "power-strike",
  name: "Power Strike",
  description: "",
  target: "enemy",
  range: 1,
  spend: "act",
  effect: { kind: "damage", bonusAttack: 6 },
};

describe("resolveSkill", () => {
  it("damage effect hits harder than a basic attack and fires onUnitDamaged", () => {
    const hero = at("h", "player", 0, 0, { attack: 8 });
    const foe = at("f", "enemy", 1, 0, { defense: 2, hp: 30, maxHp: 30 });
    const bus = new EventBus();
    let dmgEvent = 0;
    bus.on("unitDamaged", ({ amount }) => (dmgEvent = amount));

    const basic = computeDamage(hero, foe); // 8 - 2 = 6
    const { damage } = resolveSkill(powerStrike, hero, foe, bus);
    expect(damage).toBe(basic + 6); // (8+6) - 2 = 12
    expect(foe.hp).toBe(18);
    expect(dmgEvent).toBe(12);
  });

  it("status effect applies a status to the target", () => {
    const hero = at("h", "player", 0, 0);
    const foe = at("f", "enemy", 1, 0);
    const hamstring: SkillDef = {
      ...powerStrike,
      id: "hamstring",
      effect: { kind: "status", status: { id: "immobilized", name: "Immobilized", duration: 2 } },
    };
    const out = resolveSkill(hamstring, hero, foe);
    expect(out.status).toBe("immobilized");
    expect(isImmobilized(foe)).toBe(true);
  });

  it("heal effect restores HP (capped at maxHp) and fires onUnitHealed", () => {
    const hero = at("h", "player", 0, 0, { hp: 5, maxHp: 30 });
    const bus = new EventBus();
    let healed = 0;
    bus.on("unitHealed", ({ amount }) => (healed = amount));
    const secondWind: SkillDef = {
      id: "second-wind",
      name: "Second Wind",
      description: "",
      target: "self",
      range: 0,
      spend: "act",
      effect: { kind: "heal", amount: 10 },
    };
    const out = resolveSkill(secondWind, hero, hero, bus);
    expect(out.healed).toBe(10);
    expect(hero.hp).toBe(15);
    expect(healed).toBe(10);

    // Cap at maxHp.
    hero.hp = 25;
    expect(resolveSkill(secondWind, hero, hero).healed).toBe(5);
    expect(hero.hp).toBe(30);
  });
});

describe("isValidSkillTarget", () => {
  it("enforces side, range, and self-targeting", () => {
    const hero = at("h", "player", 0, 0);
    const adjacentFoe = at("f1", "enemy", 1, 0);
    const farFoe = at("f2", "enemy", 5, 0);
    const ally = at("a", "player", 0, 1);

    expect(isValidSkillTarget(powerStrike, hero, adjacentFoe)).toBe(true);
    expect(isValidSkillTarget(powerStrike, hero, farFoe)).toBe(false); // out of range
    expect(isValidSkillTarget(powerStrike, hero, ally)).toBe(false); // wrong side
    expect(isValidSkillTarget(powerStrike, hero, hero)).toBe(false); // not self-target

    const selfSkill: SkillDef = { ...powerStrike, target: "self", range: 0 };
    expect(isValidSkillTarget(selfSkill, hero, hero)).toBe(true);
    expect(isValidSkillTarget(selfSkill, hero, ally)).toBe(false);

    const dead = at("d", "enemy", 1, 0, { alive: false });
    expect(isValidSkillTarget(powerStrike, hero, dead)).toBe(false);
  });
});
