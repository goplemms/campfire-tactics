import { describe, it, expect } from "vitest";
import { JOBS, getJob, unitSkills, SKILLS, getSkill, type JobId } from "./jobs";
import { SOLDIER_JOB } from "./jobs-data/combat";
import { UNIVERSAL_SKILLS, DEFEND } from "./jobs-data/support";
import { createUnit, type Side, type Unit } from "./units";
import { skillContexts, type SkillDef } from "./skills";
import { availableSkills } from "./leveling";

function soldier(id: string): Unit {
  return createUnit({
    id,
    side: "player",
    pos: { col: 0, row: 0 },
    jobId: "soldier",
    speed: 10,
    maxHp: 30,
    attack: 8,
    defense: 2,
    moveRange: 3,
    sightRadius: 5,
  });
}

describe("jobs (data-driven loading)", () => {
  it("loads the Soldier from the registry by id", () => {
    expect(getJob("soldier")).toBe(SOLDIER_JOB);
    expect(JOBS["soldier"].name).toBe("Soldier");
    expect(getJob(undefined)).toBeUndefined();
    expect(getJob("nope")).toBeUndefined();
  });

  it("defines the Soldier's formation kit purely as data surfacing in combat (#123: usableContext, not phase)", () => {
    const ids = SOLDIER_JOB.skills.map((s) => s.id);
    expect(ids).toContain("debilitating-strike");
    expect(ids).toContain("turtle-formation");
    for (const skill of SOLDIER_JOB.skills) {
      expect(skillContexts(skill)).toContain("combat");
      expect(["damage", "guard-allies"]).toContain(skill.effect.kind);
    }
    // Brother-in-arms is its passive identity anchor (D66).
    expect(SOLDIER_JOB.passives?.brotherInArms).toBe(1);
  });

  it("reads a unit's skills back via its jobId (the full authored set — surface filtering is availableSkills)", () => {
    const u = soldier("Rook");
    expect(unitSkills(u).length).toBe(2);
    expect(unitSkills(u).map((s) => s.id)).toEqual(["debilitating-strike", "turtle-formation"]);

    const jobless = createUnit({
      id: "x",
      side: "player",
      pos: { col: 0, row: 0 },
      speed: 10,
      maxHp: 10,
      attack: 5,
      defense: 0,
      moveRange: 3,
      sightRadius: 4,
    });
    expect(unitSkills(jobless)).toEqual([]);
  });

  it("ships the three signature jobs, each surfacing on a different context (#123: usableContext replaces phase)", () => {
    expect(skillContexts(getJob("survivalist")!.skills[0])).toEqual(["pre-combat"]); // Set Trap
    expect(skillContexts(getJob("cook")!.skills[0])).toEqual(["overworld"]); // Cook Stew
    // The Merchant's gold-minting Trade camp skill was retired (D61); its kit is now the
    // overworld trade verbs (Find Trade / Savvy Barter, D70) — both surface on the overworld.
    expect(getJob("merchant")!.skills.map((s) => s.id)).toEqual(["find-trade", "savvy-barter"]);
    expect(getJob("merchant")!.skills.every((s) => skillContexts(s).includes("overworld"))).toBe(true);

    // availableSkills surfaces a unit's skills by context (the one projection).
    const withJob = (id: string, job: JobId): Unit =>
      createUnit({
        id,
        side: "player" as Side,
        pos: { col: 0, row: 0 },
        jobId: job,
        speed: 10,
        maxHp: 10,
        attack: 5,
        defense: 0,
        moveRange: 3,
        sightRadius: 4,
      });
    expect(availableSkills(withJob("Pip", "cook"), "overworld").map((s) => s.id)).toEqual(["cook-stew", "feast"]);
    expect(availableSkills(withJob("Vale", "survivalist"), "pre-combat").map((s) => s.id)).toContain("set-trap");
    expect(availableSkills(withJob("Rook", "soldier"), "combat").map((s) => s.id)).toContain("debilitating-strike");
  });
});

// The global skill registry (R1 #111) — the skill-by-id log's resolution source.
describe("SKILLS — the global skill registry (R1 #111)", () => {
  it("derives every authored skill from JOBS + UNIVERSAL_SKILLS, resolvable by id", () => {
    const expected = new Set<string>();
    for (const job of Object.values(JOBS)) for (const s of job.skills) expected.add(s.id);
    for (const s of UNIVERSAL_SKILLS) expected.add(s.id);
    expect(Object.keys(SKILLS).sort()).toEqual([...expected].sort());
    // Resolution returns the exact authored def objects (by reference).
    expect(getSkill("defend")).toBe(DEFEND);
    expect(getSkill("heal")).toBe(JOBS.medic.skills[0]);
    expect(getSkill("nope")).toBeUndefined();
  });

  it("skill ids are collision-free — one id never names two distinct authored defs", () => {
    // The derivation throws at load on a collision; this pins the namespace invariant
    // (and names the offender if a future kit reuses an id for a *different* skill).
    const defsById = new Map<string, Set<SkillDef>>();
    const note = (s: SkillDef) => {
      if (!defsById.has(s.id)) defsById.set(s.id, new Set());
      defsById.get(s.id)!.add(s);
    };
    for (const job of Object.values(JOBS)) for (const s of job.skills) note(s);
    for (const s of UNIVERSAL_SKILLS) note(s);
    for (const [id, defs] of defsById) {
      expect(defs.size, `skill id "${id}" is claimed by ${defs.size} distinct defs`).toBe(1);
    }
  });
});
