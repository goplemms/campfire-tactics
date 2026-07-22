/**
 * The `AuthoredExpedition` substrate (D52) — a hand-built expedition that plays
 * through the **real** overworld path.
 *
 * Where a procedural run derives its whole map from a seed ({@link
 * "./overworld".generateOverworld}), an authored expedition ships a hand-built
 * {@link OverworldMap} with an `authoredId` on its combat nodes, a catalog of
 * {@link AuthoredEncounter}s those ids resolve to, and a starting **bundle**
 * (party, purse, supplies, …). It is booted via `createRunFromExpedition`
 * ({@link "./run"}) into the normal `RunState`, so the routing economy, forecast,
 * intel and graded resolution all apply unchanged.
 *
 * Authored expeditions live in a **catalog keyed by id** so a snapshot can rebuild
 * the (un-generated) map from the run's `expeditionId`. A {@link validateExpedition}
 * pass reuses the overworld connectivity invariants on the hand-built map.
 *
 * Pure logic: no Phaser, no DOM, no `Math.random`.
 */

import type { UnitSpec } from "./units";
import type { OverworldMap } from "./overworld";
import type { AuthoredEncounter } from "./authored";
import { getAuthoredNode } from "./authored-catalog";

/** The starting bundle an expedition boots a run with (mirrors a caravan, D25/D26). */
export interface ExpeditionBundle {
  party: UnitSpec[];
  purse: number;
  supplies: Record<string, number>;
  storageCap: number;
  morale?: number;
  difficultyId?: string;
}

/** A first-class, hand-authored expedition (D52). */
export interface AuthoredExpedition {
  id: string;
  name: string;
  /** The seed the run threads (procedural nodes, RNG); the map itself is hand-built. */
  seed: string | number;
  /** The hand-built run map — `authoredId` on its combat nodes. */
  map: OverworldMap;
  /**
   * **Inline** authored encounters its `authoredId`s resolve to, keyed by id (D52). The
   * still-TS-authored Hollow Mill ships its bodies here. **Optional (D116):** an expedition
   * may instead resolve its bodies from the shared **injected catalog**
   * ({@link "./authored-catalog"}) — content-authored JSON handed into core at boot. Inline
   * wins where both are present, so the shipped arc is untouched while new expeditions
   * (The Rescue) carry no inline bodies at all. See {@link resolveAuthored}.
   */
  encounters?: Record<string, AuthoredEncounter>;
  bundle: ExpeditionBundle;
}

/**
 * Resolve an `authoredId` to its encounter body **for this expedition** (D116) — the one
 * funnel every reader (run, forecast, feasibility, the load pipeline) goes through. Inline
 * `encounters` (the TS-authored arc) is checked first; otherwise the shared **injected
 * catalog** (content JSON handed into core at boot). Returns `undefined` when neither
 * carries the id — the load pipeline turns that into a fail-loud dangling-id error.
 */
export function resolveAuthored(exp: AuthoredExpedition, authoredId: string): AuthoredEncounter | undefined {
  return exp.encounters?.[authoredId] ?? getAuthoredNode(authoredId);
}

// --- The catalog (keyed by id) ----------------------------------------------

const CATALOG: Record<string, AuthoredExpedition> = {};

/** Register an authored expedition so snapshots can rebuild it from its id (D52). */
export function registerExpedition(exp: AuthoredExpedition): AuthoredExpedition {
  CATALOG[exp.id] = exp;
  return exp;
}

/** Look up a registered expedition by id (the snapshot-rebuild path). */
export function getExpedition(id: string): AuthoredExpedition | undefined {
  return CATALOG[id];
}

// --- Validation (reuses the D22 connectivity invariants) ---------------------

/**
 * Validate a hand-built expedition against the overworld invariants (D22/D52) **and**
 * the D116 resolution/prerequisite rules — the static half of the load pipeline:
 * **no dead ends** (every non-final node has ≥1 outgoing edge), **no orphans** (every
 * non-start node has ≥1 incoming edge), **full reachability** (every node reachable from
 * the start), every edge points at a real node, every `authoredId` resolves to a body
 * **inline or in the injected catalog** ({@link resolveAuthored}), and every declared
 * {@link "./overworld".MapNode.requires} has a provider reachable upstream
 * ({@link prerequisiteProblems}). Returns the list of problems — **empty means valid**;
 * {@link loadExpedition} turns a non-empty list into a fail-loud boot/CI error.
 */
export function validateExpedition(exp: AuthoredExpedition): string[] {
  const problems: string[] = [];
  const map = exp.map;
  const ids = Object.keys(map.nodes);
  const final = new Set(map.finalIds);

  // Edges point at real nodes.
  const incoming = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const id of ids) {
    const node = map.nodes[id];
    for (const e of node.edges) {
      if (!map.nodes[e]) problems.push(`node "${id}" edges to missing node "${e}"`);
      else incoming.set(e, (incoming.get(e) ?? 0) + 1);
    }
  }

  // No dead ends / no orphans.
  for (const id of ids) {
    const node = map.nodes[id];
    if (!final.has(id) && node.edges.length === 0) problems.push(`dead end: "${id}" has no outgoing edge`);
    if (id !== map.startId && (incoming.get(id) ?? 0) === 0) problems.push(`orphan: "${id}" has no incoming edge`);
  }

  // Full reachability from the start (forward BFS over edges).
  const seen = new Set<string>([map.startId]);
  let frontier = [map.startId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of map.nodes[id]?.edges ?? []) {
        if (!seen.has(e) && map.nodes[e]) {
          seen.add(e);
          next.push(e);
        }
      }
    }
    frontier = next;
  }
  for (const id of ids) {
    if (!seen.has(id)) problems.push(`unreachable: "${id}" cannot be reached from the start`);
  }

  // Acyclic (a DAG): a back-edge would make the "provider reachable upstream" prereq check
  // (reachability-based) unsound — a provider reachable via a cycle isn't genuinely upstream.
  // Overworld maps are forward-only by construction; this pins it so the prereq check holds.
  problems.push(...cycleProblems(map));

  // Every authored binding resolves to an encounter — inline OR the injected catalog (D116).
  for (const id of ids) {
    const aid = map.nodes[id].authoredId;
    if (aid !== undefined && !resolveAuthored(exp, aid)) {
      problems.push(`node "${id}" binds authoredId "${aid}" with no encounter (checked inline + injected catalog)`);
    }
  }

  // Every declared prerequisite has a provider reachable upstream (D116, validate-only).
  problems.push(...prerequisiteProblems(exp));

  return problems;
}

/**
 * Detect any directed cycle (back-edge) in the map's edges — a 3-colour DFS. An overworld
 * map is forward-only (a DAG); a cycle both breaks `chooseNode`'s forward-walk assumption and
 * makes the reachability-based {@link prerequisiteProblems} "upstream" test unsound (a provider
 * reachable only *through* the requiring node would read as upstream). Returns a problem per
 * back-edge found — empty means acyclic.
 */
function cycleProblems(map: OverworldMap): string[] {
  const problems: string[] = [];
  const WHITE = 0, GREY = 1, BLACK = 2;
  const colour = new Map<string, number>(Object.keys(map.nodes).map((id) => [id, WHITE]));
  const visit = (id: string): void => {
    colour.set(id, GREY);
    for (const e of map.nodes[id]?.edges ?? []) {
      if (!map.nodes[e]) continue; // dangling edge already reported elsewhere
      const c = colour.get(e);
      if (c === GREY) problems.push(`cycle: edge "${id}" → "${e}" closes a loop (map must be a DAG)`);
      else if (c === WHITE) visit(e);
    }
    colour.set(id, BLACK);
  };
  for (const id of Object.keys(map.nodes)) if (colour.get(id) === WHITE) visit(id);
  return problems;
}

/**
 * The set of nodes forward-reachable **from** `fromId` (transitive, inclusive of `fromId`)
 * — the downstream cone. Used to answer "does the provider sit upstream of the requiring
 * node?" (the requiring node is in the provider's downstream cone).
 */
function reachableSet(map: OverworldMap, fromId: string): Set<string> {
  const seen = new Set<string>([fromId]);
  let frontier = [fromId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of map.nodes[id]?.edges ?? []) {
        if (!seen.has(e) && map.nodes[e]) {
          seen.add(e);
          next.push(e);
        }
      }
    }
    frontier = next;
  }
  return seen;
}

/**
 * Validate every {@link "./overworld".MapNode.requires} declaration (D116, **validate-only**):
 * for a node that needs flag `F`, some **provider** node (`provides === F`) must sit reachable
 * **upstream** on *some* path — i.e. the provider is reachable from the start AND the requiring
 * node lies in the provider's downstream cone (and the two are distinct). This guarantees the
 * *opportunity* to earn the flag exists; the branching DAG may still skip it (the consumer
 * degrades gracefully — the flank is a reward, never a hard gate). A missing/misplaced provider
 * **fails loud** rather than being auto-inserted (that would be D98's silent reshaping of a
 * curated arc). Returns the problems found — empty means every need is satisfiable upstream.
 */
export function prerequisiteProblems(exp: AuthoredExpedition): string[] {
  const problems: string[] = [];
  const map = exp.map;
  const ids = Object.keys(map.nodes);
  const fromStart = reachableSet(map, map.startId);
  // Downstream cone per provider, computed lazily and cached.
  const coneCache = new Map<string, Set<string>>();
  const coneOf = (id: string): Set<string> => {
    let c = coneCache.get(id);
    if (!c) { c = reachableSet(map, id); coneCache.set(id, c); }
    return c;
  };
  for (const id of ids) {
    const need = map.nodes[id].requires;
    if (need === undefined) continue;
    const providers = ids.filter((p) => map.nodes[p].provides === need);
    const upstream = providers.some((p) => p !== id && fromStart.has(p) && coneOf(p).has(id));
    if (!upstream) {
      problems.push(
        `node "${id}" requires "${need}" but no provider node (provides: "${need}") sits reachable upstream ` +
          `(providers found: ${providers.length ? providers.map((p) => `"${p}"`).join(", ") : "none"})`,
      );
    }
  }
  return problems;
}

/**
 * The **expedition load pipeline** (D116) — run at **boot** and reused as a **build/CI guard**
 * so a broken expedition fails the build, never the player's session. It **resolves** every
 * `authoredId` against the inline + injected catalogs, **assembles** the DAG (already hand-built
 * here), **validates prerequisites** (a provider reachable upstream), and **validates
 * connectivity** (reachable / no dead ends / no orphans) — all via {@link validateExpedition} —
 * then **fails loud** on the first non-empty problem list. Returns the (now-validated)
 * expedition so a boot site can `loadExpedition(exp)` inline. Call **after** the content layer
 * has injected its bodies (`injectContentNodes`), or an injected-only expedition reads empty.
 */
export function loadExpedition(exp: AuthoredExpedition): AuthoredExpedition {
  const problems = validateExpedition(exp);
  if (problems.length) {
    throw new Error(`loadExpedition: "${exp.id}" is invalid:\n  - ${problems.join("\n  - ")}`);
  }
  return exp;
}
