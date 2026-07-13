import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import type { JobId } from "./jobs";
import {
  LEVELING,
  grantXp,
  accrueDeployedXp,
  grantAbilityUseXp,
} from "./leveling";

function unit(id: string, jobId: JobId = "soldier"): Unit {
  return createUnit({
    id,
    side: "player",
    pos: { col: -1, row: -1 },
    jobId,
    speed: 10,
    maxHp: 24,
    attack: 8,
    defense: 2,
    moveRange: 4,
    sightRadius: 5,
  });
}

describe("leveling — the D32 seam (deployed grows, benched doesn't)", () => {
  it("a fresh unit starts at level 1 with 0 xp", () => {
    const u = unit("u");
    expect(u.level).toBe(1);
    expect(u.xp).toBe(0);
  });

  it("combat XP accumulates and increments level at the threshold", () => {
    const u = unit("u");
    expect(grantXp(u, LEVELING.xpPerLevel - 1)).toBe(0);
    expect(u.level).toBe(1);
    grantXp(u, 1);
    expect(u.level).toBe(2);
    expect(u.xp).toBe(0);
  });

  it("a big award can raise more than one level, carrying remainder", () => {
    const u = unit("u");
    const gained = grantXp(u, LEVELING.xpPerLevel * 2 + 5);
    expect(gained).toBe(2);
    expect(u.level).toBe(3);
    expect(u.xp).toBe(5);
  });

  it("deployed characters accrue the passive trickle; benched ones do NOT", () => {
    const deployed = [unit("a"), unit("b")];
    const benched = [unit("c")];

    accrueDeployedXp(deployed);
    for (const u of deployed) expect(u.xp).toBe(LEVELING.deployedTrickle);
    // The benched roster wasn't passed in — sitting in the guild is never training.
    for (const u of benched) expect(u.xp).toBe(0);
  });

  it("a successful non-combat ability use bumps the user (use-leveling hook)", () => {
    const u = unit("u");
    grantAbilityUseXp(u);
    expect(u.xp).toBe(LEVELING.abilityUseBonus);
  });

  it("the dead don't accrue the deployed trickle", () => {
    const u = unit("u");
    u.alive = false;
    accrueDeployedXp([u]);
    expect(u.xp).toBe(0);
  });

  it("a passiveXp job levels on the road; a combat job's job-level does NOT (D93)", () => {
    const cook = unit("cook", "cook"); // non-combat trade — levels passively
    const soldier = unit("sol", "soldier"); // combatant — job levels by fighting only

    accrueDeployedXp([cook, soldier]);

    // Both gain the CHARACTER trickle (breadth from travel is universal)...
    expect(cook.xp).toBe(LEVELING.deployedTrickle);
    expect(soldier.xp).toBe(LEVELING.deployedTrickle);
    // ...but only the passiveXp job's primary JOB accrues on the road.
    expect(cook.jobLevels.cook?.xp).toBe(LEVELING.deployedTrickle);
    expect(soldier.jobLevels.soldier).toBeUndefined();
  });
});
