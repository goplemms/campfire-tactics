/**
 * D67 increment 1 — the `usableContext` axis + the `skillContexts` default (pure).
 *
 * Locks the default for **every** effect kind × target × spend so the move-vs-engage-vs-
 * support-vs-trap-vs-camp rule lives in one tested place, and confirms the explicit override.
 */
import { describe, it, expect } from "vitest";
import { skillContexts, type SkillDef, type SkillEffect, type UsableContext } from "./skills";
import { availableSkills, unlockedSkills } from "./leveling";
import { DEFEND, JOBS, type JobId } from "./jobs";
import { createUnit, type Unit } from "./units";

function mk(over: Partial<SkillDef> & { effect: SkillEffect }): SkillDef {
  return {
    id: "t",
    name: "T",
    description: "",
    phase: "battle",
    target: "enemy",
    range: 1,
    spend: "act",
    ...over,
  };
}

const BOTH: UsableContext[] = ["pre-combat", "combat"];

describe("skillContexts — engagement is combat-only", () => {
  it.each<[string, SkillEffect]>([
    ["damage", { kind: "damage", bonusAttack: 1 }],
    ["cleave", { kind: "cleave", bonusAttack: 1, reach: 2 }],
    ["forced-move", { kind: "forced-move", tiles: 1 }],
    ["channel", { kind: "channel" }],
  ])("%s ⇒ combat only", (_kind, effect) => {
    expect(skillContexts(mk({ effect }))).toEqual(["combat"]);
  });

  it("a status on an enemy (debuff) ⇒ combat only", () => {
    const debuff = mk({ target: "enemy", effect: { kind: "status", status: { id: "exposed", name: "Exposed", duration: 2 } } });
    expect(skillContexts(debuff)).toEqual(["combat"]);
  });

  it("the herb-stash med-heal ⇒ combat only (its stash pick + inventory spend are engagement-bound, D67 increment 6c)", () => {
    expect(skillContexts(mk({ target: "ally", effect: { kind: "med-heal" } }))).toEqual(["combat"]);
  });

  it("a charged ability ⇒ combat only (it resolves later on the CT clock, no deploy equivalent)", () => {
    const charged = mk({ target: "ally", cost: { charge: 50 }, effect: { kind: "heal", amount: 16 } });
    expect(skillContexts(charged)).toEqual(["combat"]);
  });
});

describe("skillContexts — support and self/ally buffs are shared across both board phases", () => {
  it.each<[string, Partial<SkillDef> & { effect: SkillEffect }]>([
    ["heal", { target: "ally", effect: { kind: "heal", amount: 5 } }],
    ["triage-heal", { target: "ally", effect: { kind: "triage-heal", amount: 5 } }],
    ["cleanse", { target: "ally", effect: { kind: "cleanse" } }],
    ["guard-allies", { target: "self", effect: { kind: "guard-allies", amount: 1 } }],
    ["self-buff status", { target: "self", effect: { kind: "status", status: { id: "guarded", name: "Guarded", duration: 1 } } }],
  ])("%s ⇒ pre-combat + combat", (_kind, over) => {
    expect(skillContexts(mk(over))).toEqual(BOTH);
  });
});

describe("skillContexts — phase-specific kinds", () => {
  it("placeTrap ⇒ pre-combat only", () => {
    expect(skillContexts(mk({ phase: "deployment", target: "self", effect: { kind: "placeTrap", damage: 3 } }))).toEqual(["pre-combat"]);
  });

  it("morale (camp) ⇒ overworld", () => {
    expect(skillContexts(mk({ phase: "meta", target: "party", effect: { kind: "morale", morale: 1, partyHeal: 8 } }))).toEqual(["overworld"]);
  });
});

describe("skillContexts — movement abilities are dual-context by their shape", () => {
  it("a move-budget self-buff (Dash/Reposition shape) ⇒ pre-combat + combat", () => {
    const dash = mk({ spend: "move", target: "self", effect: { kind: "status", status: { id: "swift", name: "Swift", duration: 1 } } });
    expect(skillContexts(dash)).toEqual(BOTH);
  });
});

describe("skillContexts — explicit override wins", () => {
  it("an authored usableContext overrides the shape default", () => {
    const digIn = mk({ target: "self", usableContext: ["pre-combat"], effect: { kind: "status", status: { id: "dug-in", name: "Dug In", duration: 1 } } });
    expect(skillContexts(digIn)).toEqual(["pre-combat"]);
  });
});

describe("skillContexts — real shipping skills", () => {
  it("the universal Defend is usable in both board contexts (self status)", () => {
    expect(skillContexts(DEFEND)).toEqual(BOTH);
  });
});

function jobUnit(jobId: JobId): Unit {
  return createUnit({
    id: `u-${jobId}`,
    side: "player",
    pos: { col: 0, row: 0 },
    awareness: 2,
    speed: 10,
    maxHp: 20,
    attack: 5,
    defense: 1,
    moveRange: 3,
    sightRadius: 4,
    jobId,
  });
}

describe("availableSkills — parity with today's surfacing + the dual-context win (D67 increment 3)", () => {
  const jobIds = Object.keys(JOBS) as JobId[];

  it.each(jobIds)("%s: availableSkills('combat') == unlockedSkills('battle') + the universal Defend", (jobId) => {
    const u = jobUnit(jobId);
    expect(availableSkills(u, "combat")).toEqual([...unlockedSkills(u, "battle"), DEFEND]);
  });

  it("the Chef's camp skill surfaces in the overworld", () => {
    expect(availableSkills(jobUnit("chef"), "overworld").map((s) => s.id)).toContain("cook-stew");
  });

  it("the Survivalist's Set Trap is pre-combat only", () => {
    const u = jobUnit("survivalist");
    expect(availableSkills(u, "pre-combat").map((s) => s.id)).toContain("set-trap");
    expect(availableSkills(u, "combat").map((s) => s.id)).not.toContain("set-trap");
  });

  it("the Scout's Dash is dual-context — surfaced in BOTH pre-combat and combat (the F2 win)", () => {
    const u = jobUnit("scout");
    expect(availableSkills(u, "pre-combat").map((s) => s.id)).toContain("dash");
    expect(availableSkills(u, "combat").map((s) => s.id)).toContain("dash");
  });
});

describe("availableSkills — universal capabilities fold in (D67 increment 4)", () => {
  it("Defend is universal in both board contexts", () => {
    const u = jobUnit("soldier");
    expect(availableSkills(u, "combat").map((s) => s.id)).toContain("defend");
    expect(availableSkills(u, "pre-combat").map((s) => s.id)).toContain("defend");
  });

  it("Dig In is a universal pre-combat capability only (executes via the digIn verb)", () => {
    const u = jobUnit("soldier");
    expect(availableSkills(u, "pre-combat").map((s) => s.id)).toContain("dig-in");
    expect(availableSkills(u, "combat").map((s) => s.id)).not.toContain("dig-in");
  });
});

describe("availableSkills — the guild context is a wired placeholder (D67 increment 8)", () => {
  it("is a live axis value that surfaces nothing today (no per-unit guild skills exist yet)", () => {
    // The guild screen has no per-unit ability surface; this locks the placeholder so a
    // future guild-context skill (which would make this non-empty) is a visible prompt to
    // add the GuildScene surface — rather than silently going unsurfaced.
    for (const jobId of Object.keys(JOBS) as JobId[]) {
      expect(availableSkills(jobUnit(jobId), "guild")).toEqual([]);
    }
  });
});

describe("availableSkills — combat-bound abilities don't leak into the deploy surface (D67 increment 6c)", () => {
  it("the Medic's herb Heal surfaces in combat but NOT pre-combat (its stash pick is engagement-bound); Dig In / Defend remain pre-combat", () => {
    const medic = jobUnit("medic");
    const pre = availableSkills(medic, "pre-combat").map((s) => s.id);
    const combat = availableSkills(medic, "combat").map((s) => s.id);
    expect(combat).toContain("heal"); // the med-heal "Heal" is a combat skill
    expect(pre).not.toContain("heal"); // ...but never offered pre-combat (would crash the drained verb)
    expect(pre).toEqual(expect.arrayContaining(["dig-in", "defend"]));
  });
});
