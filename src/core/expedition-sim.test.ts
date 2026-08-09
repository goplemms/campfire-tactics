import { describe, it, expect } from "vitest";
import { THE_HOLLOW_MILL } from "./hollow-mill";
// `traverseRoute` left with its block when that moved to `content/hollow-mill-nodes.test.ts` (D122).
import {
  enumeratePaths,
  enumerateCompletions,
} from "./expedition-sim";
import { validateExpedition } from "./expedition";

const MAP = THE_HOLLOW_MILL.map;

/** Sort a set of routes so order-independent comparisons are stable. */
function sortRoutes(routes: string[][]): string[][] {
  return [...routes].map((r) => [...r]).sort((a, b) => a.join(">").localeCompare(b.join(">")));
}

/** Assert a route is a real forward walk: start→…→target over real edges. */
function assertValidWalk(route: string[], target: string): void {
  expect(route[0]).toBe(MAP.startId);
  expect(route[route.length - 1]).toBe(target);
  for (let i = 1; i < route.length; i++) {
    expect(MAP.nodes[route[i - 1]].edges).toContain(route[i]);
  }
}

describe("enumeratePaths (Phase 1)", () => {
  it("is the right fixture (the topology these expectations derive from)", () => {
    // Sanity: the route sets below are derived from this exact (Wave-0) topology.
    // D122: bodies converted to `content/levels/*.json` can't resolve from `core/` (which may
    // not import content), so the only problems visible here are those un-injected ids — every
    // topological check (edges, reachability, cycles, prerequisites) still runs. The `[]` form
    // lives in `content/hollow-mill-expedition.test.ts`, with the catalog injected.
    for (const p of validateExpedition(THE_HOLLOW_MILL)) expect(p).toMatch(/binds authoredId ".*" with no encounter/);
    expect(MAP.nodes.snares.edges).toEqual(["market"]);
    expect(MAP.nodes.market.edges).toEqual(["guildContact", "wagon"]); // the exclusive fork
  });

  it("enumerates every simple path to `den` (the infiltration arm is the only way there)", () => {
    const expected = sortRoutes([
      ["start", "e1", "camp2", "snares", "market", "guildContact", "den"],
    ]);
    const paths = enumeratePaths(MAP, "den");
    expect(sortRoutes(paths)).toEqual(expected);
    for (const p of paths) assertValidWalk(p, "den");
  });

  it("enumerates every simple path to the `finale` (one per exclusive arm)", () => {
    const expected = sortRoutes([
      // Sustain arm
      ["start", "e1", "camp2", "snares", "market", "wagon", "restCamp", "finale"],
      // Infiltration arm
      ["start", "e1", "camp2", "snares", "market", "guildContact", "den", "outerYard", "guildRite", "cuffedCell", "finale"],
    ]);
    const paths = enumeratePaths(MAP, "finale");
    expect(sortRoutes(paths)).toEqual(expected);
    for (const p of paths) assertValidWalk(p, "finale");
  });

  it("the start node has the single trivial path to itself", () => {
    expect(enumeratePaths(MAP, "start")).toEqual([["start"]]);
  });

  it("throws on an unknown target id (a caller bug, not `unreachable`)", () => {
    expect(() => enumeratePaths(MAP, "no-such-node")).toThrow();
  });

  it("every real node is reachable from the start (so none returns [])", () => {
    for (const id of MAP.order) {
      expect(enumeratePaths(MAP, id).length).toBeGreaterThan(0);
    }
  });

  it("returns [] for a genuinely unreachable target", () => {
    // Build an island node with no incoming edge — present in the map, but no path.
    const islandMap = {
      ...MAP,
      nodes: { ...MAP.nodes, island: { id: "island", layer: 9, index: 0, kind: "combat" as const, edges: [] } },
    };
    expect(enumeratePaths(islandMap, "island")).toEqual([]);
  });
});

describe("enumerateCompletions (Phase 1)", () => {
  it("is the union of paths to every final id (here, just `finale`)", () => {
    expect(sortRoutes(enumerateCompletions(MAP))).toEqual(
      sortRoutes(enumeratePaths(MAP, "finale")),
    );
  });
});

// The `traverseRoute` block moved to `content/hollow-mill-nodes.test.ts` (D122): every route it
// walks starts at `e1`, whose body is now `content/levels/e1-skirmish.json`, so the walk needs the
// content catalog injected — which `core/` may not reach. Path *enumeration* (above) is pure
// topology and stays here. No assertion changed in the move.
