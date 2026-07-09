import { describe, it, expect } from "vitest";
import { TileGrid } from "./grid";
import { createUnit, type Side, type Unit } from "./units";
import { Battle } from "./turn";
import {
  onSkillCooldown,
  armSkillCooldown,
  tickSkillCooldowns,
} from "./clock";
import { markOf, MARKED } from "./status";
import type { SkillDef } from "./skills";

function at(id: string, side: Side, col: number, row: number, o: Partial<Unit> = {}): Unit {
  return {
    ...createUnit({
      id,
      side,
      pos: { col, row },
      speed: 10,
      maxHp: 40,
      attack: 8,
      defense: 1,
      moveRange: 4,
      sightRadius: 5,
    }),
    ...o,
  };
}

const HEAL_CD: SkillDef = {
  id: "heal-cd",
  name: "Heal",
  description: "",
  target: "ally",
  range: 1,
  spend: "act",
  cost: { cooldown: 200 },
  effect: { kind: "heal", amount: 10 },
};

const MEND_CHARGED: SkillDef = {
  id: "mend",
  name: "Mend",
  description: "",
  target: "ally",
  range: 2,
  spend: "act",
  cost: { charge: 50 }, // gauge fills 50/tick → lands on the 2nd tick
  effect: { kind: "heal", amount: 16 },
};

const MARK: SkillDef = {
  id: "mark",
  name: "Mark Prey",
  description: "",
  target: "enemy",
  range: 3,
  spend: "act",
  effect: { kind: "channel" },
};

describe("ability economy (D37)", () => {
  it("a cooldown decrements by CT each tick and re-arms", () => {
    const u = at("u", "player", 0, 0, { speed: 10 });
    armSkillCooldown(u, "x", 25);
    expect(onSkillCooldown(u, "x")).toBe(true);
    tickSkillCooldowns(u, 10);
    expect(u.cooldowns["x"]).toBe(15);
    tickSkillCooldowns(u, 20); // overshoots → cleared
    expect(onSkillCooldown(u, "x")).toBe(false);
  });

  it("a cooldown blocks reuse until it burns down", () => {
    const grid = new TileGrid(4, 1);
    const medic = at("m", "player", 0, 0);
    const ally = at("a", "player", 1, 0, { hp: 1, maxHp: 40 });
    const dummy = at("d", "enemy", 3, 0);
    const battle = new Battle(grid, [medic, ally, dummy]);
    medic.ct = 100;

    const out = battle.useSkill(medic, HEAL_CD, ally);
    expect(out.healed).toBe(10);
    expect(battle.canUseSkill(medic, HEAL_CD)).toBe(false);

    // A second attempt while cooling down is refused (no further heal).
    const hp = ally.hp;
    const blocked = battle.useSkill(medic, HEAL_CD, ally);
    expect(blocked.healed).toBeUndefined();
    expect(ally.hp).toBe(hp);
  });

  it("a charged ability commits now and lands later on the clock", () => {
    const grid = new TileGrid(4, 1);
    const medic = at("m", "player", 0, 0);
    const ally = at("a", "player", 1, 0, { hp: 1, maxHp: 40 });
    const foe = at("f", "enemy", 3, 0);
    const battle = new Battle(grid, [medic, ally, foe]);
    medic.ct = 100;

    const out = battle.useSkill(medic, MEND_CHARGED, ally);
    expect(out.charging).toBe(true);
    expect(ally.hp).toBe(1); // not yet — it's in flight
    expect(battle.clock.isCharging(medic)).toBe(true);
    expect(battle.clock.pendingEffects()).toBe(1);

    battle.clock.tick(); // gauge 50
    expect(ally.hp).toBe(1);
    battle.clock.tick(); // gauge 100 → resolves
    expect(ally.hp).toBe(17);
    expect(battle.clock.pendingEffects()).toBe(0);
  });

  it("caster death fizzles an in-flight charge (it never resolves)", () => {
    const grid = new TileGrid(4, 1);
    const medic = at("m", "player", 0, 0);
    const ally = at("a", "player", 1, 0, { hp: 1, maxHp: 40 });
    const foe = at("f", "enemy", 3, 0);
    const battle = new Battle(grid, [medic, ally, foe]);
    medic.ct = 100;

    let fizzled = "";
    battle.bus.on("chargeFizzled", ({ id }) => (fizzled = id));

    battle.useSkill(medic, MEND_CHARGED, ally);
    medic.alive = false; // struck down mid-charge
    battle.clock.tick();
    battle.clock.tick();
    expect(ally.hp).toBe(1); // the heal fizzled
    expect(fizzled).toContain("mend");
  });

  it("a maintained-stance channel ramps on the prey and resets on target-switch", () => {
    const grid = new TileGrid(5, 1);
    const hunter = at("h", "player", 0, 0, { attack: 10, attackRange: 3 });
    const prey = at("p", "enemy", 2, 0, { defense: 0, hp: 100, maxHp: 100 });
    const other = at("o", "enemy", 4, 0, { defense: 0, hp: 100, maxHp: 100 });
    const battle = new Battle(grid, [hunter, prey, other]);
    hunter.ct = 100;

    battle.useSkill(hunter, MARK, prey);
    expect(markOf(hunter)?.id).toBe(MARKED);

    // First hit: ramp starts at 0 bonus, then climbs with each consecutive hit.
    const d1 = battle.attack(hunter, prey); // 10, +0 stack
    const d2 = battle.attack(hunter, prey); // +1 stack
    const d3 = battle.attack(hunter, prey); // +2 stacks
    expect(d1).toBe(10);
    expect(d2).toBeGreaterThan(d1);
    expect(d3).toBeGreaterThan(d2);

    // Switching prey re-locks the mark and resets the ramp to base damage.
    const onSwitch = battle.attack(hunter, other);
    expect(onSwitch).toBe(d1); // ramp reset — bonus gone on the new prey
    const next = battle.attack(hunter, other);
    expect(next).toBe(d1); // and rebuilds from zero (stack 0 → still base)
  });
});
