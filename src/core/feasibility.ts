/**
 * Feasibility (Phase 5) — the **validator front-end** of the expedition-analysis engine.
 *
 * The same headless machinery the jump tool reads percentiles off ({@link
 * "./arrivals"}) is here read for **aggregates + invariant violations**: the second
 * front-end on the one engine. Where {@link "./expedition".validateExpedition} is the
 * *structural* check (the static graph: dead ends, orphans, reachability), this is its
 * **dynamic, played-through** counterpart — it walks real routes through the overworld
 * pipeline to a terminal and asks the questions a future **procedural-quest generator**
 * needs answered: *is this expedition feasible (completable at all), and where are its
 * corner cases (a softlock, an unwinnable node, content the player can never obtain)?*
 *
 * **Expedition-generic from line one (the load-bearing rule).** Every function takes an
 * {@link AuthoredExpedition}; nothing here hardcodes a specific expedition.
 * {@link "./hollow-mill".THE_HOLLOW_MILL} is only ever the *first argument* / the test
 * fixture. This is the single decision that makes pointing the validator at a real
 * `generateExpedition()` output (Phase 6) a config change, not a rewrite.
 *
 * **The invariants are designed to grow.** {@link CORE_INVARIANTS} is a *starter* set —
 * every real generator corner case (a softlock, a gold underflow, a stash overflow, a
 * node nobody can survive) becomes a new {@link Invariant}, registered once and checked
 * everywhere. Per-step invariants run during traversal (one {@link InvariantContext} per
 * node played); aggregate invariants are computed in {@link analyzeExpedition} from the
 * sampled population.
 *
 * **Scale is itself a corner case (the vision's caveat).** Full path enumeration is
 * exponential in branchiness. This module **bounds** the routes and nodes it analyzes and
 * **reports the cap** in {@link FeasibilityReport.sampling} — it never silently analyzes a
 * fraction and calls it complete. Hollow Mill is tiny, so nothing is capped there.
 *
 * Pure logic: no Phaser, no DOM, no `Math.random`. Determinism is load-bearing — every
 * reading derives from the run's threaded RNG (and the {@link "./expedition-sim".TraverseOpts.seedSalt}
 * knob), so identical arguments reproduce an identical report; {@link FeasibilityReport.determinismOk}
 * is the validator checking that of itself.
 */

import {
  enumerateCompletions,
  traverseRoute,
  type TraverseOpts,
} from "./expedition-sim";
import {
  samplePopulation,
  type PopulationOpts,
} from "./arrivals";
import {
  activeRoster,
  currentNode,
  reachableNodes,
  isFinalRunNode,
  type RunState,
} from "./run";
import { RunLoop } from "./runloop";
import { slotsUsed } from "./inventory";
import type { MapNode } from "./overworld";
import { validateExpedition, type AuthoredExpedition } from "./expedition";

// ---------------------------------------------------------------------------
// playToTerminal — walk a FULL route and resolve the final node
// ---------------------------------------------------------------------------

/**
 * The classified end state of a {@link playToTerminal} walk. `complete` = the final
 * node was cleared with its objectives met (the win); `wipe` = the party fell; the
 * `objective-failure` = the party returned alive without the prize (a graded non-win
 * at the final node); `stuck` = neither terminal was reached — a softlock or a
 * runtime-gated hop — with a {@link reason} naming it.
 */
export interface TerminalOutcome {
  /** The full route walked, `startId … finalId`. */
  route: string[];
  /** How the walk ended. */
  terminal: "complete" | "wipe" | "objective-failure" | "stuck";
  /** The played run at its terminal. */
  run: RunState;
  /** Nights elapsed (predecessors + the target, all played). */
  nights: number;
  /** When `stuck`: why (a gated hop, a softlock). */
  reason?: string;
}

/**
 * **Play a FULL route to a terminal** — the dynamic feasibility primitive. Where
 * {@link traverseRoute} stops *at* the final node pre-resolution (the jump tool's
 * arrival), this plays **every** node *including the last* so the run reaches a real
 * terminal. Reuses `traverseRoute(exp, route, opts)` to walk the predecessors, then
 * {@link RunLoop.playCurrentNode} to resolve the final node.
 *
 * Classifies: `run.complete` ⇒ `complete`; `run.over` (and not complete) ⇒ read the
 * last {@link "./run".NightRecord.result} to tell `wipe` from `objective-failure`;
 * neither terminal ⇒ `stuck` (with a reason). A {@link traverseRoute} throw — a
 * {@link "./run".nodeAccessible}-gated hop the route can't actually take — is caught and
 * returned as `stuck` with the gate's message. **Never throws.**
 */
export function playToTerminal(
  exp: AuthoredExpedition,
  route: string[],
  opts: TraverseOpts = {},
): TerminalOutcome {
  let run: RunState;
  let loop: RunLoop;
  try {
    const arrival = traverseRoute(exp, route, opts);
    run = arrival.run;
    loop = arrival.loop;
  } catch (e) {
    // A runtime-gated hop (e.g. the secured-Wagon edge closing once the Medic is freed)
    // — the route is structurally valid but inaccessible once state is played. A stuck.
    return {
      route: [...route],
      terminal: "stuck",
      // A fresh run object isn't available on the throw path; surface an empty-ish run.
      run: undefined as unknown as RunState,
      nights: 0,
      reason: e instanceof Error ? e.message : String(e),
    };
  }

  // Resolve the final (target) node — traverseRoute left it chosen-but-unplayed.
  if (!loop.isTerminal()) {
    loop.playCurrentNode();
  }

  const nights = run.night;
  if (run.complete) {
    return { route: [...route], terminal: "complete", run, nights };
  }
  if (run.over) {
    // Distinguish a wipe from a survivable objective-failure via the last record's grade.
    const last = run.history[run.history.length - 1];
    const terminal: TerminalOutcome["terminal"] =
      last?.result === "objective-failure" ? "objective-failure" : "wipe";
    return { route: [...route], terminal, run, nights };
  }
  // Neither terminal flagged after playing the final node — a softlock (shouldn't happen
  // for a well-formed expedition; a generator bug if it does).
  return {
    route: [...route],
    terminal: "stuck",
    run,
    nights,
    reason: `route played to "${route[route.length - 1]}" without reaching a terminal (over=${run.over}, complete=${run.complete})`,
  };
}

// ---------------------------------------------------------------------------
// Invariants — an extensible set (start small, designed to grow)
// ---------------------------------------------------------------------------

/**
 * A single invariant violation surfaced by the validator. `severity` is `error`
 * (a feasibility-breaking bug — a softlock, an underflow, a node nobody survives) or
 * `warning` (a softer smell — content the player can never obtain). `nodeId`/`route`
 * locate it where known; `detail` is the human-readable explanation.
 */
export interface Violation {
  /** The {@link Invariant.id} (or aggregate analysis name) that produced this. */
  invariant: string;
  severity: "error" | "warning";
  /** The node the violation was observed at, when applicable. */
  nodeId?: string;
  /** The route being walked when the violation was observed, when applicable. */
  route?: string[];
  detail: string;
}

/**
 * What a per-step {@link Invariant} sees: the expedition under test, the live run +
 * loop at the moment a node was just played, and that {@link node}. (The route is woven
 * in by {@link analyzeExpedition} when it dedupes — the check itself reads run state.)
 */
export interface InvariantContext {
  exp: AuthoredExpedition;
  run: RunState;
  loop: RunLoop;
  node: MapNode;
}

/**
 * A registered, named invariant. `check` reads an {@link InvariantContext} and returns
 * any {@link Violation}s it finds (empty ⇒ the invariant held). New corner cases the
 * generator can produce are added as new entries in {@link CORE_INVARIANTS} — the set is
 * **meant to grow**.
 */
export interface Invariant {
  id: string;
  description: string;
  check(ctx: InvariantContext): Violation[];
}

/**
 * The **starter** set of per-step invariants (run during traversal, once per node
 * played). Deliberately small — the design intent is that *every* real generator corner
 * case becomes a new entry here, registered once and then checked across every sampled
 * playthrough. Today:
 *
 * - **negative-gold** — the purse went below zero (a faucet/sink bug; gold should never
 *   underflow).
 * - **stash-overflow** — used storage exceeds the cap *after* a node step. Grants land
 *   over the cap by design (D75), but Break Camp's {@link "./inventory".autoTrim} should
 *   resolve the overflow back down — a persistent overflow is a bug.
 * - **stranded** — positioned at a non-final node with zero reachable nodes (every
 *   forward edge gated shut by {@link "./run".nodeAccessible}). A softlock: the player
 *   can neither advance nor complete.
 */
export const CORE_INVARIANTS: Invariant[] = [
  {
    id: "negative-gold",
    description: "The run purse must never go below zero.",
    check({ run, node }) {
      if (run.camp.gold < 0) {
        return [
          {
            invariant: "negative-gold",
            severity: "error",
            nodeId: node.id,
            detail: `run.camp.gold is ${run.camp.gold} (< 0) after playing "${node.id}"`,
          },
        ];
      }
      return [];
    },
  },
  {
    id: "stash-overflow",
    description: "Used storage must be within the cap after a node step (overflow should auto-resolve).",
    check({ run, node }) {
      const used = slotsUsed(run.inventory);
      const cap = run.inventory.storageCap;
      if (used > cap) {
        return [
          {
            invariant: "stash-overflow",
            severity: "error",
            nodeId: node.id,
            detail: `slotsUsed=${used} exceeds storageCap=${cap} after playing "${node.id}" (overflow did not resolve)`,
          },
        ];
      }
      return [];
    },
  },
  {
    id: "stranded",
    description: "A non-final node must have at least one reachable forward node (no softlock).",
    check({ run, node }) {
      // Only meaningful while the run can still move — a terminal run is done, not stuck.
      if (run.over || run.complete) return [];
      if (isFinalRunNode(run)) return [];
      if (reachableNodes(run).length === 0) {
        return [
          {
            invariant: "stranded",
            severity: "error",
            nodeId: node.id,
            detail: `stranded at non-final node "${node.id}": every forward edge is gated shut (no reachable nodes)`,
          },
        ];
      }
      return [];
    },
  },
];

// ---------------------------------------------------------------------------
// Aggregate invariants (computed in analyzeExpedition, not per-step)
// ---------------------------------------------------------------------------

/**
 * The **carried payload** a node grants on a win — an authored {@link
 * "./authored".EncounterGrant} recruit/item or an on-board captive. Used by the
 * `unreachable-payload` aggregate invariant to flag content that lies on no completing
 * route.
 */
interface NodePayload {
  nodeId: string;
  /** A short label, e.g. `recruit:sela`, `item:relic-hollow-blade`, `captive:pip`. */
  payload: string;
}

/**
 * Every win-payload an expedition's nodes carry — authored `grants.recruit`/`grants.item`
 * and on-board captives. The `unreachable-payload` analysis cross-references these against
 * the completing routes: a payload on no completing route is content the player can never
 * obtain (a warning).
 */
function nodePayloads(exp: AuthoredExpedition): NodePayload[] {
  const out: NodePayload[] = [];
  for (const nodeId of Object.keys(exp.map.nodes)) {
    const node = exp.map.nodes[nodeId];
    if (!node.authoredId) continue;
    const enc = exp.encounters[node.authoredId];
    if (!enc) continue;
    if (enc.grants?.recruit) out.push({ nodeId, payload: `recruit:${enc.grants.recruit.id}` });
    if (enc.grants?.item) out.push({ nodeId, payload: `item:${enc.grants.item}` });
    for (const c of enc.captives ?? []) out.push({ nodeId, payload: `captive:${c.spec.id}` });
  }
  return out;
}

// ---------------------------------------------------------------------------
// analyzeExpedition — the FeasibilityReport
// ---------------------------------------------------------------------------

/**
 * Per-node survival reading, aggregated from a {@link "./arrivals".samplePopulation}:
 * how many arrivals were sampled at the node, how many reached it without a wipe, and the
 * rate. A `survivalRate` of 0 under competent play means the node is unwinnable (the
 * `unwinnable-node` aggregate invariant).
 */
export interface NodeSurvival {
  sampled: number;
  survived: number;
  /** `survived / sampled`, or 0 when nothing was sampled. */
  survivalRate: number;
}

/** The full dynamic-feasibility report for an expedition — the validator's verdict. */
export interface FeasibilityReport {
  /** {@link validateExpedition} results — the structural check. Empty ⇒ structurally valid. */
  structural: string[];
  /** Whether at least one completion route actually reached `complete` when played. */
  completable: boolean;
  /** The routes (from {@link enumerateCompletions}) that played to `complete`. */
  completingRoutes: string[][];
  /** One {@link TerminalOutcome} per completion route attempted. */
  terminals: TerminalOutcome[];
  /** Per analyzed node, the sampled survival reading. */
  perNode: Record<string, NodeSurvival>;
  /** Win-payloads that lie on no completing route (content the player can never obtain). */
  unreachablePayloads: { nodeId: string; payload: string }[];
  /** All violations, deduped across sampled playthroughs (per-step + aggregate). */
  violations: Violation[];
  /** Replaying one completion route twice (same opts) yields an identical digest. */
  determinismOk: boolean;
  /** The honest sampling report — what was analyzed, and what (if anything) was capped. */
  sampling: {
    nodesAnalyzed: number;
    routesEnumerated: number;
    capped: boolean;
    inaccessibleRoutes: number;
  };
}

/** Tuning for {@link analyzeExpedition}. */
export interface AnalyzeOpts {
  /** Population sampling tuning, threaded to {@link samplePopulation} (per node). */
  population?: PopulationOpts;
  /**
   * Cap on completion **routes** played to a terminal (the scale safety net). Past this
   * the routes list is deterministically truncated and {@link FeasibilityReport.sampling.capped}
   * is set — never a silent fraction. Defaults to {@link DEFAULT_MAX_ROUTES}.
   */
  maxRoutes?: number;
  /**
   * Cap on **nodes** sampled for per-node survival (the scale safety net). Past this only
   * the first `maxNodes` (in `map.order`) are sampled and `capped` is set. Defaults to
   * {@link DEFAULT_MAX_NODES}.
   */
  maxNodes?: number;
  /** An optional sink for the cap report (what was dropped). Defaults to a no-op. */
  log?: (msg: string) => void;
}

/** The default route cap — the scale safety net (Hollow Mill has far fewer). */
export const DEFAULT_MAX_ROUTES = 64;

/** The default node cap — the scale safety net (Hollow Mill has far fewer). */
export const DEFAULT_MAX_NODES = 64;

/**
 * A **stable digest** of a played terminal, for the determinism replay-check: the
 * terminal class + nights + final gold + sorted roster ids + sorted set-flag keys. Two
 * identical playthroughs (same route, same opts) must produce an identical string.
 */
function terminalDigest(out: TerminalOutcome): string {
  const run = out.run;
  const gold = run ? run.camp.gold : 0;
  const roster = run ? activeRoster(run).map((u) => u.id).sort().join(",") : "";
  const flags = run
    ? Object.keys(run.flags).filter((k) => run.flags[k]).sort().join(",")
    : "";
  return `${out.terminal}|n=${out.nights}|g=${gold}|r=[${roster}]|f=[${flags}]`;
}

/** A stable string key for a {@link Violation} (for dedup across playthroughs). */
function violationKey(v: Violation): string {
  return `${v.invariant}|${v.severity}|${v.nodeId ?? ""}|${v.detail}`;
}

/**
 * **Analyze an expedition's dynamic feasibility** — the validator's verdict. Generic over
 * any {@link AuthoredExpedition}; the future generator points it at a `generateExpedition()`
 * output unchanged.
 *
 * What it does:
 * 1. **Structural** — runs {@link validateExpedition} (the static graph check), surfaced as-is.
 * 2. **Completability** — enumerates completion routes ({@link enumerateCompletions}),
 *    {@link playToTerminal}s each (bounded by {@link AnalyzeOpts.maxRoutes}), and reports
 *    which reached `complete`. `completable` ⇔ at least one did.
 * 3. **Per-node survival** — {@link samplePopulation}s each analyzed node (bounded by
 *    {@link AnalyzeOpts.maxNodes}) for a survival rate; a node at 0 under competent play is
 *    an `unwinnable-node` error.
 * 4. **Per-step invariants** — replays the completion routes, running {@link CORE_INVARIANTS}
 *    after each node step; violations are deduped across playthroughs.
 * 5. **Unreachable payloads** — flags win-payloads (recruits/items/captives) that lie on no
 *    completing route (a `unreachable-payload` warning).
 * 6. **Determinism** — replays one completion route twice and compares {@link terminalDigest};
 *    `determinismOk` ⇔ identical.
 *
 * **Scale (the vision's caveat):** routes and nodes are capped, the cap is honored
 * deterministically (truncating the *front* of the enumerated/ordered lists), and
 * {@link FeasibilityReport.sampling.capped} + the {@link AnalyzeOpts.log} sink report exactly
 * what was dropped. Never a silent fraction.
 */
export function analyzeExpedition(
  exp: AuthoredExpedition,
  opts: AnalyzeOpts = {},
): FeasibilityReport {
  const log = opts.log ?? (() => {});
  const maxRoutes = opts.maxRoutes ?? DEFAULT_MAX_ROUTES;
  const maxNodes = opts.maxNodes ?? DEFAULT_MAX_NODES;

  // --- 1. Structural ----------------------------------------------------------
  const structural = validateExpedition(exp);

  // --- 2. Completability ------------------------------------------------------
  const allRoutes = enumerateCompletions(exp.map);
  const routesEnumerated = allRoutes.length;
  let capped = false;
  let routes = allRoutes;
  if (allRoutes.length > maxRoutes) {
    capped = true;
    routes = allRoutes.slice(0, maxRoutes);
    log(
      `analyzeExpedition: capped completion routes ${allRoutes.length} → ${maxRoutes} (dropped ${allRoutes.length - maxRoutes}).`,
    );
  }

  const terminals: TerminalOutcome[] = [];
  const completingRoutes: string[][] = [];
  let inaccessibleRoutes = 0;
  const violationMap = new Map<string, Violation>();
  const addViolation = (v: Violation): void => {
    const key = violationKey(v);
    if (!violationMap.has(key)) violationMap.set(key, v);
  };

  for (const route of routes) {
    const out = playToTerminal(exp, route);
    terminals.push(out);
    if (out.terminal === "complete") completingRoutes.push([...route]);
    if (out.terminal === "stuck" && out.run === undefined) {
      // A runtime-gated hop — the route is structurally valid but inaccessible once run
      // state is played (e.g. the secured-Wagon edge closing once the Medic is freed).
      // This is reported honestly as an inaccessible route (cf. samplePopulation), NOT a
      // violation: it's only a softlock if NO route completes, which the `completable`
      // verdict and the per-step `stranded` invariant catch separately.
      inaccessibleRoutes += 1;
    } else if (out.terminal === "stuck") {
      // Played to the final node but reached no terminal — a genuine softlock.
      addViolation({
        invariant: "stranded",
        severity: "error",
        nodeId: route[route.length - 1],
        route: [...route],
        detail: out.reason ?? "route reached no terminal",
      });
    }
  }
  const completable = completingRoutes.length > 0;

  // --- 3 + 4. Per-node survival + per-step invariants -------------------------
  // Sample every node (bounded). The start node is camp-only (departed, never played); a
  // population at it is degenerate, so analyze the playable nodes (everything reachable as
  // a route target). Use map.order for a stable, deterministic node set.
  const allNodeIds = exp.map.order.filter((id) => id !== exp.map.startId);
  let nodeIds = allNodeIds;
  if (allNodeIds.length > maxNodes) {
    capped = true;
    nodeIds = allNodeIds.slice(0, maxNodes);
    log(
      `analyzeExpedition: capped analyzed nodes ${allNodeIds.length} → ${maxNodes} (dropped ${allNodeIds.length - maxNodes}).`,
    );
  }

  const perNode: Record<string, NodeSurvival> = {};
  for (const nodeId of nodeIds) {
    const pop = samplePopulation(exp, nodeId, opts.population);
    const sampled = pop.samples.length;
    const survived = pop.samples.filter((s) => s.survived).length;
    const survivalRate = sampled > 0 ? survived / sampled : 0;
    perNode[nodeId] = { sampled, survived, survivalRate };
    // unwinnable-node (aggregate): a node nobody survives reaching under competent play.
    // Only flag when it was actually sampled (an unsampled node is unknown, not unwinnable).
    if (sampled > 0 && survivalRate === 0) {
      addViolation({
        invariant: "unwinnable-node",
        severity: "error",
        nodeId,
        detail: `node "${nodeId}" has a 0% sampled survival rate (${survived}/${sampled}) — unwinnable under competent play`,
      });
    }
  }

  // Per-step invariants: replay each completion route, running CORE_INVARIANTS after each
  // node played. (Replaying the completing routes is enough to exercise the playable graph;
  // the canonical seed is used so violations are reproducible.)
  for (const route of completingRoutes.length > 0 ? completingRoutes : routes) {
    runStepInvariants(exp, route, addViolation);
  }

  // --- 5. Unreachable payloads ------------------------------------------------
  // A payload's node is reachable-by-a-completing-route iff some completing route visits it.
  const reachableByCompletion = new Set<string>();
  for (const route of completingRoutes) for (const id of route) reachableByCompletion.add(id);
  const unreachablePayloads: { nodeId: string; payload: string }[] = [];
  for (const p of nodePayloads(exp)) {
    if (!reachableByCompletion.has(p.nodeId)) {
      unreachablePayloads.push({ nodeId: p.nodeId, payload: p.payload });
      addViolation({
        invariant: "unreachable-payload",
        severity: "warning",
        nodeId: p.nodeId,
        detail: `payload "${p.payload}" at node "${p.nodeId}" lies on no completing route — the player can never obtain it`,
      });
    }
  }

  // --- 6. Determinism ---------------------------------------------------------
  let determinismOk = true;
  const replayRoute = completingRoutes[0] ?? routes[0];
  if (replayRoute) {
    const a = terminalDigest(playToTerminal(exp, replayRoute));
    const b = terminalDigest(playToTerminal(exp, replayRoute));
    determinismOk = a === b;
  }

  return {
    structural,
    completable,
    completingRoutes,
    terminals,
    perNode,
    unreachablePayloads,
    violations: [...violationMap.values()],
    determinismOk,
    sampling: {
      nodesAnalyzed: nodeIds.length,
      routesEnumerated,
      capped,
      inaccessibleRoutes,
    },
  };
}

/**
 * Replay a route step-by-step (choose-then-play), running every {@link CORE_INVARIANTS}
 * check after each node is played, feeding violations to `sink`. Mirrors
 * {@link traverseRoute}'s walk but plays **every** node (including the final) so each
 * invariant sees real post-step state. A gated hop is caught and reported as a
 * `stranded` violation rather than crashing. Pure aside from its run mutation.
 */
function runStepInvariants(
  exp: AuthoredExpedition,
  route: string[],
  sink: (v: Violation) => void,
): void {
  let loop: RunLoop;
  try {
    // Walk to the first predecessor pre-resolution, then play forward node by node.
    // Boot at the start, then choose+play each subsequent id.
    const arrival = traverseRoute(exp, [route[0]]);
    loop = arrival.loop;
  } catch (e) {
    sink({
      invariant: "stranded",
      severity: "error",
      route: [...route],
      detail: `route ${route.join(" → ")} could not boot: ${e instanceof Error ? e.message : String(e)}`,
    });
    return;
  }

  // Walk node-by-node. Invariants are checked **after the departure tick (Break Camp)**
  // of the *following* step, because Break Camp is where overflow resolves (D75 autoTrim)
  // and the overworld clock ticks — so the run state an invariant judges is the *settled*
  // post-node-step state, not the transient instant right after a grant lands over the cap.
  // `loop.choose(next)` Break-Camps the node we're standing on, so we run the previous
  // node's invariants right after each choose; the final node (no departure) is judged in
  // its own settled state with `stash-overflow` skipped (a terminal over-cap grant is not a
  // softlock — there's no step left to resolve it, and the run is already done).
  const checkAt = (node: MapNode, skipOverflow: boolean): void => {
    const ctx: InvariantContext = { exp, run: loop.run, loop, node };
    for (const inv of CORE_INVARIANTS) {
      if (skipOverflow && inv.id === "stash-overflow") continue;
      for (const v of inv.check(ctx)) sink({ ...v, route: [...route] });
    }
  };

  for (let i = 1; i < route.length; i++) {
    const prev = currentNode(loop.run); // the node we just played (or the start, departed)
    try {
      loop.choose(route[i]); // Break Camp departs `prev` — resolves its overflow + ticks
    } catch (e) {
      sink({
        invariant: "stranded",
        severity: "error",
        nodeId: route[i],
        route: [...route],
        detail: `runtime-gated hop to "${route[i]}": ${e instanceof Error ? e.message : String(e)}`,
      });
      return;
    }
    // `prev`'s state is now settled (post-Break-Camp) — judge it (start was never played,
    // so its invariants are trivially fine, but the call is harmless/cheap).
    if (i > 1) checkAt(prev, false);
    loop.playCurrentNode();
    if (loop.isTerminal()) break;
  }
  // The final node played has no departure tick — judge it in its settled state, skipping
  // `stash-overflow` (a terminal over-cap grant has no further step to autoTrim it; the
  // run is already complete/over). negative-gold + stranded still apply.
  checkAt(currentNode(loop.run), true);
}
