import { describe, it, expect } from "vitest";
import type { UnitSpec } from "./units";
import type { OverworldMap, MapNode } from "./overworld";
import type { AuthoredEncounter } from "./authored";
import {
  registerExpedition,
  getExpedition,
  validateExpedition,
  type AuthoredExpedition,
} from "./expedition";
import {
  createRunFromExpedition,
  runEncounter,
  currentEncounter,
  currentNode,
  chooseNode,
  snapshotRun,
} from "./run";
import { isAuthoredEncounter } from "./staging";
import { previewNode } from "./intel";
import { projectForecast } from "./forecast";

function node(id: string, layer: number, kind: MapNode["kind"], edges: string[], authoredId?: string): MapNode {
  return { id, layer, index: 0, kind, edges, authoredId };
}

/** start(rest) → e1(authored combat) → boss(authored, final), + e1b(procedural combat). */
function map(): OverworldMap {
  const nodes: Record<string, MapNode> = {
    start: node("start", 0, "rest", ["e1", "e1b"]),
    e1: node("e1", 1, "combat", ["boss"], "fight1"),
    e1b: node("e1b", 1, "combat", ["boss"]), // procedural — no authoredId
    boss: node("boss", 2, "combat", [], "boss"),
  };
  return { seed: "mill", layers: 3, nodes, startId: "start", finalIds: ["boss"], order: ["start", "e1", "e1b", "boss"] };
}

function enc(id: string, gold: number): AuthoredEncounter {
  return {
    id, name: id, cols: 8, rows: 6, blocked: [],
    playerSpawns: [{ col: 0, row: 2 }],
    enemies: [{ templateId: "bandit-thug", pos: { col: 6, row: 2 } }],
    reward: { gold, materials: [] },
  };
}

function party(): UnitSpec[] {
  return [
    { id: "rook", name: "Rook", side: "player", pos: { col: 0, row: 0 }, jobId: "soldier", speed: 12, maxHp: 30, attack: 9, defense: 3, moveRange: 4, sightRadius: 5, awareness: 4, intelligence: 9 },
  ];
}

function expedition(overMap: OverworldMap = map()): AuthoredExpedition {
  return {
    id: "test-exp",
    name: "Test Expedition",
    seed: "mill",
    map: overMap,
    encounters: { fight1: enc("fight1", 80), boss: enc("boss", 150) },
    bundle: { party: party(), purse: 100, supplies: { salve: 1 }, storageCap: 8 },
  };
}

describe("validateExpedition (D52)", () => {
  it("passes a well-formed hand-built map", () => {
    expect(validateExpedition(expedition())).toEqual([]);
  });

  it("catches a dead end (a non-final node with no outgoing edge)", () => {
    const m = map();
    m.nodes.e1.edges = []; // e1 now dead-ends before the final layer
    const problems = validateExpedition(expedition(m));
    expect(problems.some((p) => p.includes("dead end") && p.includes("e1"))).toBe(true);
  });

  it("catches an orphan + an unreachable node", () => {
    const m = map();
    // Sever every edge into boss → orphan + unreachable.
    m.nodes.e1.edges = [];
    m.nodes.e1b.edges = [];
    const problems = validateExpedition(expedition(m));
    expect(problems.some((p) => p.includes("orphan") && p.includes("boss"))).toBe(true);
    expect(problems.some((p) => p.includes("unreachable") && p.includes("boss"))).toBe(true);
  });

  it("catches an authoredId with no matching encounter", () => {
    const m = map();
    m.nodes.e1.authoredId = "missing";
    const problems = validateExpedition(expedition(m));
    expect(problems.some((p) => p.includes("missing"))).toBe(true);
  });
});

describe("createRunFromExpedition + runEncounter (D49/D52)", () => {
  it("boots a run onto the hand-built map with the bundle, tagged by id", () => {
    const exp = registerExpedition(expedition());
    const run = createRunFromExpedition(exp);
    expect(run.map).toBe(exp.map);
    expect(run.expeditionId).toBe("test-exp");
    expect(run.mapNodeId).toBe("start");
    expect(run.camp.purse).toBe(100);
    expect(run.party).toHaveLength(1);
  });

  it("an authored node resolves to its fixed encounter; a plain node still generates", () => {
    const exp = registerExpedition(expedition());
    const run = createRunFromExpedition(exp);
    const authored = runEncounter(run, run.map.nodes.e1);
    expect(authored).toBe(exp.encounters!.fight1); // the fixed record, by reference
    const generated = runEncounter(run, run.map.nodes.e1b);
    expect(isAuthoredEncounter(generated)).toBe(false); // procedural fallback
    expect((generated as { reward: { gold: number } }).reward.gold).toBeGreaterThan(0);
  });

  it("currentEncounter follows the position through the authored node", () => {
    const run = createRunFromExpedition(registerExpedition(expedition()));
    chooseNode(run, "e1");
    expect(currentNode(run).id).toBe("e1");
    expect(currentEncounter(run)).toBe(getExpedition("test-exp")!.encounters!.fight1);
  });

  it("the forecast bands the authored reward.gold", () => {
    const run = createRunFromExpedition(registerExpedition(expedition()));
    // High-intelligence party → tier 3 reads the exact figure.
    const preview = previewNode(run, "e1", 0);
    expect(preview.encounterKind).toBeUndefined(); // authored has no procedural shape
    expect(preview.rewardHint).toBe("80g");
    // The forecast surfaces the authored node's loot on its edge.
    const edge = projectForecast(run).perEdge.find((e) => e.nodeId === "e1");
    expect(edge?.lootBand.floor).toBe(80);
  });

  it("a snapshot carries the expedition id so the map can be rebuilt", () => {
    const run = createRunFromExpedition(registerExpedition(expedition()));
    chooseNode(run, "e1");
    const snap = snapshotRun(run);
    expect(snap.expeditionId).toBe("test-exp");
    expect(snap.mapNodeId).toBe("e1");
  });
});
