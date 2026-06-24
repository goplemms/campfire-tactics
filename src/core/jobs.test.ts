import { describe, it, expect } from "vitest";
import { JOBS, getJob, unitSkills, SOLDIER, type JobId } from "./jobs";
import { createUnit, type Side, type Unit } from "./units";

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
    expect(getJob("soldier")).toBe(SOLDIER);
    expect(JOBS["soldier"].name).toBe("Soldier");
    expect(getJob(undefined)).toBeUndefined();
    expect(getJob("nope")).toBeUndefined();
  });

  it("defines the Soldier's formation kit purely as data hooking the Battle phase", () => {
    const ids = SOLDIER.skills.map((s) => s.id);
    expect(ids).toContain("debilitating-strike");
    expect(ids).toContain("turtle-formation");
    for (const skill of SOLDIER.skills) {
      expect(skill.phase).toBe("battle");
      expect(["damage", "guard-allies"]).toContain(skill.effect.kind);
    }
    // Brother-in-arms is its passive identity anchor (D66).
    expect(SOLDIER.passives?.brotherInArms).toBe(1);
  });

  it("reads a unit's skills back via its jobId, filtered by phase", () => {
    const u = soldier("Rook");
    expect(unitSkills(u).length).toBe(2);
    expect(unitSkills(u, "battle").length).toBe(2);
    expect(unitSkills(u, "meta").length).toBe(0);

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

  it("ships the three signature jobs, each hooking a different phase (D3)", () => {
    expect(getJob("survivalist")!.skills[0].phase).toBe("deployment");
    expect(getJob("cook")!.skills[0].phase).toBe("meta");
    // The Merchant's gold-minting Trade camp skill was retired (D61); its kit is now the
    // overworld trade verbs (Find Trade / Savvy Barter, D70) — both hook the meta phase.
    expect(getJob("merchant")!.skills.map((s) => s.id)).toEqual(["find-trade", "savvy-barter"]);
    expect(getJob("merchant")!.skills.every((s) => s.phase === "meta")).toBe(true);

    // unitSkills filters a job's skills by the phase each one hooks.
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
    expect(unitSkills(withJob("Pip", "cook"), "meta").map((s) => s.id)).toEqual(["cook-stew", "feast"]);
    expect(unitSkills(withJob("Vale", "survivalist"), "deployment").map((s) => s.id)).toEqual(["set-trap"]);
    expect(unitSkills(withJob("Rook", "soldier"), "battle").length).toBe(2);
  });
});
