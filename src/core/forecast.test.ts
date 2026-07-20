import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import { createRun, type RunState } from "./run";
import type { MapNode, OverworldMap, NodeKind } from "./overworld";
import { eventForNode, tollFee } from "./node-events";
import { projectForecast, lootBandFor } from "./forecast";
import { type IntelTier } from "./intel";

function roster(intelligence = 0): Unit[] {
  return [
    createUnit({ id: "Rook", side: "player", pos: { col: 0, row: 1 }, jobId: "soldier", speed: 12, maxHp: 30, attack: 9, defense: 3, moveRange: 4, sightRadius: 5, awareness: 4, intelligence }),
  ];
}

/** Build a hand-crafted map from a node spec list (forward edges by id). */
function buildMap(seed: string, specs: { id: string; layer: number; kind: NodeKind; edges: string[] }[]): OverworldMap {
  const nodes: Record<string, MapNode> = {};
  specs.forEach((s, i) => {
    nodes[s.id] = { id: s.id, layer: s.layer, index: i, kind: s.kind, edges: s.edges };
  });
  const finals = specs.filter((s) => s.edges.length === 0); // leaves = the final layer
  return {
    seed,
    layers: Math.max(...specs.map((s) => s.layer)) + 1,
    nodes,
    startId: specs[0].id,
    finalIds: finals.map((s) => s.id),
    order: specs.map((s) => s.id),
  };
}

/** A run on a crafted map, positioned at the start node. */
function craftedRun(seed: string, specs: Parameters<typeof buildMap>[1], intelligence = 0, gold = 200): RunState {
  const run = createRun(seed, { party: roster(intelligence), difficultyId: "normal", gold });
  run.map = buildMap(seed, specs);
  run.mapNodeId = run.map.startId;
  run.path = [run.map.startId];
  return run;
}

/** A seed for which the given (event) node id resolves to a `toll`. */
function tollSeed(nodeId: string): string {
  const probe: MapNode = { id: nodeId, layer: 1, index: 0, kind: "event", edges: [] };
  for (let i = 0; i < 1000; i++) {
    const s = `toll-${i}`;
    if (eventForNode(s, probe).kind === "toll") return s;
  }
  throw new Error("no toll seed found");
}

describe("forecast — loot is fogged, banded by intel, never beyond the tier (D48)", () => {
  it("the floor rises monotonically with the tier (intel tightens, never leaks)", () => {
    const gold = 123;
    const f0 = lootBandFor(gold, 0 as IntelTier);
    const f1 = lootBandFor(gold, 1 as IntelTier);
    const f2 = lootBandFor(gold, 2 as IntelTier);
    const f3 = lootBandFor(gold, 3 as IntelTier);
    expect(f0.floor).toBe(0); // unknown income — pessimistic
    expect(f1.floor).toBeGreaterThanOrEqual(f0.floor);
    expect(f2.floor).toBeGreaterThanOrEqual(f1.floor);
    expect(f3.floor).toBe(gold); // exact only at the top tier
    // Tier 1 must not reveal the exact figure (a coarse band, no fog-leak).
    expect(f1.floor).not.toBe(gold);
    expect(f1.label).toBeTruthy();
  });
});

describe("forecast — a visible fee shows and is routed-around (D48)", () => {
  it("a toll edge costs more than the alternate by exactly its fee", () => {
    const seed = tollSeed("toll1");
    // start → { toll node, alternate combat node } → final
    const run = craftedRun(
      seed,
      [
        { id: "s0", layer: 0, kind: "rest", edges: ["toll1", "alt1"] },
        { id: "toll1", layer: 1, kind: "event", edges: ["fin"] },
        { id: "alt1", layer: 1, kind: "combat", edges: ["fin"] },
        { id: "fin", layer: 2, kind: "combat", edges: [] },
      ],
    );
    const f = projectForecast(run);
    const tollEdge = f.perEdge.find((e) => e.nodeId === "toll1")!;
    const altEdge = f.perEdge.find((e) => e.nodeId === "alt1")!;
    const fee = tollFee(seed, run.map.nodes["toll1"]);
    expect(fee).toBeGreaterThan(0);
    // Upkeep is the shared travel cost; the toll is the only extra → exactly the fee.
    expect(tollEdge.costKnown - altEdge.costKnown).toBe(fee);
    // …and the alternate edge avoids it entirely (routed-around).
    expect(altEdge.costKnown).toBe(f.runway.burnPerStep);
  });
});

describe("forecast — the warning fires on the floor and clears with intel (D48)", () => {
  it("a thin purse warns at tier 0, then the warning clears once scouted", () => {
    const run = craftedRun(
      "warn-seed",
      [
        { id: "s0", layer: 0, kind: "rest", edges: ["c1"] },
        { id: "c1", layer: 1, kind: "combat", edges: ["fin"] },
        { id: "fin", layer: 2, kind: "combat", edges: [] },
      ],
      0,
    );
    const edge0 = projectForecast(run).perEdge.find((e) => e.nodeId === "c1")!;
    // Set the purse so the pessimistic floor (tier 0 loot = 0) is just negative.
    run.camp.purse = edge0.costKnown - 5;

    const before = projectForecast(run).perEdge.find((e) => e.nodeId === "c1")!;
    expect(before.purseAfter.floor).toBeLessThan(0);
    expect(before.warn).toBe(true);

    // Scout the node to tier 3 (exact) — the known loot floor jumps to the reward.
    run.overworld.scouted["c1"] = 3;
    const after = projectForecast(run).perEdge.find((e) => e.nodeId === "c1")!;
    // Intel *raised the floor* (it relaxes warnings, not just reveals).
    expect(after.purseAfter.floor).toBeGreaterThan(before.purseAfter.floor);
    // The reward is enough to lift the floor out of the red ⇒ the warning clears.
    if (after.lootBand.floor > 5) expect(after.warn).toBe(false);
  });
});

describe("forecast — the runway to the nearest rest respects the fog (D48)", () => {
  const chain = [
    { id: "s0", layer: 0, kind: "rest" as NodeKind, edges: ["c1"] },
    { id: "c1", layer: 1, kind: "combat" as NodeKind, edges: ["c2"] },
    { id: "c2", layer: 2, kind: "combat" as NodeKind, edges: ["c3"] },
    { id: "c3", layer: 3, kind: "combat" as NodeKind, edges: ["c4"] },
    { id: "c4", layer: 4, kind: "combat" as NodeKind, edges: ["r5"] },
    { id: "r5", layer: 5, kind: "rest" as NodeKind, edges: ["fin"] },
    { id: "fin", layer: 6, kind: "combat" as NodeKind, edges: [] },
  ];

  it("a deep rest is fogged at low intel, then revealed by reach", () => {
    // Tier 0 reach (base 3) can't see the rest 5 steps out → no runway target.
    const dim = projectForecast(craftedRun("runway", chain, 0));
    expect(dim.runway.nearestRestSteps).toBeUndefined();

    // Tier 3 reach (base + 3) sees it → the runway resolves at 5 steps.
    const sharp = projectForecast(craftedRun("runway", chain, 9));
    expect(sharp.runway.nearestRestSteps).toBe(5);
    expect(sharp.runway.purseAtRest).toBe(200 - sharp.runway.burnPerStep * 5);
  });
});
