import { describe, it, expect } from "vitest";
import {
  createCamp,
  applyCampSkill,
  applyCampToParty,
  moraleTier,
} from "./camp";
import { LEVELING, grantAbilityUseXp } from "./leveling";
import { EventBus } from "./events";
import { getJob } from "./jobs";
import { createUnit, type Side, type Unit } from "./units";
import type { SkillDef } from "./skills";

function unit(id: string, side: Side, hp: number, maxHp: number): Unit {
  return createUnit({
    id,
    side,
    pos: { col: 0, row: 0 },
    hp,
    speed: 10,
    maxHp,
    attack: 5,
    defense: 0,
    moveRange: 3,
    sightRadius: 4,
  });
}

// A costless morale camp skill (the old Cook Stew shape) — a fixture for the camp morale
// resolver tests, decoupled from the real Cook kit (Cook Stew is now a provisionMeal, D71).
const cookSkill: SkillDef = {
  id: "fx-stew", name: "Fixture Stew", description: "", phase: "meta", target: "party", range: 0, spend: "act",
  usesPerNode: 1, effect: { kind: "morale", morale: 1, partyHeal: 8 },
};

describe("camp economy + morale (Merchant / Chef, Meta phase)", () => {
  it("the Merchant ships its overworld trade verbs, none gold-minting (D61 retired Trade / D70 kit)", () => {
    // D61: the Merchant is ACCESS + SELL (market verbs), not a +gold camp skill. D70 gives it
    // its overworld kit (Find Trade / Savvy Barter) — neither mints gold (openMarket / primeDeal).
    const effects = getJob("merchant")!.skills.map((s) => s.effect.kind);
    expect(effects).toEqual(["openMarket", "primeDeal"]);
  });

  it("Chef's Cook Stew raises morale and banks a heal", () => {
    const camp = createCamp();
    const out = applyCampSkill(cookSkill, camp);
    expect(out.morale).toBe(1);
    expect(out.bankedHeal).toBe(8);
    expect(camp.morale).toBe(1);
    expect(camp.pendingHeal).toBe(8);
  });

  it("applyCampSkill + grantAbilityUseXp: the effect lands AND the owner levels (D32/D53)", () => {
    // Canonical primitives behind the old `useCampJobSkill` composite (deleted #128):
    // in production this pairing lives inside `useOverworldSkill`.
    const chef = unit("chef", "player", 20, 20);
    const camp = createCamp();
    const before = chef.xp;
    const out = applyCampSkill(cookSkill, camp);
    const levels = grantAbilityUseXp(chef);
    // The camp effect still lands…
    expect(camp.morale).toBe(1);
    expect(out.bankedHeal).toBe(8);
    // …and the actor gained ability-use XP from its signature action.
    expect(chef.xp).toBe(before + LEVELING.abilityUseBonus);
    expect(typeof levels).toBe("number");
  });

  it("rejects a non-camp effect", () => {
    const battleSkill: SkillDef = {
      id: "x",
      name: "x",
      description: "",
      phase: "battle",
      target: "enemy",
      range: 1,
      spend: "act",
      effect: { kind: "damage", bonusAttack: 1 },
    };
    expect(() => applyCampSkill(battleSkill, createCamp())).toThrow();
  });

  it("bands morale into tiers (asymmetric — shallow floor)", () => {
    expect(moraleTier(-2)).toBe("Low");
    expect(moraleTier(0)).toBe("Neutral");
    expect(moraleTier(1)).toBe("High");
    expect(moraleTier(5)).toBe("Inspired");
  });
});

describe("applyCampToParty (the Chef buff lands at battle start)", () => {
  it("heals living player units by the banked amount, caps, then clears the bank", () => {
    const camp = createCamp({ pendingHeal: 8 });
    const rook = unit("Rook", "player", 20, 30);
    const vale = unit("Vale", "player", 25, 24 + 4); // hp 25 / max 28 → +3 to cap
    vale.hp = 26;
    vale.maxHp = 28;
    const foe = unit("Grunt", "enemy", 10, 20);
    const dead = unit("Dead", "player", 0, 30);
    dead.alive = false;

    const bus = new EventBus();
    const healEvents: number[] = [];
    bus.on("unitHealed", ({ amount }) => healEvents.push(amount));

    const total = applyCampToParty(camp, [rook, vale, foe, dead], bus);

    expect(rook.hp).toBe(28); // 20 + 8
    expect(vale.hp).toBe(28); // capped at maxHp (26 + 8 → 28)
    expect(foe.hp).toBe(10); // enemies unaffected
    expect(dead.hp).toBe(0); // the fallen aren't healed
    expect(total).toBe(8 + 2);
    expect(healEvents).toEqual([8, 2]);
    expect(camp.pendingHeal).toBe(0); // bank spent
  });

  it("does nothing with no banked heal", () => {
    const camp = createCamp({ pendingHeal: 0 });
    const rook = unit("Rook", "player", 20, 30);
    expect(applyCampToParty(camp, [rook])).toBe(0);
    expect(rook.hp).toBe(20);
  });
});
