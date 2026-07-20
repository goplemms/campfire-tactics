import { describe, it, expect } from "vitest";
import { THE_HOLLOW_MILL } from "./hollow-mill";
import {
  enumeratePaths,
  enumerateCompletions,
  traverseRoute,
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
    expect(validateExpedition(THE_HOLLOW_MILL)).toEqual([]);
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

describe("traverseRoute (Phase 1)", () => {
  // The infiltration arm to the Den (the only way there); the Den does NOT free the Medic (C8).
  const DEN_ROUTE = ["start", "e1", "camp2", "snares", "market", "guildContact", "den"];
  // The sustain arm through the Wagon (which frees the Medic), landing at the rest before finale.
  const WAGON_ROUTE = ["start", "e1", "camp2", "snares", "market", "wagon", "restCamp"];

  it("lands positioned AT the target, pre-resolution", () => {
    const { run, targetId } = traverseRoute(THE_HOLLOW_MILL, DEN_ROUTE);
    expect(targetId).toBe("den");
    expect(run.mapNodeId).toBe("den");
    expect(run.path).toEqual(DEN_ROUTE); // the full route is the path taken
    // The target has NOT been resolved — no history record yet for `den`.
    expect(run.history.some((h) => h.nodeId === "den")).toBe(false);
    // Its predecessors WERE played (e.g. the node-1 skirmish recorded).
    expect(run.history.some((h) => h.nodeId === "e1")).toBe(true);
  });

  it("never resolves the START node — only the predecessors between start and target", () => {
    const { run } = traverseRoute(THE_HOLLOW_MILL, DEN_ROUTE);
    // The starting camp is departed, not played — it must not appear in history.
    expect(run.history.some((h) => h.nodeId === "start")).toBe(false);
    // Exactly the predecessors (route minus start minus target) were resolved, in order.
    const predecessors = DEN_ROUTE.slice(1, -1); // e1, camp2, snares, market, guildContact
    expect(run.history.map((h) => h.nodeId)).toEqual(predecessors);
    // One night per played predecessor — no spurious start-node recovery night.
    expect(run.history).toHaveLength(predecessors.length);
    expect(run.night).toBe(predecessors.length);
  });

  it("the arrival's loop is ready to play the (unresolved) target", () => {
    const { loop } = traverseRoute(THE_HOLLOW_MILL, DEN_ROUTE);
    expect(loop.isTerminal()).toBe(false);
    expect(loop.run.mapNodeId).toBe("den");
  });

  it("the sustain route via the Wagon frees the Medic (flag + Sela in party)", () => {
    const { run } = traverseRoute(THE_HOLLOW_MILL, WAGON_ROUTE);
    expect(run.flags["medic-freed"]).toBe(true);
    expect(run.party.some((u) => u.id === "sela")).toBe(true);
  });

  it("the infiltration route (no Wagon) does NOT free the Medic (C8 exclusivity)", () => {
    const { run } = traverseRoute(THE_HOLLOW_MILL, DEN_ROUTE);
    expect(run.flags["medic-freed"]).toBeFalsy();
    expect(run.party.some((u) => u.id === "sela")).toBe(false);
  });

  it("is deterministic — identical args reproduce party/gold/flags exactly", () => {
    const a = traverseRoute(THE_HOLLOW_MILL, DEN_ROUTE).run;
    const b = traverseRoute(THE_HOLLOW_MILL, DEN_ROUTE).run;
    expect(a.party.map((u) => u.id)).toEqual(b.party.map((u) => u.id));
    expect(a.party.map((u) => u.hp)).toEqual(b.party.map((u) => u.hp));
    expect(a.camp.purse).toBe(b.camp.purse);
    expect(a.flags).toEqual(b.flags);
  });

  it("seedSalt changes combat variance but not map/route/recruits/flags", () => {
    const s1 = traverseRoute(THE_HOLLOW_MILL, WAGON_ROUTE, { seedSalt: 1 });
    const s2 = traverseRoute(THE_HOLLOW_MILL, WAGON_ROUTE, { seedSalt: 2 });
    // The authored map/route/outcomes are fixed across salts.
    expect(s1.run.path).toEqual(s2.run.path);
    expect(s1.run.mapNodeId).toBe(s2.run.mapNodeId);
    expect(s1.run.flags["medic-freed"]).toBe(true);
    expect(s2.run.flags["medic-freed"]).toBe(true);
    expect(s1.run.party.some((u) => u.id === "sela")).toBe(true);
    expect(s2.run.party.some((u) => u.id === "sela")).toBe(true);
    expect(s1.run.party.map((u) => u.id)).toEqual(s2.run.party.map((u) => u.id));
  });

  it("throws on a route that does not start at the start node", () => {
    expect(() => traverseRoute(THE_HOLLOW_MILL, ["e1", "camp2"])).toThrow(/start/);
  });

  it("throws on a non-edge hop", () => {
    // start→snares skips e1/camp2 — not a real forward edge.
    expect(() => traverseRoute(THE_HOLLOW_MILL, ["start", "snares"])).toThrow();
  });

  it("throws on an empty route", () => {
    expect(() => traverseRoute(THE_HOLLOW_MILL, [])).toThrow();
  });
});
