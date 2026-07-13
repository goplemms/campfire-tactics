/**
 * The grant seam (D65) — one `predicate → effect` machine serving both **breadth**
 * (acquiring a held job) and **depth** (prestige, added in the prestige increment).
 *
 * A {@link Grant} pairs an eligibility {@link Predicate} with a {@link GrantEffect}:
 * {@link eligibleGrants} filters a list by predicate, {@link applyGrant} applies the
 * effect. Predicates are **composable** and **default-open** — an empty `all` is
 * trivially true, so "no gate" means "open". Effects are applied through an
 * **exhaustive mapped-type registry** ({@link GRANT_EFFECT_HANDLERS}, mirroring
 * `skills.ts`'s `BATTLE_EFFECT_HANDLERS`), so a new effect kind fails the build until
 * it has a handler.
 *
 * Pure logic: no Phaser, no DOM, no RNG — eligibility and application are
 * deterministic functions of the unit + run.
 */

import { recalls, primaryJobOf, type Unit } from "./units";
import type { RunState } from "./run";
import { getNode, type MapNode, type NodeKind } from "./overworld";
import { getJob, stampPassives, type JobId, type JobLookup } from "./jobs";
import { jobLevelOf } from "./leveling";

/** The read-only context a {@link Predicate} evaluates against (D65). */
export interface PredicateCtx {
  /** The run — backs `holdsItem` (inventory) and `atNode`/`atNodeKind` (position). */
  run: RunState;
  /** The node in question, if the caller has one (else `atNode*` read `run.mapNodeId`). */
  node?: MapNode;
}

/**
 * A composable, **default-open** eligibility predicate (D65). Leaf kinds read the
 * unit (`jobLevel`/`holdsJob`/`charLevel`/`unitId`/`remembers`) or the run/context
 * (`holdsItem`/`atNode`/`atNodeKind`/`flagSet`); `all`/`any` compose. An empty `all`
 * is trivially true — the default-open base (no gate ⇒ open). The run-scoped leaves
 * are also evaluable **without a unit** via {@link evalPredicateRun} (the #127
 * predicate-on-node access seam — `flagSet` is that seam's run-flag leaf).
 */
export type Predicate =
  | { kind: "jobLevel"; job: JobId; min: number }
  | { kind: "holdsJob"; job: JobId }
  | { kind: "charLevel"; min: number }
  | { kind: "holdsItem"; item: string }
  | { kind: "atNode"; node: string }
  | { kind: "atNodeKind"; nodeKind: NodeKind }
  | { kind: "unitId"; id: string }
  | { kind: "remembers"; flag: string }
  | { kind: "flagSet"; flag: string }
  | { kind: "all"; of: Predicate[] }
  | { kind: "any"; of: Predicate[] };

/**
 * Evaluate a {@link Predicate} for `unit` in `ctx` (D65) — pure, deterministic.
 * `jobLevel`/`charLevel` read the unit's levels; `holdsJob` asks whether the unit
 * *is* that class (holds it in `heldJobs`) — the "is a Scout" gate that `jobLevel …
 * min: 1` can't express (an untrained job reads level 1, so `min: 1` matches every
 * unit — #179); `holdsItem` reads `run.inventory`; `atNode`/`atNodeKind` read the
 * supplied `node` (falling back to `run.mapNodeId` / the run's current node);
 * `remembers` reads the unit's memory bag; `all`/`any` compose.
 */
export function evalPredicate(pred: Predicate, unit: Unit, ctx: PredicateCtx): boolean {
  switch (pred.kind) {
    case "jobLevel":
      return jobLevelOf(unit, pred.job) >= pred.min;
    case "holdsJob":
      return unit.heldJobs.includes(pred.job);
    case "charLevel":
      return unit.level >= pred.min;
    case "holdsItem":
      return (ctx.run.inventory.counts[pred.item] ?? 0) > 0;
    case "atNode":
      return (ctx.node?.id ?? ctx.run.mapNodeId) === pred.node;
    case "atNodeKind": {
      const node = ctx.node ?? getNode(ctx.run.map, ctx.run.mapNodeId);
      return node.kind === pred.nodeKind;
    }
    case "unitId":
      return unit.id === pred.id;
    case "remembers":
      return recalls(unit, pred.flag);
    case "flagSet":
      return Boolean(ctx.run.flags[pred.flag]);
    case "all":
      return pred.of.every((p) => evalPredicate(p, unit, ctx));
    case "any":
      return pred.of.some((p) => evalPredicate(p, unit, ctx));
    default: {
      const _exhaustive: never = pred;
      return _exhaustive;
    }
  }
}

/**
 * Evaluate a **run-level** predicate — the unit-less {@link evalPredicate} flavor
 * (#127, the predicate-on-node access seam). Node access ({@link "./run".nodeAccessible})
 * has no acting unit, so only the run-scoped leaves (`flagSet` / `holdsItem` /
 * `atNode` / `atNodeKind`) and their `all`/`any` compositions are meaningful; a
 * unit-scoped leaf (`jobLevel` / `holdsJob` / `charLevel` / `unitId` / `remembers`) in a
 * run-level predicate is an authoring error and throws loudly (mirrors the D88 load-validator
 * ethos). Same leaf semantics as {@link evalPredicate}, minus the unit reads.
 */
export function evalPredicateRun(pred: Predicate, ctx: PredicateCtx): boolean {
  switch (pred.kind) {
    case "flagSet":
      return Boolean(ctx.run.flags[pred.flag]);
    case "holdsItem":
      return (ctx.run.inventory.counts[pred.item] ?? 0) > 0;
    case "atNode":
      return (ctx.node?.id ?? ctx.run.mapNodeId) === pred.node;
    case "atNodeKind": {
      const node = ctx.node ?? getNode(ctx.run.map, ctx.run.mapNodeId);
      return node.kind === pred.nodeKind;
    }
    case "all":
      return pred.of.every((p) => evalPredicateRun(p, ctx));
    case "any":
      return pred.of.some((p) => evalPredicateRun(p, ctx));
    case "jobLevel":
    case "holdsJob":
    case "charLevel":
    case "unitId":
    case "remembers":
      throw new Error(`evalPredicateRun: "${pred.kind}" is unit-scoped and has no run-level meaning`);
    default: {
      const _exhaustive: never = pred;
      return _exhaustive;
    }
  }
}

/**
 * A grant **effect** (D65) — what a satisfied {@link Grant} does. `addHeldJob` is
 * the **breadth** half (acquire a job); the `prestige` **depth** half joins this
 * union in the prestige increment. Applied through the exhaustive
 * {@link GRANT_EFFECT_HANDLERS}.
 */
export type GrantEffect =
  | { kind: "addHeldJob"; job: JobId }
  | { kind: "prestige"; from: JobId; into: JobId };

/** A grant (D65): an eligibility {@link Predicate} guarding a {@link GrantEffect}. */
export interface Grant {
  when: Predicate;
  then: GrantEffect;
}

/**
 * A prestige **branch** authored on a {@link "./jobs".JobDef} (D65): the job evolves
 * `into` another when `when` holds (the default floor is `jobLevel ≥ N`). Chains fall
 * out — the `into` job may carry its own `.prestige`.
 */
export interface PrestigeBranch {
  into: JobId;
  when: Predicate;
}

/** A {@link PrestigeBranch} resolved against a unit (D65): which held job it evolves `from`. */
export interface PrestigeOption extends PrestigeBranch {
  from: JobId;
}

/** What applying a {@link GrantEffect} did (D65) — the report the caller surfaces. */
export type GrantResult =
  | { kind: "addHeldJob"; ok: boolean; job: JobId }
  | { kind: "prestige"; ok: boolean; from: JobId; into: JobId };

/**
 * The grant-effect registry (D65) — a handler per {@link GrantEffect} kind. The
 * mapped type `{ [K in GrantEffect["kind"]]: ... }` is **exhaustive at compile
 * time** (mirroring `BATTLE_EFFECT_HANDLERS`/`FORECAST_HANDLERS`): adding a kind to
 * {@link GrantEffect} fails the build here until its handler is written.
 */
const GRANT_EFFECT_HANDLERS: {
  [K in GrantEffect["kind"]]: (
    effect: Extract<GrantEffect, { kind: K }>,
    unit: Unit,
    run: RunState,
    lookup: JobLookup,
  ) => GrantResult;
} = {
  addHeldJob: (effect, unit) => {
    if (!unit.heldJobs.includes(effect.job)) unit.heldJobs.push(effect.job);
    return { kind: "addHeldJob", ok: true, job: effect.job };
  },
  prestige: (effect, unit, _run, lookup) => prestige(unit, effect.from, effect.into, lookup),
};

/** The {@link Grant}s whose predicate `unit` currently satisfies in `ctx` (D65). */
export function eligibleGrants(unit: Unit, grants: readonly Grant[], ctx: PredicateCtx): Grant[] {
  return grants.filter((g) => evalPredicate(g.when, unit, ctx));
}

/**
 * Apply a {@link GrantEffect} to `unit` (D65) — dispatched through the exhaustive
 * registry. The eligibility check is {@link eligibleGrants}' job; this just applies.
 * `lookup` resolves job data for the `prestige` re-stamp (`getJob` by default,
 * injected by fixtures).
 */
export function applyGrantEffect(
  effect: GrantEffect,
  unit: Unit,
  run: RunState,
  lookup: JobLookup = getJob,
): GrantResult {
  const handler = GRANT_EFFECT_HANDLERS[effect.kind] as (
    e: GrantEffect,
    u: Unit,
    r: RunState,
    l: JobLookup,
  ) => GrantResult;
  return handler(effect, unit, run, lookup);
}

/** Apply a {@link Grant}'s effect to `unit` (D65). */
export function applyGrant(grant: Grant, unit: Unit, run: RunState, lookup: JobLookup = getJob): GrantResult {
  return applyGrantEffect(grant.then, unit, run, lookup);
}

/**
 * **Prestige** (D65) — replace a job **in place** (depth, not breadth): the evolved
 * `into` job takes the same `heldJobs` slot its `from` base held (replace, not
 * stack), carries the base's level/xp (it *is* the job evolved), and the unit
 * re-stamps passives off the evolved primary (skills follow via the standardized
 * `primaryJobOf` readers). Chains naturally — `into` may itself carry `.prestige`.
 *
 * Guarded: a no-op (`ok:false`) if the unit doesn't hold `from`, or already holds
 * `into`. If `from` was the effective primary, `into` takes the primary seat; the
 * readonly `jobId` (the frozen original class) never changes. `lookup` resolves the
 * evolved job's passives — `getJob` by default; injected by fixtures.
 */
export function prestige(
  unit: Unit,
  from: JobId,
  into: JobId,
  lookup: JobLookup = getJob,
): Extract<GrantResult, { kind: "prestige" }> {
  const slot = unit.heldJobs.indexOf(from);
  if (slot < 0 || unit.heldJobs.includes(into)) {
    return { kind: "prestige", ok: false, from, into };
  }
  const wasPrimary = primaryJobOf(unit) === from;
  unit.heldJobs[slot] = into; // same slot — replace, not stack
  if (wasPrimary) unit.primaryJob = into;
  // Carry the job's progression — the evolved job keeps its level/xp.
  const progress = unit.jobLevels[from];
  if (progress) {
    unit.jobLevels[into] = progress;
    delete unit.jobLevels[from];
  }
  // Re-stamp passives off the evolved primary (skills now read it too, via primaryJobOf).
  stampPassives(unit, lookup);
  return { kind: "prestige", ok: true, from, into };
}

/**
 * Every prestige branch reachable from the unit's **held jobs** (D65), tagged with
 * the `from` job carrying it. Reads `JobDef.prestige`; `lookup` resolves the job data
 * (`getJob` by default, injected by fixtures). Pure — does not filter by eligibility.
 */
export function prestigeOptions(unit: Unit, lookup: JobLookup = getJob): PrestigeOption[] {
  const out: PrestigeOption[] = [];
  for (const from of unit.heldJobs) {
    for (const branch of lookup(from)?.prestige ?? []) {
      out.push({ from, into: branch.into, when: branch.when });
    }
  }
  return out;
}

/**
 * The prestige options the unit is **eligible** for right now (D65) — {@link
 * prestigeOptions} filtered by {@link evalPredicate}. After a {@link prestige} the
 * unit holds the evolved job, so a fresh call surfaces that job's own branches — the
 * chain falls out for free.
 */
export function eligiblePrestiges(unit: Unit, ctx: PredicateCtx, lookup: JobLookup = getJob): PrestigeOption[] {
  return prestigeOptions(unit, lookup).filter((o) => evalPredicate(o.when, unit, ctx));
}
