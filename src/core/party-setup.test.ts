import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import { memberFromJob } from "./jobs";
import { routeCombatXp, setUnitLevel, LEVELING } from "./leveling";
import { applyPartySetup, partySetupIssues, isEmptySetup } from "./party-setup";

/**
 * The encounter-start party setup: "this party, but…". The level lever must grow a body exactly the
 * way the campaign does (otherwise "the finale at level 5" measures a party nobody can field), and a
 * setup that names something that isn't there must refuse before it changes anything.
 */

const soldier = (): Unit => createUnit(memberFromJob("edrin", "Edrin", "soldier", { isLord: true }));
const hunter = (): Unit => createUnit(memberFromJob("rook", "Rook", "hunter"));
const statsOf = (u: Unit) => ({
  maxHp: u.maxHp, attack: u.attack, defense: u.defense, speed: u.speed, moveRange: u.moveRange,
  sightRadius: u.sightRadius, attackRange: u.attackRange,
});

describe("setUnitLevel", () => {
  it("raising grows the same body the campaign's XP routing grows", () => {
    const trained = soldier();
    routeCombatXp(trained, LEVELING.xpPerLevel * 4); // L1 → L5 on both axes
    const set = soldier();
    setUnitLevel(set, 5);
    expect(set.level).toBe(5);
    expect(set.jobLevels.soldier.level).toBe(5);
    expect(statsOf(set)).toEqual(statsOf(trained));
    expect(set.loadoutSlots).toBe(trained.loadoutSlots); // the L5 loadout boon
  });

  it("lowering is the exact inverse: up to 8 and back to 1 restores the level-1 body", () => {
    const u = hunter();
    const base = statsOf(u);
    setUnitLevel(u, 8);
    expect(statsOf(u)).not.toEqual(base);
    setUnitLevel(u, 1);
    expect(statsOf(u)).toEqual(base);
    expect(u.level).toBe(1);
    expect(u.loadoutSlots).toBe(1);
  });

  it("refuses a non-integer or sub-1 level", () => {
    expect(() => setUnitLevel(soldier(), 0)).toThrow(/whole number/);
    expect(() => setUnitLevel(soldier(), 2.5)).toThrow(/whole number/);
  });
});

describe("applyPartySetup", () => {
  it("an empty setup changes nothing", () => {
    const party = [soldier(), hunter()];
    const before = JSON.stringify(party);
    expect(isEmptySetup({})).toBe(true);
    applyPartySetup(party, {});
    expect(JSON.stringify(party)).toBe(before);
  });

  it("a party level keeps each unit's wounds as a fraction of the new max", () => {
    const u = soldier();
    u.hp = Math.round(u.maxHp / 2);
    applyPartySetup([u], { level: 6 });
    expect(u.level).toBe(6);
    expect(u.hp).toBe(Math.round(u.maxHp / 2));
  });

  it("an HP percentage overrides the kept fraction; a per-unit tweak overrides the party-wide one", () => {
    const a = soldier();
    const b = hunter();
    a.hp = 1;
    b.hp = 1;
    applyPartySetup([a, b], { hpPct: 100, units: { rook: { hpPct: 50, level: 3 } } });
    expect(a.hp).toBe(a.maxHp);
    expect(b.level).toBe(3);
    expect(a.level).toBe(1);
    expect(b.hp).toBe(Math.round(b.maxHp / 2));
  });

  it("per-unit stats are absolute and land after levelling; an empty item id clears the slot", () => {
    const u = hunter();
    u.equipment = { weapon: "wayfarer-blade" };
    applyPartySetup([u], { level: 4, units: { rook: { stats: { attackRange: 5, maxHp: 50 }, equipment: { weapon: "" } } } });
    expect(u.attackRange).toBe(5);
    expect(u.maxHp).toBe(50);
    expect(u.equipment.weapon).toBeUndefined();
    applyPartySetup([u], { units: { rook: { equipment: { weapon: "wayfarer-blade" } } } });
    expect(u.equipment.weapon).toBe("wayfarer-blade");
  });

  it("refuses everything it can't apply, by name, before changing anything", () => {
    const party = [soldier(), hunter()];
    const before = JSON.stringify(party);
    const bad = {
      level: 99,
      hpPct: 0,
      units: {
        nobody: { level: 2 },
        rook: { stats: { luck: 3 } as never, equipment: { weapon: "no-such-blade", armor: "wayfarer-blade" } },
      },
    };
    const issues = partySetupIssues(party, bad);
    expect(issues.join("\n")).toMatch(/level must be a whole number 1–30, got 99/);
    expect(issues.join("\n")).toMatch(/HP % must be 1–100, got 0/);
    expect(issues.join("\n")).toMatch(/no party unit "nobody" \(party: edrin, rook\)/);
    expect(issues.join("\n")).toMatch(/unknown stat "luck"/);
    expect(issues.join("\n")).toMatch(/unknown item "no-such-blade"/);
    expect(issues.join("\n")).toMatch(/goes in the weapon slot, not armor/);
    expect(() => applyPartySetup(party, bad)).toThrow(/party setup:/);
    expect(JSON.stringify(party)).toBe(before);
  });
});
