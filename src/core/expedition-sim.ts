/**
 * Expedition-sim (Phase 1) — the headless **expedition-analysis substrate**.
 *
 * Demo-testing needs to **jump straight to a node** in a representative arrival
 * state instead of replaying a whole run; the *same* machinery — enumerate routes,
 * traverse headlessly, (later) sample a population and score it — is also what a
 * future procedural-quest **validator** needs to ask "is this expedition feasible,
 * and where are the corner cases?". So this is one engine with (eventually) two
 * front-ends; Phase 1 lays its routing + traversal floor.
 *
 * **Expedition-generic from line one (the load-bearing rule).** Every function here
 * takes an {@link AuthoredExpedition} (or a bare {@link OverworldMap}); it NEVER
 * hardcodes a specific expedition. {@link "./hollow-mill".THE_HOLLOW_MILL} is only
 * ever the *first argument* / the test fixture. Retrofitting genericity later is the
 * painful path, so the substrate is generic up front — that is the single decision
 * that makes the future generator-validator nearly free.
 *
 * This is the **dynamic, played-through** counterpart to the *structural*
 * {@link "./expedition".validateExpedition}: where that checks the static graph,
 * this walks a concrete route through the real overworld pipeline (camp → stage →
 * auto-battle → resolve) so route-dependent run state (recruits, flags, gold,
 * casualties) is the *played* truth.
 *
 * Pure logic: no Phaser, no DOM, no `Math.random`. Determinism is load-bearing —
 * the run's single threaded RNG is the only source of variance, and the
 * {@link TraverseOpts.seedSalt} knob re-seeds it (same authored map/encounters,
 * different combat tie-breaks) for the future sampling pass.
 */

import { saltSeed } from "./rng";
import { Labels } from "./rng-labels";
import { createRun, createRunFromExpedition, type RunState } from "./run";
import { createUnit } from "./units";
import { RunLoop } from "./runloop";
import { getNode, type OverworldMap } from "./overworld";
import type { AuthoredExpedition } from "./expedition";
import type { BattlePolicy } from "./ai";

/**
 * All **simple paths** from the map's start node to `targetId`, following
 * {@link "./overworld".MapNode.edges} forward. A depth-first walk that guards
 * against revisiting a node already on the current path (defensive — the overworld
 * is a DAG, so a cycle shouldn't arise, but cross-layer skip-edges make the guard
 * cheap insurance). Each returned path is an array of node ids starting at
 * `map.startId` and ending at `targetId`; the result is empty when `targetId` is
 * genuinely unreachable from the start. Throws if `targetId` is not a node in the
 * map (an unknown target is a caller bug, not "unreachable").
 */
export function enumeratePaths(map: OverworldMap, targetId: string): string[][] {
  getNode(map, targetId); // throws a clear error if the target id is unknown
  const paths: string[][] = [];
  const onPath = new Set<string>();
  const stack: string[] = [];

  const visit = (id: string): void => {
    if (onPath.has(id)) return; // cycle guard (defensive on a DAG)
    onPath.add(id);
    stack.push(id);
    if (id === targetId) {
      paths.push([...stack]);
    } else {
      for (const edge of getNode(map, id).edges) visit(edge);
    }
    stack.pop();
    onPath.delete(id);
  };

  visit(map.startId);
  return paths;
}

/**
 * All paths from the start to **any final-layer node** ({@link
 * "./overworld".OverworldMap.finalIds}) — the flatMap of {@link enumeratePaths}
 * over every final id. The full set of ways to *complete* the expedition; the
 * future validator reads it to ask "is the run completable, and by which routes?".
 */
export function enumerateCompletions(map: OverworldMap): string[][] {
  return map.finalIds.flatMap((id) => enumeratePaths(map, id));
}

/**
 * An **arrival**: a run positioned *at* a target node, **pre-resolution** — the
 * route's predecessors are played, the target is chosen but **not yet played**. The
 * jump tool boots from this (park the {@link RunLoop} on the overworld, or hand its
 * staged battle to the battle scene); Phase-1 tests assert the run landed in the
 * right route-dependent state.
 */
export interface Arrival {
  /** The played run, positioned at (but not having resolved) the target node. */
  run: RunState;
  /** The stateful driver wrapping {@link run} — ready to play the target. */
  loop: RunLoop;
  /** The full route walked, `startId … targetId`. */
  route: string[];
  /** The node the arrival is positioned at (the last id of {@link route}). */
  targetId: string;
}

/** Options for {@link traverseRoute}. */
export interface TraverseOpts {
  /**
   * The **variety knob** for the future sampling pass: re-seed the run's threaded
   * RNG with `` `${exp.seed}#${seedSalt}` `` so combat tie-breaks / variance differ
   * while the authored map, encounters and bundle stay byte-identical. Absent ⇒ the
   * expedition's own seed (the canonical playthrough).
   */
  seedSalt?: number;
  /** A/B battle policies (D56) — defaults to the loop's pilot-on-both-sides. */
  policy?: { player: BattlePolicy; enemy: BattlePolicy };
}

/**
 * Boot a run from an expedition with an optional **salted seed** — mirrors
 * {@link createRunFromExpedition} exactly (inflating the same bundle onto the same
 * hand-built map, tagged by the same expedition id), but threads
 * `` `${exp.seed}#${salt}` `` so the run's RNG diverges while the *authored* content
 * is unchanged. Without a salt it defers to {@link createRunFromExpedition} so the
 * canonical playthrough is identical to the normal boot path.
 */
function bootRun(exp: AuthoredExpedition, salt?: number): RunState {
  if (salt === undefined) return createRunFromExpedition(exp);
  return createRun(saltSeed(exp.seed, Labels.expeditionSalt(salt)), {
    party: exp.bundle.party.map(createUnit),
    storageCap: exp.bundle.storageCap,
    inventory: { ...exp.bundle.supplies },
    gold: exp.bundle.purse,
    difficultyId: exp.bundle.difficultyId,
    morale: exp.bundle.morale,
    map: exp.map,
    expeditionId: exp.id,
  });
}

/**
 * **Walk a concrete route** headlessly and stop *at* the target, pre-resolution —
 * the workhorse that turns a route (e.g. one from {@link enumeratePaths}) into an
 * {@link Arrival}. Validates the route is a real forward walk: non-empty, starts at
 * `exp.map.startId`, every consecutive pair is a real forward edge, and the final id
 * is a real node — throwing a clear, specific error otherwise (a malformed route is
 * a caller bug).
 *
 * Boots a run (salted when {@link TraverseOpts.seedSalt} is given), wires the
 * {@link TraverseOpts.policy} onto the loop, then walks **choose-then-play** like
 * {@link RunLoop.autoTraverse} but route-pinned: the **start** is the run's initial
 * position — *departed, not played* (a real run provisions and leaves via Break Camp,
 * never resolves the starting camp); each **predecessor** is chosen and then played;
 * the **target** is chosen but left **unplayed** (the pre-resolution arrival).
 * `loop.choose` plays the departure tick (Break Camp); `loop.playCurrentNode`
 * resolves the node just stepped onto — so the loop chooses the next id, then plays
 * it only when it is not the final (target) id.
 *
 * The arrival is thus combat/rest/event-target agnostic: the caller decides how to
 * resolve the target (auto-battle, hand it to a scene, inspect run state).
 */
export function traverseRoute(
  exp: AuthoredExpedition,
  route: string[],
  opts: TraverseOpts = {},
): Arrival {
  // --- Validate the route is a real forward walk ----------------------------
  if (route.length === 0) {
    throw new Error("traverseRoute: route is empty");
  }
  if (route[0] !== exp.map.startId) {
    throw new Error(
      `traverseRoute: route must start at "${exp.map.startId}", got "${route[0]}"`,
    );
  }
  for (let i = 1; i < route.length; i++) {
    const from = route[i - 1];
    const to = route[i];
    const fromNode = getNode(exp.map, from); // throws if a route id is not a real node
    if (!fromNode.edges.includes(to)) {
      throw new Error(
        `traverseRoute: "${to}" is not a forward edge from "${from}"`,
      );
    }
  }
  getNode(exp.map, route[route.length - 1]); // the target must be a real node

  // --- Boot + walk ----------------------------------------------------------
  const run = bootRun(exp, opts.seedSalt);
  const loop = new RunLoop(run);
  if (opts.policy) loop.policy = opts.policy;

  // Choose-then-play, route-pinned (mirrors autoTraverse). The start (route[0]) is
  // the run's initial position — *departed, not played* (a real run never resolves
  // the starting camp; it provisions and leaves via Break Camp, which `choose`
  // already does). For each subsequent id: choose it (plays the departure tick from
  // where we stand), then play it ONLY if it isn't the final (target) id — so the
  // arrival lands at the target chosen-but-unplayed (pre-resolution).
  for (let i = 1; i < route.length; i++) {
    loop.choose(route[i]); // move to the next node (plays the departure tick)
    if (i < route.length - 1) loop.playCurrentNode(); // resolve predecessors; never the target
  }

  return { run: loop.run, loop, route, targetId: route[route.length - 1] };
}
