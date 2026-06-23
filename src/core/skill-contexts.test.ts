/**
 * D67 increment 1 — the `usableContext` axis + the `skillContexts` default (pure).
 *
 * Locks the default for **every** effect kind × target × spend so the move-vs-engage-vs-
 * support-vs-trap-vs-camp rule lives in one tested place, and confirms the explicit override.
 */
import { describe, it, expect } from "vitest";
import { skillContexts, type SkillDef, type SkillEffect, type UsableContext } from "./skills";
import { DEFEND } from "./jobs";

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
});

describe("skillContexts — support and self/ally buffs are shared across both board phases", () => {
  it.each<[string, Partial<SkillDef> & { effect: SkillEffect }]>([
    ["heal", { target: "ally", effect: { kind: "heal", amount: 5 } }],
    ["med-heal", { target: "ally", effect: { kind: "med-heal" } }],
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
