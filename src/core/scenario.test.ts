import { describe, it, expect } from "vitest";
import { buildScenarioRun, DEFAULT_SCENARIO_GOLD } from "./scenario";
import { PICK_THE_CELL, PRISON_ASSAULT_SCENARIO, DOCTRINE_HARNESS_SCENARIO, getScenario, listScenarios } from "./scenarios";
import { getExpedition } from "./expedition";
import { encounterOutcome } from "./staging";
import { currentNode } from "./run";
import { unitHasCapability } from "./jobs";
import { hasTag, GARRISON } from "./tags";

/**
 * The scenario harness (#170) — a synthetic one-node run that boots an arbitrary
 * encounter run-less. These tests pin the harness *wiring* (a run parked on the
 * config's combat node, staging the config's encounter with the chosen party arm)
 * and the red-team invariants R1 (fail-loud) + R3 (lazy registration). The taste's
 * *mechanical* claims are covered by `taste-infiltration.test.ts` off the same config.
 */

describe("the scenario harness — buildScenarioRun (#170)", () => {
  // R3 — this MUST run before any buildScenarioRun call below registers the expedition:
  // importing a scenario config is pure data; nothing is registered until the builder runs.
  it("registers lazily — importing the config pollutes nothing (R3)", () => {
    expect(getExpedition("scenario:pick-the-cell")).toBeUndefined();
    // Building it is what registers it.
    buildScenarioRun(PICK_THE_CELL);
    expect(getExpedition("scenario:pick-the-cell")).toBeDefined();
  });

  it("parks a synthetic run on the config's combat node", () => {
    const { run } = buildScenarioRun(PICK_THE_CELL);
    expect(run.mapNodeId).toBe("scene");
    const node = currentNode(run);
    expect(node.kind).toBe("combat");
    expect(node.authoredId).toBe("scene");
    expect(run.camp.purse).toBe(DEFAULT_SCENARIO_GOLD); // R2 — comfortably above party upkeep
  });

  it("stages the config's encounter — the cuffed captive + garrison, party fielded", () => {
    const { loop } = buildScenarioRun(PICK_THE_CELL);
    const battle = loop.startEncounter();
    const prisoner = battle.units.find((u) => u.id === "prisoner")!;
    expect(prisoner).toBeDefined();
    expect(prisoner.side).toBe("player");
    expect(prisoner.captured).toBe(true); // bound: off the clock
    expect(prisoner.release).toEqual({ kind: "lockpick" }); // cuffed
    expect(battle.units.filter((u) => u.side === "enemy").length).toBe(3); // the garrison
    // The chosen party arm is fielded (the two-body party, minus the captive which rides separately).
    expect(battle.units.filter((u) => u.side === "player" && !u.captured).length).toBe(2);
  });

  it("the default (thief) arm holds Expert Lockpick; the scout arm does not", () => {
    const thief = buildScenarioRun(PICK_THE_CELL).loop.startEncounter().units.find((u) => u.id === "infil")!;
    expect(unitHasCapability(thief, "lockpick")).toBe(true); // defaultParty === "thief"

    const scout = buildScenarioRun(PICK_THE_CELL, "scout").loop.startEncounter().units.find((u) => u.id === "infil")!;
    expect(unitHasCapability(scout, "lockpick")).toBe(false);
  });

  it("throws on an unknown party arm — fail-loud (R1)", () => {
    expect(() => buildScenarioRun(PICK_THE_CELL, "nope")).toThrow(/no party "nope"/);
  });

  it("is deterministic — same config boots byte-identical staged positions", () => {
    const a = buildScenarioRun(PICK_THE_CELL).loop.startEncounter();
    const b = buildScenarioRun(PICK_THE_CELL).loop.startEncounter();
    const posOf = (battle: typeof a) =>
      battle.units.map((u) => `${u.id}@${u.pos.col},${u.pos.row}`).sort();
    expect(posOf(a)).toEqual(posOf(b));
  });

  it("exposes the config through the registry lookups", () => {
    expect(getScenario("pick-the-cell")).toBe(PICK_THE_CELL);
    expect(getScenario("prison-assault")).toBe(PRISON_ASSAULT_SCENARIO);
    expect(getScenario("missing")).toBeUndefined();
    expect(listScenarios()).toContain(PICK_THE_CELL);
  });
});

describe("the prison-assault scenario — the dual-OR finale surface (D97)", () => {
  it("stages two lockpick cells + the two OR'd goals", () => {
    const { loop } = buildScenarioRun(PRISON_ASSAULT_SCENARIO);
    const battle = loop.startEncounter();
    const prisoners = battle.units.filter((u) => u.role === "prisoner");
    expect(prisoners).toHaveLength(2);
    expect(prisoners.every((p) => p.captured && p.release?.kind === "lockpick")).toBe(true);
    expect(loop.staged!.objectives.map((o) => o.spec.kind).sort()).toEqual(["eliminate-all", "extraction"]);
  });

  it("extraction: the default (infiltration) arm frees the cells and walks them out to win", () => {
    const { loop } = buildScenarioRun(PRISON_ASSAULT_SCENARIO);
    loop.startEncounter();
    loop.beginBattle();
    const thief = loop.staged!.battle.units.find((u) => u.id === "infil")!;
    expect(unitHasCapability(thief, "lockpick")).toBe(true);
    const prisoners = loop.staged!.battle.units.filter((u) => u.role === "prisoner");
    const exit = loop.staged!.objectives.find((o) => o.spec.kind === "extraction")!.spec.span!;
    prisoners.forEach((p, i) => { loop.staged!.battle.rescue(p, thief); p.pos = { ...exit[i] }; });
    // The garrison is untouched — extraction alone clears the finale (OR'd, D97).
    expect(loop.staged!.battle.units.some((u) => u.side === "enemy" && u.alive)).toBe(true);
    expect(encounterOutcome(loop.staged!)).toBe("win");
  });

  it("frontal arm: no lockpick — the cells hold, so it must storm the garrison (C4)", () => {
    const { loop } = buildScenarioRun(PRISON_ASSAULT_SCENARIO, "frontal");
    loop.startEncounter();
    loop.beginBattle();
    const infil = loop.staged!.battle.units.find((u) => u.id === "infil")!;
    expect(unitHasCapability(infil, "lockpick")).toBe(false);
    const prisoners = loop.staged!.battle.units.filter((u) => u.role === "prisoner");
    for (const p of prisoners) loop.staged!.battle.rescue(p, infil); // refused no-op
    expect(prisoners.every((p) => p.captured)).toBe(true);
    // Only eliminate-all can win for this arm.
    for (const u of loop.staged!.battle.units) if (u.side === "enemy") u.alive = false;
    expect(encounterOutcome(loop.staged!)).toBe("win");
  });
});

describe("the doctrine-harness scenario — the guard door-drive surface (D117/M4)", () => {
  it("stages the garrison + the two-mouth party; the M3b control-room region survives the run path", () => {
    const { loop } = buildScenarioRun(DOCTRINE_HARNESS_SCENARIO);
    const battle = loop.startEncounter();
    const warden = battle.units.find((u) => u.id === "warden")!;
    expect(hasTag(warden, GARRISON, battle.tagContext())).toBe(true);
    expect(battle.units.filter((u) => u.side === "enemy").length).toBe(2); // Warden + guard
    expect(battle.units.filter((u) => u.side === "player" && !u.captured).length).toBe(2); // the two-mouth party
    expect(battle.controlRoom).toEqual({ cols: [0, 2], rows: [0, 2] }); // the M3b region reaches the staged battle
  });

  it("the door-drive wires through the full run path: an un-engaged Warden keys the seal open", () => {
    const battle = buildScenarioRun(DOCTRINE_HARNESS_SCENARIO).loop.startEncounter();
    const warden = battle.units.find((u) => u.id === "warden")!;
    const seal = battle.gates.find((g) => g.id === "seal")!;
    expect(seal.locked).toBe(true);
    const plan = battle.runPolicyTurn(warden); // !in-combat → drives + keys, past the reachable infiltrator
    expect(plan.gateAct).toBe("key");
    expect(seal.locked).toBe(false);
  });

  it("the infiltrator arm swaps job (thief vs scout), infiltrator on the control-room side", () => {
    const thief = buildScenarioRun(DOCTRINE_HARNESS_SCENARIO).loop.startEncounter().units.find((u) => u.id === "infil")!;
    expect(unitHasCapability(thief, "lockpick")).toBe(true); // defaultParty === "thief"
    expect(thief.pos).toEqual({ col: 2, row: 0 }); // spawn 0 = the control-room side (D99 side door)
    const scout = buildScenarioRun(DOCTRINE_HARNESS_SCENARIO, "scout").loop.startEncounter().units.find((u) => u.id === "infil")!;
    expect(unitHasCapability(scout, "lockpick")).toBe(false);
  });

  it("is exposed through the registry lookups", () => {
    expect(getScenario("doctrine-harness")).toBe(DOCTRINE_HARNESS_SCENARIO);
    expect(listScenarios()).toContain(DOCTRINE_HARNESS_SCENARIO);
  });
});
