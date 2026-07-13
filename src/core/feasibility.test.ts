import { describe, it, expect } from "vitest";
import { THE_HOLLOW_MILL } from "./hollow-mill";
import { registerExpedition, type AuthoredExpedition } from "./expedition";
import {
  playToTerminal,
  analyzeExpedition,
  CORE_INVARIANTS,
} from "./feasibility";
import type { OverworldMap, MapNode } from "./overworld";

/** A known full completion route through the Hollow Mill — the sustain arm to the finale. */
const COMPLETION: string[] = [
  "start", "e1", "camp2", "snares", "market", "wagon", "restCamp", "finale",
];

describe("playToTerminal — full-route play to a real terminal", () => {
  it("plays a known completion route to 'complete' with the right night count", () => {
    const out = playToTerminal(THE_HOLLOW_MILL, COMPLETION);
    expect(out.terminal).toBe("complete");
    expect(out.run.complete).toBe(true);
    // Nights = predecessors + target, all played (start is departed-not-played). The route
    // has 8 ids; the start is never resolved, so 7 nights pass (one per played node).
    expect(out.nights).toBe(COMPLETION.length - 1);
    expect(out.route).toEqual(COMPLETION);
  });

  it("returns 'stuck' (never throws) for an impossible cross-arm hop (C8 exclusivity)", () => {
    // The arms are exclusive: from the sustain arm's Wagon there is no edge into the
    // infiltration arm's cell — so this route can't be walked. playToTerminal catches the
    // throw and reports it, rather than crashing.
    const crossArm = ["start", "e1", "camp2", "snares", "market", "wagon", "cuffedCell"];
    const out = playToTerminal(THE_HOLLOW_MILL, crossArm);
    expect(out.terminal).toBe("stuck");
    expect(out.reason).toBeTruthy();
  });
});

describe("analyzeExpedition(THE_HOLLOW_MILL) — the valid slice is clean", () => {
  const report = analyzeExpedition(THE_HOLLOW_MILL);

  it("is structurally valid", () => {
    expect(report.structural).toEqual([]);
  });

  it("is completable with at least one completing route", () => {
    expect(report.completable).toBe(true);
    expect(report.completingRoutes.length).toBeGreaterThanOrEqual(1);
  });

  it("reports per-node survival in [0,1] for every analyzed node", () => {
    expect(Object.keys(report.perNode).length).toBe(report.sampling.nodesAnalyzed);
    for (const [, s] of Object.entries(report.perNode)) {
      expect(s.survivalRate).toBeGreaterThanOrEqual(0);
      expect(s.survivalRate).toBeLessThanOrEqual(1);
      expect(s.survived).toBeLessThanOrEqual(s.sampled);
    }
  });

  it("is deterministic on replay", () => {
    expect(report.determinismOk).toBe(true);
  });

  it("reports sane sampling counts", () => {
    expect(report.sampling.routesEnumerated).toBeGreaterThanOrEqual(report.completingRoutes.length);
    expect(report.sampling.nodesAnalyzed).toBeGreaterThan(0);
    expect(report.sampling.capped).toBe(false); // Hollow Mill is tiny
    // No runtime-gated hops in Wave-0: exclusivity is enforced structurally (disjoint arms),
    // not by a blockedWhen predicate, so every enumerated route is actually walkable.
    expect(report.sampling.inaccessibleRoutes).toBe(0);
  });

  it("has NO error-severity violations for the valid slice", () => {
    const errors = report.violations.filter((v) => v.severity === "error");
    expect(errors).toEqual([]);
  });

  it("finds no unreachable payloads (every recruit/relic/captive is obtainable)", () => {
    expect(report.unreachablePayloads).toEqual([]);
  });
});

describe("CORE_INVARIANTS — the starter set is registered and extensible", () => {
  it("registers the documented starter invariants", () => {
    const ids = CORE_INVARIANTS.map((i) => i.id).sort();
    expect(ids).toEqual(["negative-gold", "stash-overflow", "stranded"]);
  });
});

// --- Negative test: a BROKEN expedition the validator must CATCH -------------

/**
 * A deep-clone of the Hollow Mill map with the Den's edge to the finale **severed**, so
 * the relic-bearing Den lies on no completing route. The relic payload becomes
 * unobtainable — the `unreachable-payload` warning the validator must surface.
 */
function brokenMill(): AuthoredExpedition {
  const clonedNodes: Record<string, MapNode> = {};
  for (const id of Object.keys(THE_HOLLOW_MILL.map.nodes)) {
    const n = THE_HOLLOW_MILL.map.nodes[id];
    clonedNodes[id] = { ...n, edges: [...n.edges] };
  }
  // Sever the Den → finale edge: nothing else reaches the finale from the Den, so every
  // completing route now avoids the Den, stranding its relic payload.
  clonedNodes["den"].edges = [];
  const map: OverworldMap = {
    ...THE_HOLLOW_MILL.map,
    seed: "broken-hollow-mill",
    nodes: clonedNodes,
  };
  return registerExpedition({
    ...THE_HOLLOW_MILL,
    id: "broken-hollow-mill",
    name: "Broken Hollow Mill",
    seed: "broken-hollow-mill",
    map,
  });
}

describe("analyzeExpedition — catches a broken expedition (negative test)", () => {
  const report = analyzeExpedition(brokenMill());

  it("structural check flags the Den as a dead end", () => {
    // The severed Den is a non-final node with no outgoing edge.
    expect(report.structural.some((p) => p.includes("den") && p.includes("dead end"))).toBe(true);
  });

  it("surfaces the Den's relic as an unreachable payload", () => {
    const relic = report.unreachablePayloads.find((p) => p.nodeId === "den");
    expect(relic).toBeDefined();
    expect(relic?.payload).toContain("relic-hollow-blade");
  });

  it("raises an unreachable-payload warning violation for it", () => {
    const warn = report.violations.find(
      (v) => v.invariant === "unreachable-payload" && v.nodeId === "den",
    );
    expect(warn).toBeDefined();
    expect(warn?.severity).toBe("warning");
  });

  it("is still completable via the routes that skip the Den", () => {
    // The sustain arm (Market → Wagon → restCamp → finale) still completes, so the map is
    // playable even with the Den (and its relic) stranded on the broken infiltration arm.
    expect(report.completable).toBe(true);
  });
});
