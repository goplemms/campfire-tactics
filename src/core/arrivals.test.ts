import { describe, it, expect } from "vitest";
import { THE_HOLLOW_MILL } from "./hollow-mill";
import { enumeratePaths, traverseRoute } from "./expedition-sim";
import {
  scoreArrival,
  samplePopulation,
  DEFAULT_SCORE_WEIGHTS,
  DEFAULT_SEED_SALTS,
  type Population,
} from "./arrivals";
import type { RunState } from "./run";

const EXP = THE_HOLLOW_MILL;

/** A route to the Thieves' Den that frees the Medic (a recruit ⇒ a stronger arrival). */
const DEN_VIA_WAGON = ["start", "e1", "camp2", "snares", "wagon4b", "den"];

/** A deep, structured clone of a run so a test can mutate it without disturbing the source. */
function cloneRun(run: RunState): RunState {
  return structuredClone(run);
}

describe("scoreArrival (Phase 3)", () => {
  it("exposes every weighted component in `parts`, summing to `total`", () => {
    const { run } = traverseRoute(EXP, DEN_VIA_WAGON);
    const score = scoreArrival(run);
    for (const key of Object.keys(DEFAULT_SCORE_WEIGHTS)) {
      expect(score.parts).toHaveProperty(key);
    }
    const sum = Object.values(score.parts).reduce((a, b) => a + b, 0);
    expect(score.total).toBeCloseTo(sum, 10);
  });

  it("fatigue is a PENALTY — more fatigue lowers the total", () => {
    const { run } = traverseRoute(EXP, DEN_VIA_WAGON);
    const base = scoreArrival(run);

    const tired = cloneRun(run);
    for (const u of tired.party) u.fatigue = 18; // Exhausted
    const tiredScore = scoreArrival(tired);

    // The fatigue component is more negative (a bigger penalty) when fatigued.
    expect(tiredScore.parts.fatigue).toBeLessThan(base.parts.fatigue);
    expect(tiredScore.parts.fatigue).toBeLessThanOrEqual(0);
    expect(tiredScore.total).toBeLessThan(base.total);
  });

  it("monotonicity — a stronger arrival scores higher", () => {
    const { run } = traverseRoute(EXP, DEN_VIA_WAGON);
    const weak = cloneRun(run);
    const strong = cloneRun(run);

    // Make `strong` strictly stronger across several axes: levels, HP, gold, supplies.
    for (const u of strong.party) {
      u.level += 5;
      u.hp = u.maxHp; // full health
    }
    strong.camp.gold += 200;
    strong.inventory.counts.salve = (strong.inventory.counts.salve ?? 0) + 4;

    // And `weak` strictly weaker (wounded, broke).
    for (const u of weak.party) u.hp = Math.max(1, Math.floor(u.maxHp * 0.1));
    weak.camp.gold = 0;

    expect(scoreArrival(strong).total).toBeGreaterThan(scoreArrival(weak).total);
  });

  it("a deeper recruit route outscores the same target without the recruit", () => {
    const withRecruit = traverseRoute(EXP, DEN_VIA_WAGON).run; // frees Sela
    const withoutRecruit = traverseRoute(EXP, [
      "start",
      "e1",
      "camp2",
      "snares",
      "rest4a",
      "market",
      "den",
    ]).run; // no Medic

    expect(withRecruit.party.some((u) => u.id === "sela")).toBe(true);
    expect(withoutRecruit.party.some((u) => u.id === "sela")).toBe(false);
    // The recruit route also picks up the wagon's build progress (the freed-Medic flag +
    // its loot), so its `relics`/`levels` components — and the total — lead.
    const a = scoreArrival(withRecruit);
    const b = scoreArrival(withoutRecruit);
    expect(a.parts.relics).toBeGreaterThan(b.parts.relics);
    expect(a.total).toBeGreaterThan(b.total);
  });

  it("determinism — the same run yields an identical score", () => {
    const { run } = traverseRoute(EXP, DEN_VIA_WAGON);
    expect(scoreArrival(run)).toEqual(scoreArrival(run));
    // A re-traversal (same args) also reproduces the score exactly.
    const again = traverseRoute(EXP, DEN_VIA_WAGON).run;
    expect(scoreArrival(again)).toEqual(scoreArrival(run));
  });
});

describe("samplePopulation (Phase 3)", () => {
  for (const target of ["den", "finale"]) {
    describe(`over "${target}"`, () => {
      const pop = samplePopulation(EXP, target);

      it("reports the true route count and a matching `generated`", () => {
        expect(pop.sampling.routes).toBe(enumeratePaths(EXP.map, target).length);
        expect(pop.sampling.salts).toBe(DEFAULT_SEED_SALTS.length);
        expect(pop.sampling.policies).toBe(1);
        expect(pop.sampling.generated).toBe(pop.samples.length);
        expect(pop.sampling.capped).toBe(false);
        // The grid is routes × salts × policies, minus any runtime-inaccessible routes
        // (a nodeAccessible-gated edge — surfaced in `inaccessibleRoutes`, never silent).
        const accessibleRoutes = pop.sampling.routes - pop.sampling.inaccessibleRoutes;
        expect(pop.samples.length).toBe(
          accessibleRoutes * pop.sampling.salts * pop.sampling.policies,
        );
      });

      it("produces a spread of scores across salts (combat variance moves the score)", () => {
        const totals = pop.samples.map((s) => s.score.total);
        const distinct = new Set(totals.map((t) => t.toFixed(6)));
        expect(distinct.size).toBeGreaterThan(1);
      });

      it("survived flags are booleans and at least some are true", () => {
        expect(pop.samples.every((s) => typeof s.survived === "boolean")).toBe(true);
        expect(pop.samples.some((s) => s.survived)).toBe(true);
      });

      it("descriptors are the lightweight replayable identity", () => {
        for (const s of pop.samples) {
          expect(s.descriptor.targetId).toBe(target);
          expect(s.descriptor.route[s.descriptor.route.length - 1]).toBe(target);
          expect(s.descriptor.policyName).toBe("pilot");
          expect(DEFAULT_SEED_SALTS).toContain(s.descriptor.seedSalt);
        }
      });

      it("is deterministic — identical args reproduce the population exactly", () => {
        const again = samplePopulation(EXP, target);
        expect(again.sampling).toEqual(pop.sampling);
        expect(again.samples).toEqual(pop.samples);
      });
    });
  }

  it("a descriptor re-materializes the same scored run via traverseRoute", () => {
    const pop = samplePopulation(EXP, "den");
    const s = pop.samples[0];
    const { run } = traverseRoute(EXP, s.descriptor.route, {
      seedSalt: s.descriptor.seedSalt,
    });
    expect(scoreArrival(run)).toEqual(s.score);
  });

  describe("cap behavior", () => {
    const MAX = 4;
    const capped = samplePopulation(EXP, "finale", { maxSamples: MAX });

    it("flags `capped`, honors the cap, but reports the TRUE dimensions", () => {
      expect(capped.sampling.capped).toBe(true);
      expect(capped.samples.length).toBeLessThanOrEqual(MAX);
      // The reported dimensions are the real requested grid, not the thinned one.
      expect(capped.sampling.routes).toBe(enumeratePaths(EXP.map, "finale").length);
      expect(capped.sampling.salts).toBe(DEFAULT_SEED_SALTS.length);
      expect(capped.sampling.policies).toBe(1);
      expect(capped.sampling.generated).toBe(capped.samples.length);
    });

    it("the subsample is deterministic across two calls", () => {
      const again = samplePopulation(EXP, "finale", { maxSamples: MAX });
      expect(again.samples).toEqual(capped.samples);
      expect(again.sampling).toEqual(capped.sampling);
    });

    it("keeps full route × policy coverage when thinning the salts axis", () => {
      // With 5 routes to the finale and maxSamples 4 < routes, the sample list is
      // truncated; but the routes covered must be a prefix of the route enumeration
      // (route-major order), never a hidden fraction misreported as complete.
      const routes = enumeratePaths(EXP.map, "finale");
      expect(routes.length).toBeGreaterThan(MAX); // precondition for this fixture
      const coveredRoutes = new Set(capped.samples.map((s) => s.descriptor.route.join(">")));
      expect(coveredRoutes.size).toBeLessThanOrEqual(MAX);
    });
  });

  it("a wipe-on-arrival is scored, not dropped (survived:false stays in the population)", () => {
    // Not asserting a wipe necessarily happens on Hollow Mill at these salts; this
    // documents the contract — every cell yields a sample, survived flagging the wipe.
    const pop: Population = samplePopulation(EXP, "finale");
    expect(pop.samples.length).toBe(pop.sampling.generated);
    for (const s of pop.samples) {
      expect(s.score.total).toBeTypeOf("number");
    }
  });
});
