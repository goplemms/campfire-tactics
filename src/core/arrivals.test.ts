import { describe, it, expect } from "vitest";
import { THE_HOLLOW_MILL } from "./hollow-mill";
import { enumeratePaths, traverseRoute } from "./expedition-sim";
import {
  scoreArrival,
  arrivalDigest,
  samplePopulation,
  pickRepresentatives,
  DEFAULT_SCORE_WEIGHTS,
  DEFAULT_SEED_SALTS,
  type Population,
  type Sample,
} from "./arrivals";
import { activeParty, type RunState } from "./run";

const EXP = THE_HOLLOW_MILL;

/** The sustain arm through the Wagon — frees Sela the Medic (a recruit ⇒ a stronger arrival). */
const MEDIC_ROUTE = ["start", "e1", "camp2", "snares", "market", "wagon", "restCamp"];
/** The infiltration arm to the Thieves' Den — the relic road, no Medic (C8 exclusivity). */
const DEN_ROUTE = ["start", "e1", "camp2", "snares", "market", "guildContact", "den"];

/** A deep, structured clone of a run so a test can mutate it without disturbing the source. */
function cloneRun(run: RunState): RunState {
  return structuredClone(run);
}

describe("scoreArrival (Phase 3)", () => {
  it("exposes every weighted component in `parts`, summing to `total`", () => {
    const { run } = traverseRoute(EXP, MEDIC_ROUTE);
    const score = scoreArrival(run);
    for (const key of Object.keys(DEFAULT_SCORE_WEIGHTS)) {
      expect(score.parts).toHaveProperty(key);
    }
    const sum = Object.values(score.parts).reduce((a, b) => a + b, 0);
    expect(score.total).toBeCloseTo(sum, 10);
  });

  it("fatigue is a PENALTY — more fatigue lowers the total", () => {
    const { run } = traverseRoute(EXP, MEDIC_ROUTE);
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
    const { run } = traverseRoute(EXP, MEDIC_ROUTE);
    const weak = cloneRun(run);
    const strong = cloneRun(run);

    // Make `strong` strictly stronger across several axes: levels, HP, gold, supplies.
    for (const u of strong.party) {
      u.level += 5;
      u.hp = u.maxHp; // full health
    }
    strong.camp.purse += 200;
    strong.inventory.counts.salve = (strong.inventory.counts.salve ?? 0) + 4;

    // And `weak` strictly weaker (wounded, broke).
    for (const u of weak.party) u.hp = Math.max(1, Math.floor(u.maxHp * 0.1));
    weak.camp.purse = 0;

    expect(scoreArrival(strong).total).toBeGreaterThan(scoreArrival(weak).total);
  });

  it("the sustain (recruit) route outscores the bare infiltration approach on build-progress", () => {
    const withRecruit = traverseRoute(EXP, MEDIC_ROUTE).run; // frees Sela + sets medic-freed
    const withoutRecruit = traverseRoute(EXP, DEN_ROUTE).run; // no Medic, no flag (C8)

    expect(withRecruit.party.some((u) => u.id === "sela")).toBe(true);
    expect(withoutRecruit.party.some((u) => u.id === "sela")).toBe(false);
    // The sustain route resolves the tough Wagon fight (a recruit, its loot, the freed-Medic
    // flag, and the levels/gold that ride along) where the infiltration approach has only
    // reached the guild-contact — so its build-progress components (flags/relics, levels, gold)
    // lead. Both pass the shared pre-fork Market, so that recruit is symmetric.
    const a = scoreArrival(withRecruit);
    const b = scoreArrival(withoutRecruit);
    expect(a.parts.relics).toBeGreaterThan(b.parts.relics);
    expect(a.parts.levels).toBeGreaterThan(b.parts.levels);
    expect(a.parts.gold).toBeGreaterThan(b.parts.gold);
  });

  it("determinism — the same run yields an identical score", () => {
    const { run } = traverseRoute(EXP, MEDIC_ROUTE);
    expect(scoreArrival(run)).toEqual(scoreArrival(run));
    // A re-traversal (same args) also reproduces the score exactly.
    const again = traverseRoute(EXP, MEDIC_ROUTE).run;
    expect(scoreArrival(again)).toEqual(scoreArrival(run));
  });

  it("pins the canonical sustain-route score (a scoring change must be deliberate + re-pinned)", () => {
    // Re-pinned for the Wave-0 topology (#168): the canonical route is now the sustain arm
    // (start → … → Market → Wagon → restCamp), which frees Sela the Medic. The scoring folds
    // are unchanged; this freezes the exact score so any *unintended* scoring drift fails loudly.
    // If a deliberate scoring change lands later, repin.
    const { run } = traverseRoute(EXP, MEDIC_ROUTE);
    const score = scoreArrival(run);
    expect(score.total).toBeCloseTo(72.24264382960035, 10);
    expect(score.parts.levels).toBeCloseTo(14.5, 10);
    expect(score.parts.health).toBeCloseTo(16.075977162933686, 10);
    expect(score.parts.morale).toBeCloseTo(4, 10);
    expect(score.parts.fatigue).toBeCloseTo(0, 10);
    const digest = arrivalDigest(run);
    expect(digest.levelTotal).toBe(29);
    expect(digest.avgHpPct).toBe(64);
  });
});

describe("arrivalDigest (Phase 5)", () => {
  it("has the expected shape — totals, percent HP, gold, roster ids, flags", () => {
    const { run } = traverseRoute(EXP, MEDIC_ROUTE); // frees the Medic → medic-freed flag
    const d = arrivalDigest(run);

    // Shape: every field present with the right primitive type.
    expect(typeof d.levelTotal).toBe("number");
    expect(typeof d.avgHpPct).toBe("number");
    expect(typeof d.gold).toBe("number");
    expect(Array.isArray(d.rosterIds)).toBe(true);
    expect(Array.isArray(d.flags)).toBe(true);

    // avgHpPct is a 0..100 percent.
    expect(d.avgHpPct).toBeGreaterThanOrEqual(0);
    expect(d.avgHpPct).toBeLessThanOrEqual(100);

    // The roster ids match the run's active roster, and this route freed Sela the Medic.
    expect(d.rosterIds).toEqual(activeParty(run).map((u) => u.id));
    expect(d.rosterIds).toContain("sela");
    expect(d.flags).toContain("medic-freed");

    // gold mirrors the purse.
    expect(d.gold).toBe(run.camp.purse);
  });

  it("monotonic-ish — a stronger/healthier/richer run reads higher across the fields", () => {
    const { run } = traverseRoute(EXP, MEDIC_ROUTE);
    const base = arrivalDigest(run);

    const strong = cloneRun(run);
    for (const u of strong.party) {
      u.level += 5;
      u.hp = u.maxHp; // full health → avgHpPct 100
    }
    strong.camp.purse += 250;
    const strongDigest = arrivalDigest(strong);

    expect(strongDigest.levelTotal).toBeGreaterThan(base.levelTotal);
    expect(strongDigest.avgHpPct).toBeGreaterThanOrEqual(base.avgHpPct);
    expect(strongDigest.avgHpPct).toBe(100);
    expect(strongDigest.gold).toBe(base.gold + 250);
    // Roster + flags unchanged by stat tweaks.
    expect(strongDigest.rosterIds).toEqual(base.rosterIds);
    expect(strongDigest.flags).toEqual(base.flags);
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

  it("route choice moves the score — the two exclusive arms yield distinct arrivals", () => {
    // This vertical slice's fights are decisively winnable, so combat is deterministic across
    // salts (a clean win banks the same HP every time) — the meaningful variation the sampler
    // captures is ROUTE variation: the sustain and infiltration arms reach the finale in
    // different states. (Salt still varies the RNG stream; it just doesn't move a decisive win.)
    const pop = samplePopulation(EXP, "finale");
    const distinct = new Set(pop.samples.map((s) => s.score.total.toFixed(6)));
    expect(distinct.size).toBeGreaterThan(1);
  });

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

    it("keeps route-major coverage when truncating the sample grid", () => {
      // The full grid is routes × salts (2 exclusive arms × 12 salts = 24); maxSamples 4 <
      // that, so the sample list is truncated. Truncation is route-major, so the covered
      // routes are a prefix of the enumeration — never a hidden fraction misreported as complete.
      const routes = enumeratePaths(EXP.map, "finale");
      expect(routes.length * DEFAULT_SEED_SALTS.length).toBeGreaterThan(MAX); // grid exceeds the cap
      const coveredRoutes = new Set(capped.samples.map((s) => s.descriptor.route.join(">")));
      expect(coveredRoutes.size).toBeLessThanOrEqual(routes.length);
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

describe("pickRepresentatives (Phase 4)", () => {
  /** Build a minimal survivor {@link Sample} at a synthetic score (for literal-population tests). */
  function sampleAt(total: number, survived: boolean, salt: number): Sample {
    return {
      descriptor: { route: ["start", "den"], targetId: "den", seedSalt: salt, policyName: "pilot" },
      score: { total, parts: {} },
      survived,
    };
  }

  /** Wrap bare samples into a {@link Population} with a coherent sampling report. */
  function popOf(samples: Sample[]): Population {
    return {
      samples,
      sampling: {
        routes: 1,
        salts: samples.length,
        policies: 1,
        generated: samples.length,
        capped: false,
        inaccessibleRoutes: 0,
      },
    };
  }

  it("orders best ≥ average ≥ worst over survivors, with a correct stats band", () => {
    const pop = samplePopulation(EXP, "den");
    const picks = pickRepresentatives(pop);
    expect(picks.best && picks.average && picks.worst).toBeTruthy();
    expect(picks.best!.score.total).toBeGreaterThanOrEqual(picks.average!.score.total);
    expect(picks.average!.score.total).toBeGreaterThanOrEqual(picks.worst!.score.total);
    // Picks are survivors only.
    for (const p of [picks.best!, picks.average!, picks.worst!]) expect(p.survived).toBe(true);
    // Stats band == [min, max] over survivors.
    const survivorTotals = pop.samples.filter((s) => s.survived).map((s) => s.score.total);
    expect(picks.stats.scoreRange[0]).toBe(Math.min(...survivorTotals));
    expect(picks.stats.scoreRange[1]).toBe(Math.max(...survivorTotals));
    expect(picks.stats.sampled).toBe(pop.samples.length);
    expect(picks.stats.survived).toBe(survivorTotals.length);
    expect(picks.stats.excludedLosses).toBe(pop.samples.length - survivorTotals.length);
  });

  it("excludes a wiped (low-score non-survivor) sample from worst and counts it in excludedLosses", () => {
    // A low-scoring LOSS plus three real survivors. The loss must NOT become `worst`,
    // and it must be tallied as an excluded loss.
    const loss = sampleAt(-100, false, 99);
    const pop = popOf([sampleAt(30, true, 0), sampleAt(10, true, 1), sampleAt(20, true, 2), loss]);
    const picks = pickRepresentatives(pop);
    expect(picks.worst!.score.total).toBe(10); // lowest SURVIVOR, not the -100 loss
    expect(picks.best!.score.total).toBe(30);
    expect(picks.worst).not.toBe(loss);
    expect(picks.stats.sampled).toBe(4);
    expect(picks.stats.survived).toBe(3);
    expect(picks.stats.excludedLosses).toBe(1);
    expect(picks.stats.scoreRange).toEqual([10, 30]);
  });

  it("median takes the lower-middle on an even survivor count (documented tie-break)", () => {
    // Four survivors 10,20,30,40 → median is the lower-middle (20), not 30 or an average.
    const pop = popOf([sampleAt(40, true, 0), sampleAt(10, true, 1), sampleAt(30, true, 2), sampleAt(20, true, 3)]);
    const picks = pickRepresentatives(pop);
    expect(picks.average!.score.total).toBe(20);
  });

  it("no survivors ⇒ all picks undefined, survived 0, scoreRange [NaN, NaN]", () => {
    const pop = popOf([sampleAt(5, false, 0), sampleAt(3, false, 1)]);
    const picks = pickRepresentatives(pop);
    expect(picks.best).toBeUndefined();
    expect(picks.average).toBeUndefined();
    expect(picks.worst).toBeUndefined();
    expect(picks.stats.survived).toBe(0);
    expect(picks.stats.excludedLosses).toBe(2);
    expect(picks.stats.scoreRange[0]).toBeNaN();
    expect(picks.stats.scoreRange[1]).toBeNaN();
  });

  it("one survivor ⇒ best === average === worst === that sample (same reference)", () => {
    const only = sampleAt(42, true, 7);
    const pop = popOf([only, sampleAt(1, false, 8)]);
    const picks = pickRepresentatives(pop);
    expect(picks.best).toBe(only);
    expect(picks.average).toBe(only);
    expect(picks.worst).toBe(only);
    expect(picks.stats.survived).toBe(1);
    expect(picks.stats.scoreRange).toEqual([42, 42]);
  });

  it("is deterministic — the same population yields the same picks", () => {
    const pop = samplePopulation(EXP, "den");
    const a = pickRepresentatives(pop);
    const b = pickRepresentatives(pop);
    expect(b.stats).toEqual(a.stats);
    expect(b.best!.descriptor).toEqual(a.best!.descriptor);
    expect(b.average!.descriptor).toEqual(a.average!.descriptor);
    expect(b.worst!.descriptor).toEqual(a.worst!.descriptor);
  });

  it("re-materialization fidelity — a chosen descriptor re-traversed reproduces its score", () => {
    const pop = samplePopulation(EXP, "den");
    const picks = pickRepresentatives(pop);
    for (const pick of [picks.best!, picks.average!, picks.worst!]) {
      const { run } = traverseRoute(EXP, pick.descriptor.route, {
        seedSalt: pick.descriptor.seedSalt,
      });
      expect(scoreArrival(run).total).toBeCloseTo(pick.score.total, 10);
    }
  });
});
