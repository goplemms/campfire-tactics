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
  /** The authored encounters its `authoredId`s resolve to, keyed by id. */
  encounters: Record<string, AuthoredEncounter>;
  bundle: ExpeditionBundle;
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

/** All registered expeditions (the launcher's menu). */
export function allExpeditions(): AuthoredExpedition[] {
  return Object.values(CATALOG);
}

// --- Validation (reuses the D22 connectivity invariants) ---------------------

/**
 * Validate a hand-built expedition against the overworld invariants (D22/D52):
 * **no dead ends** (every non-final node has ≥1 outgoing edge), **no orphans**
 * (every non-start node has ≥1 incoming edge), **full reachability** (every node
 * reachable from the start), every edge points at a real node, and every
 * `authoredId` on the map resolves to an encounter in the catalog. Returns the
 * list of problems found — **empty means valid**.
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

  // Every authored binding resolves to an encounter.
  for (const id of ids) {
    const aid = map.nodes[id].authoredId;
    if (aid !== undefined && !exp.encounters[aid]) {
      problems.push(`node "${id}" binds authoredId "${aid}" with no encounter in the catalog`);
    }
  }

  return problems;
}
