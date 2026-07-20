/**
 * Arrivals (Phase 3) — the **jump-tool front-end** of the expedition-analysis engine.
 *
 * Phase 1 ({@link "./expedition-sim"}) laid the routing + traversal floor: enumerate
 * routes, walk one headlessly to an {@link "./expedition-sim".Arrival}. This module
 * builds the next layer the **jump tool** needs — a way to ask, of a target node,
 * *"what do representative arrival states there look like?"*. Two pieces:
 *
 * - **{@link scoreArrival}** — a single legible number (plus its component breakdown)
 *   for *how strong / healthy a run is* at an arrival. The default weighting is a
 *   run-strength / run-health reading (a stronger, healthier, better-provisioned party
 *   scores higher); every weight is overridable, so a future "drama" weighting (where a
 *   tense near-loss scores *high*) is just a different {@link ScoreWeights} object.
 * - **{@link samplePopulation}** — the **population sampler**: cross every route to the
 *   target with a set of seed-salts and battle policies, traverse each, score it, and
 *   return a population of cheap, serializable {@link Sample}s. Phase 4 reads percentiles
 *   off this population to pick best / average / worst-survivor arrivals; the future
 *   validator reads aggregates + invariants off the same population.
 *
 * **Expedition-generic from line one (the load-bearing rule).** Every function takes an
 * {@link AuthoredExpedition}; nothing here hardcodes a specific expedition.
 * {@link "./hollow-mill".THE_HOLLOW_MILL} is only ever the *first argument* / the test
 * fixture. This is what makes the future generator-validator nearly free.
 *
 * Pure logic: no Phaser, no DOM, no `Math.random`. Determinism is load-bearing — the
 * only variance is the run's threaded RNG, fanned out by the {@link "./expedition-sim".TraverseOpts.seedSalt}
 * knob; identical arguments reproduce an identical population (same order, same scores).
 */

import {
  enumeratePaths,
  traverseRoute,
  type TraverseOpts,
} from "./expedition-sim";
import { clamp01 } from "./num";
import { activeRoster, type RunState } from "./run";
import { jobLevelOf } from "./leveling";
import { primaryJobOf, type Unit } from "./units";
import { slotsUsed, getMaterial } from "./inventory";
import { fatigueTierIndex } from "./fatigue";
import { moraleTierIndex } from "./camp";
import { PILOT_POLICY, type BattlePolicy } from "./ai";
import type { AuthoredExpedition } from "./expedition";

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * The per-component **weights** of {@link scoreArrival}. Each component is computed as a
 * roughly **0..1 (or 0..few) normalized magnitude** (see the normalization notes on each
 * field), then multiplied by its weight to produce its `parts` contribution; the score is
 * the sum. So a weight is "how many points a *full* unit of this component is worth", and
 * the *relative* weights are what set the tradeoffs. Every field is overridable, so a
 * different reading of "good arrival" (e.g. a drama weighting) is just a different object.
 */
export interface ScoreWeights {
  /** Party power: summed (character level + primary-job level) over the active roster. */
  levels: number;
  /** Party health: average current-HP fraction (`hp/maxHp`) over the active roster. */
  health: number;
  /** Party breadth: active roster size (recruits gained ⇒ a stronger run). */
  roster: number;
  /** Coffers: the run purse (`camp.gold`). */
  gold: number;
  /** Logistics: used inventory slots (provisioning depth). */
  supplies: number;
  /** A **penalty**: party fatigue (a tired party is a weaker arrival). Use a negative weight. */
  fatigue: number;
  /** Spirits: party morale tier. */
  morale: number;
  /** Build progress: set run flags + carried relic/unique items. */
  relics: number;
}

/**
 * The agreed **default weighting — run-strength / run-health.** A stronger, healthier,
 * better-provisioned, higher-morale, less-fatigued, further-progressed run scores higher.
 * Weights are tuned so each component contributes a comparable, legible band rather than
 * any one raw magnitude dominating (see {@link scoreArrival}'s normalization). `fatigue`
 * is **negative** — it subtracts. These are a heuristic dial, not a verdict: the vision's
 * honest caveat is that "strongest run" is not always "best demo", which is exactly why
 * the whole thing is overridable.
 */
export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  levels: 20,
  health: 25,
  roster: 15,
  gold: 10,
  supplies: 8,
  fatigue: -15,
  morale: 6,
  relics: 12,
};

/**
 * A scored arrival: a single {@link total} plus the per-component **weighted** breakdown
 * in {@link parts}, so a caller can see *why* one arrival outscores another (and a
 * collapse — e.g. every run wiped, so health dominates — stays visible, not hidden).
 * `total === sum(Object.values(parts))` by construction.
 */
export interface ArrivalScore {
  total: number;
  /** Each component's **weighted** contribution (weight × normalized magnitude). */
  parts: Record<string, number>;
}

/**
 * The roster-size beyond which the `roster` component is saturated. Normalizing roster
 * size against this keeps a lucky recruit from dwarfing every other axis: each active
 * unit is worth `1/ROSTER_REF` of the component, capped at 1. (Hollow Mill fields ~3–5,
 * so a reference of 6 gives a meaningful, un-saturated spread.)
 */
const ROSTER_REF = 6;

/**
 * The combined character+job-level beyond which the `levels` component is saturated.
 * Summed over the roster and divided by this, capped at 1. A fresh party (≈ roster ×
 * (level 1 + jobL1) = ~6–10) sits low; a leveled, recruited party climbs toward 1.
 */
const LEVELS_REF = 40;

/**
 * The purse beyond which the `gold` component is saturated. Gold runs to the hundreds, so
 * without this it would dwarf a 0..1 health fraction; dividing by this (and capping at 1)
 * folds it into the same band as every other component.
 */
const GOLD_REF = 300;

/**
 * The used-slot count beyond which the `supplies` component is saturated. Hollow Mill's
 * storage cap is small (≈6), so this doubles as "a full pack ≈ 1".
 */
const SUPPLIES_REF = 6;

/**
 * The total-fatigue beyond which the `fatigue` penalty is saturated. Fatigue is summed
 * across the roster as a 0..1 fraction of {@link "./fatigue".FATIGUE.exhausted} each
 * (via the tier ordinal), so the divisor scales with party size.
 */
const FATIGUE_REF = ROSTER_REF;

/**
 * The build-progress count beyond which the `relics` component is saturated — set flags
 * plus carried relic/unique items. A handful is plenty for the slice.
 */
const RELICS_REF = 4;

/**
 * The morale ordinal ceiling — Inspired, the top of {@link "./camp".moraleTierIndex}'s
 * ladder. Divides the ordinal into a 0..1 magnitude (Low worst, Inspired best).
 */
const MORALE_REF = 3; // Inspired

/**
 * The fatigue ordinal ceiling for scoring — the **Exhausted** named band.
 * {@link "./fatigue".fatigueTierIndex} keeps counting through the narrowing D80
 * bands above it (4, 5, …), but every band ≥ 3 *reads* Exhausted, so the score
 * clamps the index here (Rested best 0, Exhausted worst 1 after division).
 */
const FATIGUE_TIER_MAX = 3; // Exhausted

/**
 * Σ(character level + primary-job level) over a roster — the **levels fold** shared
 * by {@link scoreArrival} (normalized against {@link LEVELS_REF}) and
 * {@link arrivalDigest} (reported raw as `levelTotal`).
 */
function levelTotalOf(roster: readonly Unit[]): number {
  return roster.reduce((acc, u: Unit) => acc + u.level + jobLevelOf(u, primaryJobOf(u)), 0);
}

/**
 * Mean current-HP fraction (`hp/maxHp`) over a roster, 0 for an empty/wiped one —
 * the **health fold** shared by {@link scoreArrival} (a 0..1 magnitude) and
 * {@link arrivalDigest} (reported as a rounded percent).
 */
function avgHpFraction(roster: readonly Unit[]): number {
  if (roster.length === 0) return 0;
  return roster.reduce((acc, u) => acc + (u.maxHp > 0 ? u.hp / u.maxHp : 0), 0) / roster.length;
}

/** True if a carried material is a build-defining relic / unique (a `loot` or `partyGear` item, or an id tagged "relic"). */
function isRelicItem(id: string): boolean {
  const mat = getMaterial(id);
  if (!mat) return false;
  return Boolean(mat.partyGear) || id.startsWith("relic-");
}

/**
 * **Score an arrival's run** — a run-strength / run-health reading, component by component.
 *
 * Each component is reduced to a roughly **0..1 normalized magnitude** (a few components
 * can read slightly over 1 before the cap, but each is clamped to `[0,1]` against a
 * reference constant — see the `*_REF` constants and their docs) so that no single raw
 * scale (gold in the hundreds, a 0..1 HP fraction) dwarfs the rest. The magnitude is then
 * multiplied by its {@link ScoreWeights} weight to give the component's `parts` entry;
 * `total` is their sum. Components:
 *
 * - **levels** — `sum(level + primaryJobLevel)` over {@link activeRoster}, / {@link LEVELS_REF}.
 * - **health** — mean `hp/maxHp` over the active roster (already 0..1; 0 for an empty roster).
 * - **roster** — active roster size / {@link ROSTER_REF}.
 * - **gold** — `run.camp.gold` / {@link GOLD_REF}.
 * - **supplies** — {@link slotsUsed} / {@link SUPPLIES_REF}.
 * - **fatigue** — a **penalty**: summed per-unit fatigue-tier fraction / {@link FATIGUE_REF}
 *   (with the default *negative* `fatigue` weight this lowers the score; lower fatigue ⇒ higher score).
 * - **morale** — {@link "./camp".moraleTierIndex} ordinal / {@link MORALE_REF}.
 * - **relics** — (count of set `run.flags`) + (count of carried relic/unique materials), / {@link RELICS_REF}.
 *
 * Pure; reads the run, never mutates it. Deterministic: the same run yields the same score.
 */
export function scoreArrival(
  run: RunState,
  weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS,
): ArrivalScore {
  const roster = activeRoster(run);

  // levels — character + primary-job level, summed over the active roster.
  const levelsMag = clamp01(levelTotalOf(roster) / LEVELS_REF);

  // health — mean current-HP fraction (0 for an empty/wiped roster).
  const healthMag = clamp01(avgHpFraction(roster));

  // roster — active roster size (recruits gained ⇒ stronger).
  const rosterMag = clamp01(roster.length / ROSTER_REF);

  // gold — the run purse.
  const goldMag = clamp01(run.camp.gold / GOLD_REF);

  // supplies — used inventory slots (provisioning depth).
  const suppliesMag = clamp01(slotsUsed(run.inventory) / SUPPLIES_REF);

  // fatigue — summed per-unit tier fraction (a penalty via a negative weight).
  const fatigueSum = roster.reduce(
    (acc, u) => acc + Math.min(fatigueTierIndex(u.fatigue), FATIGUE_TIER_MAX) / FATIGUE_TIER_MAX,
    0,
  );
  const fatigueMag = clamp01(fatigueSum / FATIGUE_REF);

  // morale — the camp morale tier.
  const moraleMag = clamp01(moraleTierIndex(run.camp.morale) / MORALE_REF);

  // relics/flags — set flags + carried relic/unique items (a build-progress proxy).
  const setFlags = Object.values(run.flags).filter(Boolean).length;
  const relicItems = Object.entries(run.inventory.counts).filter(
    ([id, n]) => n > 0 && isRelicItem(id),
  ).length;
  const relicsMag = clamp01((setFlags + relicItems) / RELICS_REF);

  const parts: Record<string, number> = {
    levels: weights.levels * levelsMag,
    health: weights.health * healthMag,
    roster: weights.roster * rosterMag,
    gold: weights.gold * goldMag,
    supplies: weights.supplies * suppliesMag,
    fatigue: weights.fatigue * fatigueMag,
    morale: weights.morale * moraleMag,
    relics: weights.relics * relicsMag,
  };

  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  return { total, parts };
}

// ---------------------------------------------------------------------------
// Arrival digest — a legible, display-ready state preview
// ---------------------------------------------------------------------------

/**
 * A small, **pure, display-ready** description of a run's state at an arrival — the
 * legible struct the jump-tool UI renders into a one-line preview (e.g.
 * `Lv 66 · HP 100% · 210g · 4 units · [medic-freed]`). Unlike {@link scoreArrival}
 * (a single weighted *number* for ranking), this is the **human-readable** breakdown:
 * the totals a developer eyeballs to recognize "is this the arrival I wanted".
 */
export interface ArrivalDigest {
  /** Σ(character level + primary-job level) over the {@link activeRoster}. */
  levelTotal: number;
  /** Mean current-HP fraction (`hp/maxHp`) over the active roster, as a 0..100 percent (rounded). 0 for an empty roster. */
  avgHpPct: number;
  /** The run purse (`camp.gold`). */
  gold: number;
  /** The active roster's unit ids (alive, uncaptured), in roster order. */
  rosterIds: string[];
  /** The keys of the run's **set** flags (build-progress markers like `medic-freed`). */
  flags: string[];
}

/**
 * **Digest a run's state for display** — the pure, testable struct the jump-tool UI
 * formats into a one-line preview. Reads the run, never mutates it; deterministic
 * (the same run yields the same digest).
 *
 * - **levelTotal** — `Σ(level + primaryJobLevel)` over {@link activeRoster}.
 * - **avgHpPct** — mean `hp/maxHp` over the active roster, ×100 rounded (0 for an empty roster).
 * - **gold** — `run.camp.gold`.
 * - **rosterIds** — the active roster's unit ids, in roster order.
 * - **flags** — the keys of the run's **set** flags.
 */
export function arrivalDigest(run: RunState): ArrivalDigest {
  const roster = activeRoster(run);
  const avgHpPct = Math.round(avgHpFraction(roster) * 100);
  return {
    levelTotal: levelTotalOf(roster),
    avgHpPct,
    gold: run.camp.gold,
    rosterIds: roster.map((u) => u.id),
    flags: Object.entries(run.flags)
      .filter(([, set]) => set)
      .map(([key]) => key),
  };
}

// ---------------------------------------------------------------------------
// Population sampling
// ---------------------------------------------------------------------------

/** A battle policy pair under a stable name — the A/B label a sample carries. */
export interface NamedPolicy {
  name: string;
  policy: { player: BattlePolicy; enemy: BattlePolicy };
}

/**
 * The **lightweight, serializable identity** of a sample — route + salt + policy name. It
 * is *not* the heavy played run/loop: a descriptor can be **re-materialized** later via
 * `traverseRoute(exp, descriptor.route, { seedSalt, policy })`, so a population stays
 * cheap (scores + descriptors, not runs) and a future offline cache can store descriptors
 * and replay them on demand.
 */
export interface SampleDescriptor {
  /** The full route walked, `startId … targetId`. */
  route: string[];
  /** The target node id (the last id of {@link route}). */
  targetId: string;
  /** The seed-salt that produced this sample's variance (absent ⇒ the canonical seed). */
  seedSalt?: number;
  /** The {@link NamedPolicy} name this sample was traversed under. */
  policyName: string;
}

/** One scored point in a {@link Population}. */
export interface Sample {
  /** The cheap, replayable identity of this sample. */
  descriptor: SampleDescriptor;
  /** Its {@link scoreArrival} reading. */
  score: ArrivalScore;
  /**
   * Whether the arrival is **reachable without a wipe** — `!run.over` at the target,
   * pre-resolution. A wipe-on-the-way is scored (low) but flagged `false`; Phase 4
   * filters survivors for its worst-survivor pick.
   */
  survived: boolean;
}

/** Tuning for {@link samplePopulation}. */
export interface PopulationOpts {
  /** The variety knob: one sample per route × salt × policy. Defaults to `[0..11]` (12). */
  seedSalts?: number[];
  /** A/B policies. Defaults to a single pilot-on-both-sides policy. */
  policies?: NamedPolicy[];
  /** Scoring weights. Defaults to {@link DEFAULT_SCORE_WEIGHTS}. */
  weights?: ScoreWeights;
  /** A cap on generated samples (the scale safety net). Defaults to {@link DEFAULT_MAX_SAMPLES}. */
  maxSamples?: number;
}

/** A scored population of arrivals at a target, plus a sampling report. */
export interface Population {
  samples: Sample[];
  /**
   * The **honest sampling report** — never a silent fraction. `routes`/`salts`/`policies`
   * are the *true* dimensions of the requested grid; `generated` is how many samples were
   * actually produced (== `samples.length`); `capped` is true when the full grid exceeded
   * `maxSamples` and was subsampled down (see {@link samplePopulation}'s subsample rule);
   * `inaccessibleRoutes` counts routes that are structurally valid (in
   * {@link enumeratePaths}) but **runtime-inaccessible** — a forward edge that
   * {@link "./run".nodeAccessible} gates shut once run state is played (e.g. the
   * secured-Wagon edge closing once the Medic is freed). Such a route yields **no**
   * samples and is surfaced here rather than crashing the sampler — exactly the
   * "strand the player" corner case the validator (and the jump tool) must see.
   */
  sampling: {
    routes: number;
    salts: number;
    policies: number;
    generated: number;
    capped: boolean;
    inaccessibleRoutes: number;
  };
}

/** The default seed-salts — 12 distinct combat-variance draws per (route × policy). */
export const DEFAULT_SEED_SALTS: number[] = Array.from({ length: 12 }, (_, i) => i);

/** The default population cap (the scale safety net the vision calls for). */
export const DEFAULT_MAX_SAMPLES = 256;

/** The default policy set — pilot on both sides (our baseline; every experiment is measured against it). */
export const DEFAULT_POLICIES: NamedPolicy[] = [
  { name: "pilot", policy: { player: PILOT_POLICY, enemy: PILOT_POLICY } },
];

/**
 * **Sample a population of arrivals** at `targetId` — the jump tool's data source.
 *
 * The requested grid is **routes × salts × policies**: routes from {@link enumeratePaths}
 * `(exp.map, targetId)`; salts from {@link PopulationOpts.seedSalts} (default
 * {@link DEFAULT_SEED_SALTS}); policies from {@link PopulationOpts.policies} (default
 * {@link DEFAULT_POLICIES}). For each cell it {@link traverseRoute}s with that salt and
 * policy, {@link scoreArrival}s the resulting run (**even if the run wiped** — a
 * wipe-on-arrival is a low-scoring `survived:false` sample, not dropped; Phase 4 filters
 * survivors), and builds a cheap {@link Sample} (descriptor + score + survived).
 *
 * **No silent caps (the scale rule).** If `routes × salts × policies > maxSamples`, the
 * salts axis is **deterministically strided down** before traversal so the cap is honored
 * without ever analyzing a hidden fraction: keep `floor(maxSamples / (routes × policies))`
 * salts, evenly spaced by `stride = ceil(totalSalts / keep)` (taking salts at indices
 * `0, stride, 2·stride, …`, then trimming to `keep`). This keeps full route × policy
 * coverage (the structural axes) and thins only the variance axis, deterministically.
 * {@link Population.sampling} always reports the **true** routes/salts/policies counts and
 * sets `capped = true`. (When even one salt per route×policy still exceeds the cap, the
 * sample list itself is truncated to the cap — an extreme-branchiness fallback, still
 * deterministic and still flagged.)
 *
 * Determinism: the iteration order is route-major, then salt, then policy, and traversal
 * is seed-driven, so identical arguments reproduce an identical population.
 */
export function samplePopulation(
  exp: AuthoredExpedition,
  targetId: string,
  opts: PopulationOpts = {},
): Population {
  const routes = enumeratePaths(exp.map, targetId);
  const salts = opts.seedSalts ?? DEFAULT_SEED_SALTS;
  const policies = opts.policies ?? DEFAULT_POLICIES;
  const weights = opts.weights ?? DEFAULT_SCORE_WEIGHTS;
  const maxSamples = opts.maxSamples ?? DEFAULT_MAX_SAMPLES;

  const routeCount = routes.length;
  const saltCount = salts.length;
  const policyCount = policies.length;
  const requested = routeCount * saltCount * policyCount;

  // --- Cap handling: deterministically thin the variance (salts) axis first ----
  let usedSalts = salts;
  let capped = false;
  if (requested > maxSamples) {
    capped = true;
    const perRoutePolicy = routeCount * policyCount;
    // How many salts we can keep while honoring the cap (at least 1).
    const keep = Math.max(1, Math.floor(maxSamples / Math.max(1, perRoutePolicy)));
    if (keep < saltCount) {
      const stride = Math.max(1, Math.ceil(saltCount / keep));
      const strided: number[] = [];
      for (let i = 0; i < saltCount && strided.length < keep; i += stride) {
        strided.push(salts[i]);
      }
      usedSalts = strided;
    }
  }

  // --- Traverse the (route × salt × policy) grid, route-major then salt then policy ---
  const samples: Sample[] = [];
  let inaccessibleRoutes = 0;
  outer: for (const route of routes) {
    let routeInaccessible = false;
    for (const salt of usedSalts) {
      if (routeInaccessible) break;
      for (const np of policies) {
        // The cap is a hard ceiling even after striding (extreme-branchiness fallback).
        if (samples.length >= maxSamples) {
          capped = true;
          break outer;
        }
        const traverseOpts: TraverseOpts = { seedSalt: salt, policy: np.policy };
        // A route can be structurally valid yet runtime-inaccessible: `nodeAccessible`
        // (run.ts) gates an edge shut once run state is played (the secured-Wagon edge
        // closes once the Medic is freed). `traverseRoute` throws on such a hop. Count
        // the route as inaccessible and skip it rather than crash — the report surfaces it.
        let run: RunState;
        try {
          ({ run } = traverseRoute(exp, route, traverseOpts));
        } catch {
          routeInaccessible = true;
          inaccessibleRoutes += 1;
          break;
        }
        const score = scoreArrival(run, weights);
        samples.push({
          descriptor: {
            route: [...route],
            targetId,
            seedSalt: salt,
            policyName: np.name,
          },
          score,
          survived: !run.over,
        });
      }
    }
  }

  return {
    samples,
    sampling: {
      routes: routeCount,
      salts: saltCount,
      policies: policyCount,
      generated: samples.length,
      capped,
      inaccessibleRoutes,
    },
  };
}

// ---------------------------------------------------------------------------
// Representative selection (Phase 4) — the "magic button"
// ---------------------------------------------------------------------------

/**
 * The three **representative arrivals** the jump tool boots, plus an honest report.
 *
 * {@link best}, {@link average} and {@link worst} are picked from the **survivors** of a
 * {@link Population} (samples whose run did not wipe on the way) — losses are excluded so
 * "worst" is the worst *survivable* arrival, not "the player threw the run". Any pick can be
 * `undefined` when there are no survivors (see {@link pickRepresentatives}); with a single
 * survivor all three are that same sample.
 *
 * {@link stats} surfaces *why* — how many were sampled, how many survived, how many losses
 * were excluded, and the survivor score band — so a collapse (every run wiped, or the band
 * pinching to a point) is visible rather than hidden, exactly the vision's "surface the
 * stats so a collapse isn't hidden" requirement.
 */
export interface ArrivalPicks {
  /** The highest-scoring survivor (best-case arrival). Absent ⇒ no survivors. */
  best?: Sample;
  /** The median survivor (typical arrival). Absent ⇒ no survivors. */
  average?: Sample;
  /** The lowest-scoring survivor (worst *survivable* arrival; losses excluded). Absent ⇒ no survivors. */
  worst?: Sample;
  /** The honest selection report. */
  stats: {
    /** Total samples considered (`population.samples.length`). */
    sampled: number;
    /** Survivor count (samples with `survived === true`). */
    survived: number;
    /** Sampled minus survived — the losses excluded from the picks. */
    excludedLosses: number;
    /** `[min, max]` of `score.total` over **survivors**; `[NaN, NaN]` when there are none. */
    scoreRange: [number, number];
  };
}

/**
 * Pick the **median** element of an already-ascending-sorted, non-empty array. On an **even**
 * count the **lower-middle** is taken (index `floor((n - 1) / 2)`) — a deliberate, documented
 * tie-break so the choice is fully deterministic given the population (no averaging of two
 * samples, which a `Sample` can't represent anyway). Factored out as the single place the
 * percentile choice lives: today it's a literal max/median/min over survivors, and swapping
 * in an outlier-robust percentile (e.g. p95/p5) later is a change here and at the call site
 * only, not a rework of the selector.
 */
function medianOf<T>(sortedAscending: T[]): T {
  return sortedAscending[Math.floor((sortedAscending.length - 1) / 2)];
}

/**
 * **Pick representative arrivals** from a scored {@link Population} — the data behind the
 * jump tool's "best / average / worst" magic button.
 *
 * Survivors only: samples with `survived === true` are kept; wipe-on-the-way losses are
 * **excluded** (counted in `stats.excludedLosses`) so "worst" is the worst *survivable*
 * arrival rather than a run the player lost through poor choices. Survivors are sorted by
 * `score.total` **ascending** (a stable sort — ties keep population/iteration order, which is
 * itself deterministic, so identical populations yield identical picks). Then:
 *
 * - **best** = the highest-scoring survivor (the literal best case).
 * - **average** = the **median** survivor (see {@link medianOf} — lower-middle on an even count).
 * - **worst** = the lowest-scoring survivor (the literal worst *survivable* case).
 *
 * These are a max / median / min over survivors today. The vision notes outlier-robust
 * percentiles (p95/p5) as a future option; the selection is kept to one small helper so that
 * swap stays trivial.
 *
 * **Edge cases (never throws):**
 * - *No survivors* ⇒ all three picks `undefined`, `stats.survived === 0`, and
 *   `scoreRange === [NaN, NaN]` (a deliberate "no band exists" sentinel — `NaN`, not `[0,0]`,
 *   so an empty band is never confused with a real band that happens to sit at zero).
 * - *One survivor* ⇒ `best === average === worst === that sample` (the same object reference).
 *
 * Pure; reads the population, never mutates it. Deterministic given the population.
 */
export function pickRepresentatives(population: Population): ArrivalPicks {
  const sampled = population.samples.length;
  const survivors = population.samples.filter((s) => s.survived);
  const survived = survivors.length;
  const excludedLosses = sampled - survived;

  if (survived === 0) {
    return {
      best: undefined,
      average: undefined,
      worst: undefined,
      stats: { sampled, survived, excludedLosses, scoreRange: [NaN, NaN] },
    };
  }

  // Ascending by score.total; stable (preserves the deterministic population order on ties).
  const sorted = [...survivors].sort((a, b) => a.score.total - b.score.total);
  const worst = sorted[0];
  const best = sorted[sorted.length - 1];
  const average = medianOf(sorted);

  return {
    best,
    average,
    worst,
    stats: {
      sampled,
      survived,
      excludedLosses,
      scoreRange: [worst.score.total, best.score.total],
    },
  };
}
