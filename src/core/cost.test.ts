/**
 * #113 — the one cost grammar (increment 1): the {@link Cost} shape + clock-domain tag,
 * and that the two surface costs are structural **views** of it.
 *
 * Types can't be asserted at runtime, so the structural relationships are pinned with
 * `expectTypeOf`; the runtime `it`s pin that real literals still satisfy the views (the
 * "additive, no behavior change" guarantee — every existing cost literal type-checks).
 */
import { describe, it, expect, expectTypeOf } from "vitest";
import type { Cost, CostPrice, ClockDomain } from "./cost";
import type { SkillCost } from "./skills";
import type { OverworldCost } from "./overworld-cost";

describe("Cost — the clock-domain tag (#113)", () => {
  it("the tag is exactly the two surface clocks", () => {
    const clocks: ClockDomain[] = ["ct", "node-steps"];
    expect(clocks).toEqual(["ct", "node-steps"]);
    expectTypeOf<ClockDomain>().toEqualTypeOf<"ct" | "node-steps">();
  });
});

describe("SkillCost — the CT view of the one grammar", () => {
  it("is exactly the CT-pacing slice of Cost (charge + cooldown)", () => {
    expectTypeOf<SkillCost>().toEqualTypeOf<Pick<Cost, "charge" | "cooldown">>();
  });

  it("every SkillCost is assignable to the one Cost grammar", () => {
    expectTypeOf<SkillCost>().toMatchTypeOf<Cost>();
  });

  it("the Medic Heal / charged-Mend shapes still type-check as SkillCost", () => {
    const cooldown: SkillCost = { cooldown: 180 };
    const charge: SkillCost = { charge: 34 };
    expect(cooldown.cooldown).toBe(180);
    expect(charge.charge).toBe(34);
  });
});

describe("OverworldCost — the node-steps view of the one grammar", () => {
  it("is Cost minus the CT-only charge and the tag (node-steps pacing × the price map)", () => {
    expectTypeOf<OverworldCost>().toEqualTypeOf<Omit<Cost, "charge" | "clock">>();
  });

  it("every OverworldCost is assignable to the one Cost grammar", () => {
    expectTypeOf<OverworldCost>().toMatchTypeOf<Cost>();
  });

  it("the shipping overworld cost shapes still type-check as OverworldCost", () => {
    const stew: OverworldCost = { usesPerNode: 1, gold: (run) => run.rp };
    const survey: OverworldCost = { cooldown: 1, fatigue: 4 };
    const sell: OverworldCost = { selfLimited: true };
    expect(stew.usesPerNode).toBe(1);
    expect(survey.fatigue).toBe(4);
    expect(sell.selfLimited).toBe(true);
  });

  it("the shared price map is the same on both surfaces", () => {
    // CostPrice (fatigue/gold/influence/rp) is the price half both views extend.
    const price: CostPrice = { fatigue: 2, gold: 5, influence: 3, rp: 1 };
    const asOverworld: OverworldCost = price;
    expect(asOverworld.gold).toBe(5);
  });
});
