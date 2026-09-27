/**
 * Cost-provider registry contract (design map, step 2) — a data skill record names a dynamic
 * price by id (`{ provider: "food-upkeep" }`); this proves every id a shipped skill names is
 * registered once the core barrel is loaded, that the registry trips on a duplicate and on a
 * miss, and that the cost grammar resolves the provider form like the function form it replaces.
 *
 * Pure logic: no Phaser, no DOM.
 */
import { describe, it, expect } from "vitest";
import * as core from "./index";
import { registerCostProvider, costProvider, costProviderIds } from "./cost-providers";
import { resolveKnob, knobDeclared, overworldCostOf } from "./overworld-cost";
import { JOBS } from "./jobs";
import { UNIVERSAL_OVERWORLD_SKILLS, COOK_STEW, UNIVERSAL_BUY, TRIAGE_FALLBACK } from "./jobs-data/support";
import { createRun } from "./run";
import { createUnit } from "./units";
import type { CostKnob } from "./overworld-cost";

function providerIdsNamedBySkills(): string[] {
  const ids = new Set<string>();
  for (const skill of [...Object.values(JOBS).flatMap((j) => j.skills), ...UNIVERSAL_OVERWORLD_SKILLS]) {
    const cost = overworldCostOf(skill);
    for (const knob of [cost.gold, cost.influence, cost.rp] as (CostKnob | undefined)[]) {
      if (knob && typeof knob === "object") ids.add(knob.provider);
    }
  }
  return [...ids].sort();
}

const newRun = () =>
  createRun("cost-providers", {
    party: [createUnit({ id: "Rook", side: "player", pos: { col: -1, row: -1 }, jobId: "soldier", speed: 5, maxHp: 10, attack: 3, defense: 1, moveRange: 3, sightRadius: 4 })],
    difficultyId: "normal",
    gold: 50,
    storageCap: 8,
  });

describe("cost providers — the registry a data record prices through", () => {
  it("every provider id a shipped skill names is registered once the barrel is loaded", () => {
    expect(core).toBeTruthy(); // the barrel import above loaded every owning module
    const named = providerIdsNamedBySkills();
    expect(named.length).toBeGreaterThan(0);
    for (const id of named) expect(() => costProvider(id), `provider "${id}"`).not.toThrow();
    // …and nothing registers a provider no record names (no dead registrations).
    expect(costProviderIds()).toEqual(named);
  });

  it("the three shipped records name their providers by id (data, not a runtime import)", () => {
    expect(overworldCostOf(COOK_STEW).gold).toEqual({ provider: "food-upkeep" });
    expect(overworldCostOf(UNIVERSAL_BUY).gold).toEqual({ provider: "merchant-buy" });
    expect(overworldCostOf(TRIAGE_FALLBACK).rp).toEqual({ provider: "triage-fallback" });
  });

  it("a provider knob resolves through the registry to the same price the function form gives", () => {
    const run = newRun();
    const food = core.computeUpkeep(run.party).lines.find((l) => l.id === "food")?.cost ?? 0;
    expect(resolveKnob({ provider: "food-upkeep" }, run)).toBe(food);
    expect(resolveKnob({ provider: "merchant-buy" }, run)).toBe(core.merchantBuyGold(run));
    expect(resolveKnob({ provider: "triage-fallback" }, run)).toBe(core.triageFallbackRp(run));
    expect(resolveKnob((r) => core.merchantBuyGold(r), run)).toBe(core.merchantBuyGold(run));
    expect(resolveKnob(7, run)).toBe(7);
    expect(resolveKnob(undefined, run)).toBe(0);
  });

  it("a provider knob always counts as a declared price; a static 0 does not", () => {
    expect(knobDeclared({ provider: "food-upkeep" })).toBe(true);
    expect(knobDeclared(() => 0)).toBe(true);
    expect(knobDeclared(0)).toBe(false);
    expect(knobDeclared(undefined)).toBe(false);
    expect(knobDeclared(3)).toBe(true);
  });

  it("trips on a duplicate registration and on an unknown id, by name", () => {
    registerCostProvider("test-only-provider", () => 1);
    expect(() => registerCostProvider("test-only-provider", () => 2)).toThrow(/"test-only-provider" registered twice/);
    expect(() => costProvider("no-such-provider")).toThrow(/"no-such-provider" is not registered/);
    const run = newRun();
    expect(() => resolveKnob({ provider: "no-such-provider" }, run)).toThrow(/no-such-provider/);
  });
});
