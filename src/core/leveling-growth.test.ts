import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import {
  LEVELING,
  grantJobXp,
  routeCombatXp,
  jobLevelOf,
  availableSkills,
  skillsUnlockedBetween,
  abilityScaleBonus,
  applyJobLevelGains,
} from "./leveling";
import { computeDamage } from "./combat";
import { HEAVY_KNIGHT_JOB } from "./jobs-data/combat";

function knight(id = "k"): Unit {
  return createUnit({
    id,
    side: "player",
    pos: { col: 0, row: 0 },
    jobId: "heavy-knight",
    speed: 12,
    maxHp: 34,
    attack: 11,
    defense: 4,
    moveRange: 4,
    sightRadius: 4,
  });
}

describe("hybrid leveling — per-job stat growth (D39)", () => {
  it("a job level-up banks +1-all plus the job's weighted bonus", () => {
    const k = knight();
    const before = { maxHp: k.maxHp, attack: k.attack, defense: k.defense, speed: k.speed };
    expect(grantJobXp(k, "heavy-knight", LEVELING.xpPerJobLevel)).toBe(1);
    expect(jobLevelOf(k, "heavy-knight")).toBe(2);
    // Knight growth = { maxHp: 3, defense: 1 } on top of the +1 floor.
    expect(k.maxHp).toBe(before.maxHp + 1 + 3);
    expect(k.defense).toBe(before.defense + 1 + 1);
    expect(k.attack).toBe(before.attack + 1); // floor only
    expect(k.speed).toBe(before.speed + 1);
  });

  it("a level-up grows a stat that then changes combat", () => {
    const k = knight();
    const foe = createUnit({ id: "f", side: "enemy", pos: { col: 1, row: 0 }, speed: 8, maxHp: 30, attack: 5, defense: 2, moveRange: 3, sightRadius: 4 });
    const before = computeDamage(k, foe);
    grantJobXp(k, "heavy-knight", LEVELING.xpPerJobLevel); // attack +1
    expect(computeDamage(k, foe)).toBe(before + 1);
  });

  it("the 2nd active gates on job level — locked at L1, unlocked at L2", () => {
    const k = knight();
    // availableSkills is the surfacing projection now (#123); filter to the job's own combat
    // skills (drop the universal Defend fold) to read the unlock gating.
    const jobIds = HEAVY_KNIGHT_JOB.skills.map((s) => s.id);
    const combatJobSkills = (u: Unit) => availableSkills(u, "combat").filter((s) => jobIds.includes(s.id)).map((s) => s.id);
    const atL1 = combatJobSkills(k);
    expect(atL1).toContain("cleave"); // unlockLevel 1
    expect(atL1).not.toContain("shove"); // unlockLevel 2 — still locked
    grantJobXp(k, "heavy-knight", LEVELING.xpPerJobLevel);
    const atL2 = combatJobSkills(k);
    expect(atL2).toContain("shove");
    expect(atL2.length).toBe(HEAVY_KNIGHT_JOB.skills.length);
  });

  it("skillsUnlockedBetween reports only the threshold just crossed (the unlock readout, D74)", () => {
    const scout = createUnit({ id: "vale", side: "player", pos: { col: 0, row: 0 }, jobId: "scout", speed: 14, maxHp: 24, attack: 9, defense: 2, moveRange: 5, sightRadius: 6 });
    // The Scout's L1→L2 newly unlocks Recon (combat dart) + Survey (overworld scout); Set Trap is L1.
    expect(skillsUnlockedBetween(scout, 1, 2).map((s) => s.id)).toEqual(["recon", "survey"]);
    // No threshold crossed in this span → nothing new.
    expect(skillsUnlockedBetween(scout, 2, 3)).toEqual([]);
  });

  it("ability magnitude scales with the primary job level", () => {
    const k = knight();
    expect(abilityScaleBonus(k)).toBe(0);
    grantJobXp(k, "heavy-knight", LEVELING.xpPerJobLevel * 2); // → L3
    expect(abilityScaleBonus(k)).toBe(2 * LEVELING.abilityScalePerLevel);
  });
});

describe("XP routing + generalist↔specialist (D39)", () => {
  it("routes character + primary at full rate; secondaries trickle", () => {
    const k = knight();
    k.heldJobs = ["heavy-knight", "scout"]; // holds a secondary
    routeCombatXp(k, LEVELING.xpPerLevel); // 100
    expect(k.level).toBe(2); // character full
    expect(jobLevelOf(k, "heavy-knight")).toBe(2); // primary full
    // Secondary earned only 25 XP (0.25 rate) — not enough to level.
    expect(jobLevelOf(k, "scout")).toBe(1);
    expect(k.jobLevels["scout"].xp).toBe(Math.floor(100 * LEVELING.secondaryRate));
  });

  it("a specialist banks deeper weighted stats than a generalist", () => {
    const spec = knight("spec");
    const gen = knight("gen");
    // Specialist: 3 levels deep in one job.
    for (let i = 0; i < 3; i++) applyJobLevelGains(spec, "heavy-knight");
    // Generalist: one level each in three jobs (broad +1 floors).
    applyJobLevelGains(gen, "heavy-knight");
    applyJobLevelGains(gen, "scout");
    applyJobLevelGains(gen, "medic");
    // Both banked the same number of +1 floors, but the specialist stacked the
    // Knight's HP weighting three times → a beefier body.
    expect(spec.maxHp).toBeGreaterThan(gen.maxHp);
  });
});

describe("character boons (D38/D39)", () => {
  it("grants a loadout slot at the boon threshold", () => {
    const k = knight();
    expect(k.loadoutSlots).toBe(1);
    routeCombatXp(k, LEVELING.xpPerLevel * 4); // → level 5 (the first boon)
    expect(k.level).toBe(5);
    expect(k.loadoutSlots).toBe(2);
  });
});
