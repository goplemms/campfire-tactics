import { describe, it, expect } from "vitest";
import { createUnit, primaryJobOf, type Unit, type UnitSpec } from "./units";
import { getJob, stampPassives, unitSkills, type JobDef, type JobId, type JobLookup } from "./jobs";
import { SOLDIER } from "./jobs-data/combat";
import { jobLevelOf } from "./leveling";
import { prestige, eligibleGrants, applyGrant, type Grant, type PredicateCtx } from "./grants";
import { rpPerNight, computeUpkeep, UPKEEP } from "./upkeep";
import { marketTierBonus } from "./overworld";
import { describeUnit } from "./node-events";
import type { SkillDef } from "./skills";
import type { RunState } from "./run";

// --- Throwaway fixture jobs (never real class content, never in JOBS) --------
// They resolve only through an injected lookup, so passives/skills can be
// asserted without polluting the registry.

function fixSkill(id: string): SkillDef {
  return { id, name: id, description: "", phase: "battle", target: "enemy", range: 1, spend: "act", effect: { kind: "damage", bonusAttack: 0 } };
}

const FIX_BASE: JobDef = {
  id: "fix-base",
  name: "Fixture Base",
  description: "throwaway",
  passives: { "fix-base-passive": 7 },
  skills: [fixSkill("fix-base-strike")],
};
const FIX_ELITE: JobDef = {
  id: "fix-elite",
  name: "Fixture Elite",
  description: "throwaway",
  passives: { "fix-elite-passive": 9 },
  skills: [fixSkill("fix-elite-cut"), fixSkill("fix-elite-guard")],
};
const FIXTURES: Record<string, JobDef> = { "fix-base": FIX_BASE, "fix-elite": FIX_ELITE };

/** A fixture-aware lookup: fixtures first, real jobs as a fallback. */
const lookup: JobLookup = (id) => (id == null ? undefined : FIXTURES[id] ?? getJob(id));

const BASE = "fix-base" as JobId;
const ELITE = "fix-elite" as JobId;

function unit(spec: Partial<UnitSpec> = {}): Unit {
  return createUnit({
    id: "u",
    side: "player",
    pos: { col: -1, row: -1 },
    speed: 10,
    maxHp: 24,
    attack: 8,
    defense: 2,
    moveRange: 4,
    sightRadius: 5,
    ...spec,
  });
}

const ctx = { run: {} as RunState } as PredicateCtx;

describe("prestige — replace-in-place (D65)", () => {
  it("evolves the job in the SAME slot, carrying the level, with evolved passives/skills; jobId stays frozen", () => {
    const u = unit({ jobId: BASE, jobLevels: { "fix-base": { level: 4, xp: 30 } } });
    stampPassives(u, lookup);
    expect(u.passives).toEqual({ "fix-base-passive": 7 });

    const res = prestige(u, BASE, ELITE, lookup);
    expect(res).toEqual({ kind: "prestige", ok: true, from: BASE, into: ELITE });

    // Same slot — replace, not stack; the old job is gone.
    expect(u.heldJobs).toEqual([ELITE]);
    expect(u.primaryJob).toBe(ELITE);
    // The frozen original class never changes (the identity/authoring anchor).
    expect(u.jobId).toBe(BASE);

    // The level carries — the evolved job *is* the job evolved.
    expect(u.jobLevels[ELITE]).toEqual({ level: 4, xp: 30 });
    expect(u.jobLevels[BASE]).toBeUndefined();
    expect(jobLevelOf(u, ELITE)).toBe(4);

    // Passives + skills are the EVOLVED job's (the standardized readers go via primaryJobOf).
    expect(u.passives).toEqual({ "fix-elite-passive": 9 });
    expect(unitSkills(u, undefined, lookup).map((s) => s.id)).toEqual(["fix-elite-cut", "fix-elite-guard"]);
  });

  it("chains — an evolved job can itself prestige again (tier 1 → 2 → 3)", () => {
    const FIX_T2: JobDef = { id: "fix-t2", name: "T2", description: "", passives: { t2: 1 }, skills: [fixSkill("t2")] };
    const FIX_T3: JobDef = { id: "fix-t3", name: "T3", description: "", passives: { t3: 1 }, skills: [fixSkill("t3")] };
    const chainLookup: JobLookup = (id) => (id == null ? undefined : ({ "fix-t1": { id: "fix-t1", name: "T1", description: "", skills: [] }, "fix-t2": FIX_T2, "fix-t3": FIX_T3 } as Record<string, JobDef>)[id] ?? getJob(id));
    const u = unit({ jobId: "fix-t1" as JobId, jobLevels: { "fix-t1": { level: 2, xp: 0 } } });

    expect(prestige(u, "fix-t1" as JobId, "fix-t2" as JobId, chainLookup).ok).toBe(true);
    expect(u.primaryJob).toBe("fix-t2");
    expect(prestige(u, "fix-t2" as JobId, "fix-t3" as JobId, chainLookup).ok).toBe(true);
    expect(u.primaryJob).toBe("fix-t3");
    expect(u.heldJobs).toEqual(["fix-t3"]);
    expect(u.jobLevels["fix-t3"]).toEqual({ level: 2, xp: 0 }); // level carried the whole chain
  });

  it("prestiging a NON-primary held job leaves the primary (and its passives) untouched", () => {
    const u = unit({ jobId: "soldier", heldJobs: ["soldier", BASE], jobLevels: { "fix-base": { level: 3, xp: 0 } } });
    stampPassives(u); // primary = soldier
    const soldierPassives = { ...u.passives };

    const res = prestige(u, BASE, ELITE, lookup);
    expect(res.ok).toBe(true);
    expect(u.primaryJob).toBe("soldier"); // unchanged — fix-base wasn't primary
    expect(u.heldJobs).toEqual(["soldier", ELITE]); // evolved in its own slot
    expect(u.jobLevels[ELITE]).toEqual({ level: 3, xp: 0 });
    expect(u.passives).toEqual(soldierPassives); // re-stamped off the (unchanged) primary
  });
});

describe("prestige — guards (D65)", () => {
  it("refuses (no-op) if the unit doesn't hold `from`", () => {
    const u = unit({ jobId: "soldier" });
    const before = { primaryJob: u.primaryJob, heldJobs: [...u.heldJobs] };
    const res = prestige(u, BASE, ELITE, lookup);
    expect(res.ok).toBe(false);
    expect(u.primaryJob).toBe(before.primaryJob);
    expect(u.heldJobs).toEqual(before.heldJobs);
  });

  it("refuses (no-op) if the unit already holds `into`", () => {
    const u = unit({ jobId: "soldier", heldJobs: ["soldier", ELITE] });
    const res = prestige(u, "soldier", ELITE, lookup);
    expect(res.ok).toBe(false);
    expect(u.heldJobs).toEqual(["soldier", ELITE]); // unchanged
    expect(u.primaryJob).toBe("soldier");
  });
});

describe("prestige — agency: eligibility never auto-applies (D65)", () => {
  it("meeting the floor makes a grant eligible but does NOT mutate the unit until applied", () => {
    const u = unit({ jobId: BASE, jobLevels: { "fix-base": { level: 5, xp: 0 } } });
    const grant: Grant = { when: { kind: "jobLevel", job: BASE, min: 5 }, then: { kind: "prestige", from: BASE, into: ELITE } };

    const eligible = eligibleGrants(u, [grant], ctx);
    expect(eligible).toHaveLength(1);
    // Crossing the threshold did nothing on its own — agency requires an explicit apply.
    expect(u.primaryJob).toBe(BASE);
    expect(u.heldJobs).toEqual([BASE]);

    applyGrant(grant, u, {} as RunState, lookup);
    expect(u.primaryJob).toBe(ELITE); // only now
  });
});

// --- The standardization regression: the jobId → primaryJob landmine ---------
// All seven mechanic-driving readers are accounted for here. stampPassives /
// unitSkills are covered above via fixtures; rpPerNight / hasChef / marketTierBonus /
// describeUnit are exercised below with PRESTIGED units (real jobs whose
// primaryJob ≠ jobId) — proving each reads primaryJobOf, not the frozen jobId.
// merchantSell shares the same `primaryJobOf(u) === "merchant"` broker idiom
// (economy-actions.ts), so that assertion covers it by standardization.
// (The non-prestiged regression below cannot catch under-scoping, since for a
// normal unit primaryJobOf === jobId.)

describe("jobId → primaryJob standardization (D65) — closes the silent no-op", () => {
  it("a non-prestiged unit's passives + skills are UNCHANGED by the standardization", () => {
    const u = unit({ jobId: "soldier" });
    stampPassives(u);
    expect(u.passives).toEqual(SOLDIER.passives);
    expect(unitSkills(u)).toEqual(SOLDIER.skills);
    // primaryJobOf === jobId for a normal unit, so the read is identical to before.
    expect(primaryJobOf(u)).toBe("soldier");
  });

  it("rpPerNight reads the prestiged (primary) job, not the frozen jobId", () => {
    const plain = unit({ id: "p", jobId: "soldier" });
    expect(rpPerNight([plain])).toBe(0); // soldier banks no rest points

    const medicked = unit({ id: "m", jobId: "soldier" });
    prestige(medicked, "soldier", "medic"); // real-job target via getJob
    expect(medicked.jobId).toBe("soldier"); // frozen
    expect(rpPerNight([medicked])).toBe(getJob("medic")!.restPoints); // reads primaryJobOf
  });

  it("the Cook food discount follows the prestiged job (hasCook via computeUpkeep)", () => {
    const u = unit({ jobId: "soldier" });
    prestige(u, "soldier", "cook");
    const food = computeUpkeep([u]).lines.find((l) => l.id === "food")!;
    expect(food.cost).toBe(UPKEEP.cookFoodPerUnit); // discounted — hasCook saw primaryJob = cook
  });

  it("Appraisal (marketTierBonus) follows the prestiged job", () => {
    const plain = unit({ id: "p", jobId: "soldier" });
    expect(marketTierBonus([plain])).toBe(0);

    const merch = unit({ id: "m", jobId: "soldier" });
    prestige(merch, "soldier", "merchant");
    expect(merch.jobId).toBe("soldier"); // frozen
    expect(marketTierBonus([merch])).toBe(1); // reads primaryJobOf = merchant (Appraisal)
  });

  it("describeUnit names the prestiged (primary) job, not the frozen jobId", () => {
    const u = unit({ id: "d", jobId: "soldier" });
    expect(describeUnit(u)).toMatch(/^soldier /); // before: the original class

    prestige(u, "soldier", "merchant"); // real-job target via getJob
    expect(u.jobId).toBe("soldier"); // frozen original class
    expect(describeUnit(u)).toMatch(/^merchant /); // prose now leads with the evolved primary
  });
});
