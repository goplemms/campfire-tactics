import { describe, it, expect } from "vitest";
import { createUnit, remember, type Unit, type UnitSpec } from "./units";
import { getJob, JOBS, type JobDef, type JobId, type JobLookup } from "./jobs";
import { prestige, prestigeOptions, eligiblePrestiges, type PredicateCtx } from "./grants";
import type { RunState } from "./run";

// --- Throwaway fixture jobs carrying prestige branches (never real content) ---
const T1: JobDef = {
  id: "t1", name: "T1", description: "", skills: [],
  prestige: [{ into: "t2" as JobId, when: { kind: "jobLevel", job: "t1" as JobId, min: 2 } }],
};
const T2: JobDef = {
  id: "t2", name: "T2", description: "", skills: [],
  prestige: [{ into: "t3" as JobId, when: { kind: "jobLevel", job: "t2" as JobId, min: 2 } }],
};
const T3: JobDef = { id: "t3", name: "T3", description: "", skills: [] }; // terminal — no branch
const FIX: Record<string, JobDef> = { t1: T1, t2: T2, t3: T3 };
const lookup: JobLookup = (id) => (id == null ? undefined : FIX[id] ?? getJob(id));

function unit(spec: Partial<UnitSpec> = {}): Unit {
  return createUnit({
    id: "u", side: "player", pos: { col: -1, row: -1 },
    speed: 10, maxHp: 24, attack: 8, defense: 2, moveRange: 4, sightRadius: 5,
    ...spec,
  });
}

const ctx = { run: {} as RunState } as PredicateCtx;

describe("JobDef.prestige — branches as data + evaluator (D65)", () => {
  it("prestigeOptions reads the branches off the unit's held jobs", () => {
    const u = unit({ jobId: "t1" as JobId });
    const opts = prestigeOptions(u, lookup);
    expect(opts).toHaveLength(1);
    expect(opts[0]).toMatchObject({ from: "t1", into: "t2" });
  });

  it("eligiblePrestiges gates on the branch predicate (the default jobLevel floor)", () => {
    const below = unit({ jobId: "t1" as JobId, jobLevels: { t1: { level: 1, xp: 0 } } });
    expect(eligiblePrestiges(below, ctx, lookup)).toHaveLength(0); // floor min 2 not met

    const at = unit({ jobId: "t1" as JobId, jobLevels: { t1: { level: 2, xp: 0 } } });
    const opts = eligiblePrestiges(at, ctx, lookup);
    expect(opts).toHaveLength(1);
    expect(opts[0].into).toBe("t2");
  });

  it("chains — each tier's branch surfaces only after the prior prestige (t1→t2→t3)", () => {
    const u = unit({ jobId: "t1" as JobId, jobLevels: { t1: { level: 2, xp: 0 } } });

    // Tier 1 → 2 is eligible; tier 2 → 3 is not yet reachable (not held).
    expect(eligiblePrestiges(u, ctx, lookup).map((o) => o.into)).toEqual(["t2"]);
    prestige(u, "t1" as JobId, "t2" as JobId, lookup);

    // Now holding t2 (level carried = 2), its own branch becomes eligible.
    expect(eligiblePrestiges(u, ctx, lookup).map((o) => o.into)).toEqual(["t3"]);
    prestige(u, "t2" as JobId, "t3" as JobId, lookup);

    // t3 is terminal.
    expect(eligiblePrestiges(u, ctx, lookup)).toHaveLength(0);
    expect(u.primaryJob).toBe("t3");
  });

  it("a branch can compose a memory gate (the linked-event prestige)", () => {
    const GJ: JobDef = {
      id: "gj", name: "GJ", description: "", skills: [],
      prestige: [{
        into: "gj-elite" as JobId,
        when: { kind: "all", of: [{ kind: "jobLevel", job: "gj" as JobId, min: 2 }, { kind: "remembers", flag: "initiated" }] },
      }],
    };
    const gjLookup: JobLookup = (id) => (id == null ? undefined : ({ gj: GJ } as Record<string, JobDef>)[id] ?? getJob(id));
    const u = unit({ jobId: "gj" as JobId, jobLevels: { gj: { level: 2, xp: 0 } } });

    expect(eligiblePrestiges(u, ctx, gjLookup)).toHaveLength(0); // floor met, but not initiated
    remember(u, "initiated");
    expect(eligiblePrestiges(u, ctx, gjLookup).map((o) => o.into)).toEqual(["gj-elite"]);
  });

  it("D68: the Scout carries the prestige fork; the rest of the base roster does not (yet)", () => {
    expect(JOBS.scout.prestige?.map((b) => b.into)).toContain("assassin");
    for (const id of Object.keys(JOBS)) {
      if (id === "scout") continue;
      expect(JOBS[id as JobId].prestige).toBeUndefined();
    }
  });
});
