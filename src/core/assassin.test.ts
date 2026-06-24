import { describe, it, expect } from "vitest";
import { createUnit, remember, type Side, type Unit } from "./units";
import { stampPassives, ASSASSIN_JOB, SUBTLE_BLADE_BONUS, SCOUT_PRESTIGE_FLOOR } from "./jobs";
import { computeDamage, PASSIVE } from "./combat";
import { resolveSkill } from "./skills";
import { hasStatus, EXPOSED, IMMOBILIZED } from "./status";
import { prestige, prestigeOptions, eligiblePrestiges } from "./grants";
import type { RunState } from "./run";

function mk(id: string, side: Side, jobId?: "scout" | "assassin", over: Partial<Parameters<typeof createUnit>[0]> = {}): Unit {
  const u = createUnit({
    id, side, pos: { col: 0, row: 0 },
    speed: 12, maxHp: 24, attack: 9, defense: 2, moveRange: 5, sightRadius: 6, attackRange: 1,
    jobId, ...over,
  });
  stampPassives(u);
  return u;
}

describe("Assassin — Subtle Blade opening strike (D68)", () => {
  it("opens harder on a full-HP (unbloodied) foe; nothing extra on a bloodied one", () => {
    const a = mk("a", "player", "assassin");
    const fresh = mk("f", "enemy", undefined, { maxHp: 30, hp: 30, defense: 0 });
    const hurt = mk("g", "enemy", undefined, { maxHp: 30, hp: 20, defense: 0 });
    expect(computeDamage(a, fresh)).toBe(a.attack + SUBTLE_BLADE_BONUS);
    expect(computeDamage(a, hurt)).toBe(a.attack);
  });

  it("a non-Assassin gets no opening bonus", () => {
    const s = mk("s", "player", "scout");
    const fresh = mk("f", "enemy", undefined, { maxHp: 30, hp: 30, defense: 0 });
    expect(computeDamage(s, fresh)).toBe(s.attack);
  });
});

describe("Assassin — Surgical Precision (D68)", () => {
  it("a precise strike leaves the foe Exposed AND Immobilized (the multi-rider onHit)", () => {
    const a = mk("a", "player", "assassin");
    const foe = mk("f", "enemy", undefined, { maxHp: 40, hp: 40, defense: 0 });
    const surgical = ASSASSIN_JOB.skills.find((s) => s.id === "surgical-precision")!;
    resolveSkill(surgical, a, foe);
    expect(foe.alive).toBe(true); // tanky enough to survive the strike and carry the debuffs
    expect(hasStatus(foe, EXPOSED)).toBe(true);
    expect(hasStatus(foe, IMMOBILIZED)).toBe(true);
  });
});

describe("Scout → Assassin prestige (D68)", () => {
  it("SCOUT_JOB declares the Assassin branch", () => {
    expect(prestigeOptions(mk("vale", "player", "scout")).map((o) => o.into)).toContain("assassin");
  });

  it("replaces the Scout in place — same slot, level carried, evolved passive", () => {
    const u = mk("vale", "player", "scout", { jobLevels: { scout: { level: 5, xp: 30 } } });
    const res = prestige(u, "scout", "assassin");
    expect(res.ok).toBe(true);
    expect(u.primaryJob).toBe("assassin");
    expect(u.heldJobs).toContain("assassin");
    expect(u.heldJobs).not.toContain("scout");
    expect(u.jobLevels.assassin).toEqual({ level: 5, xp: 30 }); // the grind carries
    expect(u.jobLevels.scout).toBeUndefined();
    expect(u.passives[PASSIVE.subtleBlade]).toBe(SUBTLE_BLADE_BONUS); // re-stamped to the evolved kit
    expect(u.passives[PASSIVE.quietFootsteps]).toBeUndefined(); // the base passive is gone
  });

  it("is eligible only at the floor AND with the mentor flag (the agency gate)", () => {
    const ctx = { run: {} as RunState }; // jobLevel/remembers read the unit, not the run
    const fresh = mk("a", "player", "scout");
    expect(eligiblePrestiges(fresh, ctx).map((o) => o.into)).not.toContain("assassin");

    const grindedNoFlag = mk("b", "player", "scout", { jobLevels: { scout: { level: SCOUT_PRESTIGE_FLOOR, xp: 0 } } });
    expect(eligiblePrestiges(grindedNoFlag, ctx).map((o) => o.into)).not.toContain("assassin");

    const ready = mk("c", "player", "scout", { jobLevels: { scout: { level: SCOUT_PRESTIGE_FLOOR, xp: 0 } } });
    remember(ready, "assassin-mentor");
    expect(eligiblePrestiges(ready, ctx).map((o) => o.into)).toContain("assassin");
  });
});
