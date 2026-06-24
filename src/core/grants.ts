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

import type { Unit } from "./units";
import { recalls } from "./units";
import type { RunState } from "./run";
import { getNode, type MapNode, type NodeKind } from "./overworld";
import type { JobId } from "./jobs";
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
 * unit (`jobLevel`/`charLevel`/`unitId`/`remembers`) or the run/context
 * (`holdsItem`/`atNode`/`atNodeKind`); `all`/`any` compose. An empty `all` is
 * trivially true — the default-open base (no gate ⇒ open).
 */
export type Predicate =
  | { kind: "jobLevel"; job: JobId; min: number }
  | { kind: "charLevel"; min: number }
  | { kind: "holdsItem"; item: string }
  | { kind: "atNode"; node: string }
  | { kind: "atNodeKind"; nodeKind: NodeKind }
  | { kind: "unitId"; id: string }
  | { kind: "remembers"; flag: string }
  | { kind: "all"; of: Predicate[] }
  | { kind: "any"; of: Predicate[] };

/**
 * Evaluate a {@link Predicate} for `unit` in `ctx` (D65) — pure, deterministic.
 * `jobLevel`/`charLevel` read the unit's levels; `holdsItem` reads `run.inventory`;
 * `atNode`/`atNodeKind` read the supplied `node` (falling back to `run.mapNodeId` /
 * the run's current node); `remembers` reads the unit's memory bag; `all`/`any`
 * compose.
 */
export function evalPredicate(pred: Predicate, unit: Unit, ctx: PredicateCtx): boolean {
  switch (pred.kind) {
    case "jobLevel":
      return jobLevelOf(unit, pred.job) >= pred.min;
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
 * A grant **effect** (D65) — what a satisfied {@link Grant} does. `addHeldJob` is
 * the **breadth** half (acquire a job); the `prestige` **depth** half joins this
 * union in the prestige increment. Applied through the exhaustive
 * {@link GRANT_EFFECT_HANDLERS}.
 */
export type GrantEffect =
  | { kind: "addHeldJob"; job: JobId };

/** A grant (D65): an eligibility {@link Predicate} guarding a {@link GrantEffect}. */
export interface Grant {
  when: Predicate;
  then: GrantEffect;
}

/** What applying a {@link GrantEffect} did (D65) — the report the caller surfaces. */
export type GrantResult =
  | { kind: "addHeldJob"; ok: boolean; job: JobId };

/**
 * The grant-effect registry (D65) — a handler per {@link GrantEffect} kind. The
 * mapped type `{ [K in GrantEffect["kind"]]: ... }` is **exhaustive at compile
 * time** (mirroring `BATTLE_EFFECT_HANDLERS`/`FORECAST_HANDLERS`): adding a kind to
 * {@link GrantEffect} fails the build here until its handler is written.
 */
const GRANT_EFFECT_HANDLERS: {
  [K in GrantEffect["kind"]]: (effect: Extract<GrantEffect, { kind: K }>, unit: Unit, run: RunState) => GrantResult;
} = {
  addHeldJob: (effect, unit, _run) => {
    if (!unit.heldJobs.includes(effect.job)) unit.heldJobs.push(effect.job);
    return { kind: "addHeldJob", ok: true, job: effect.job };
  },
};

/** The {@link Grant}s whose predicate `unit` currently satisfies in `ctx` (D65). */
export function eligibleGrants(unit: Unit, grants: readonly Grant[], ctx: PredicateCtx): Grant[] {
  return grants.filter((g) => evalPredicate(g.when, unit, ctx));
}

/**
 * Apply a {@link GrantEffect} to `unit` (D65) — dispatched through the exhaustive
 * registry. The eligibility check is {@link eligibleGrants}' job; this just applies.
 */
export function applyGrantEffect(effect: GrantEffect, unit: Unit, run: RunState): GrantResult {
  const handler = GRANT_EFFECT_HANDLERS[effect.kind] as (e: GrantEffect, u: Unit, r: RunState) => GrantResult;
  return handler(effect, unit, run);
}

/** Apply a {@link Grant}'s effect to `unit` (D65). */
export function applyGrant(grant: Grant, unit: Unit, run: RunState): GrantResult {
  return applyGrantEffect(grant.then, unit, run);
}
