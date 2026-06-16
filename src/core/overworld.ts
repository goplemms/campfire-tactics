/**
 * The overworld (M7) — a pure, **seed-driven** branching run map.
 *
 * Through M6 a run was a *linear* chain: one `encounterIndex`, each fight from
 * `streamFor(seed, "enc:N")`. M7 replaces the straight line with a **layered node
 * DAG** (Slay-the-Spire-style columns of nodes with forward-only edges, **D22**)
 * the player **branches through** — choosing which mission to take next.
 *
 * **Determinism is load-bearing.** The whole graph derives from
 * `streamFor(seed, "map")`, so the **same seed reproduces the same map** (layout,
 * node kinds, edges). Each combat node's *contents* derive from its own labelled
 * stream — `streamFor(seed, "node:<id>")` with the node's **layer as the
 * difficulty index** — so `generation.ts` is reused unchanged and replay is exact
 * regardless of player choices or other draws.
 *
 * **Connectivity invariants** the generator guarantees (D22): every non-final node
 * has ≥1 outgoing edge (no dead ends) and every non-start node has ≥1 incoming
 * edge (no orphans) ⇒ **every node is reachable from the start**, and the start
 * can always reach the final layer.
 *
 * Pure logic: no Phaser, no DOM, no `Math.random`.
 */

import { streamFor } from "./rng";
import { generateEncounter, type EncounterDef } from "./generation";

/**
 * A node kind (D23). A fight (`combat`), a no-battle recovery camp (`rest`), or a
 * no-battle **event** node (M10): the thief event (D30) — a purse-skim hazard on
 * the overworld, blunted by the Banker's protection ({@link "./theft"}). The
 * broader event-node batch (shops, recruiters, story) is later (D23); M10 builds
 * only the thief event the theft loop needs.
 */
export type NodeKind = "combat" | "rest" | "event";

/** A single node on the run map. */
export interface MapNode {
  /** Stable id, `n<layer>-<index>` (the per-node stream + replay key). */
  id: string;
  /** Which column (0 = start; `layers - 1` = the final mission). */
  layer: number;
  /** Position within its layer. */
  index: number;
  kind: NodeKind;
  /** Forward edges — ids of reachable nodes in `layer + 1` (sorted, de-duped). */
  edges: string[];
  /**
   * Binds a hand-authored encounter to this node (D49/D52): when set, the
   * run-scoped resolver ({@link "./run".runEncounter}) returns the expedition
   * catalog's {@link "./authored".AuthoredEncounter} for this id instead of
   * generating one. Unset ⇒ the node generates procedurally (the default).
   */
  authoredId?: string;
}

/** A fully-generated, deterministic run map. */
export interface OverworldMap {
  seed: string | number;
  /** Total layer count (including start + final). */
  layers: number;
  /** All nodes, keyed by id. */
  nodes: Record<string, MapNode>;
  /** The single start node id (layer 0). */
  startId: string;
  /** The final-layer node ids (clearing one is run-complete). */
  finalIds: string[];
  /** Stable id order (start → final, by layer then index) for iteration/tests. */
  order: string[];
}

/** Map-shape tuning — all data, no magic numbers buried in logic (D22). */
export const MAP_GEN = {
  /** Total layers, including the single start (0) and single final layer. */
  layers: 7,
  /** Interior-layer width is a random `minWidth..width`. */
  minWidth: 2,
  width: 3,
  /** Chance an interior node is a rest node rather than a combat node (D23). */
  restChance: 0.34,
  /** Chance an interior node is a thief **event** node (D30, M10) — kept rare. */
  eventChance: 0.14,
  /** Extra forward edges a node may gain beyond its guaranteed one (branchiness). */
  maxFanout: 2,
} as const;

/** Add a forward edge to a node, keeping the list sorted + de-duplicated. */
function addEdge(node: MapNode, targetId: string): void {
  if (node.edges.includes(targetId)) return;
  node.edges.push(targetId);
  node.edges.sort();
}

/** Decide a layer's node count (start + final are single nodes). */
function layerWidth(rng: ReturnType<typeof streamFor>, layer: number, layers: number): number {
  if (layer === 0 || layer === layers - 1) return 1;
  return rng.range(MAP_GEN.minWidth, MAP_GEN.width);
}

/** Decide a node's kind (start + final are fixed; interior is banded, D23/D30). */
function nodeKind(rng: ReturnType<typeof streamFor>, layer: number, layers: number): NodeKind {
  if (layer === 0) return "rest"; // the starting camp — never fought
  if (layer === layers - 1) return "combat"; // the final mission
  // Interior: a rare thief event node (M10), else a banded rest, else combat.
  if (rng.chance(MAP_GEN.eventChance)) return "event";
  return rng.chance(MAP_GEN.restChance) ? "rest" : "combat";
}

/**
 * Generate the run's overworld from its seed (D22). Pure function of `(seed)` via
 * `streamFor(seed, "map")` — identical seed ⇒ identical map. Guarantees the
 * connectivity invariants so the graph is never stuck and every node is reachable.
 */
export function generateOverworld(seed: string | number): OverworldMap {
  const rng = streamFor(seed, "map");
  const layers = MAP_GEN.layers;

  // 1. Build the columns of nodes.
  const byLayer: MapNode[][] = [];
  for (let l = 0; l < layers; l++) {
    const count = layerWidth(rng, l, layers);
    const layerNodes: MapNode[] = [];
    for (let i = 0; i < count; i++) {
      layerNodes.push({ id: `n${l}-${i}`, layer: l, index: i, kind: nodeKind(rng, l, layers), edges: [] });
    }
    byLayer.push(layerNodes);
  }

  // 2. Wire forward edges, layer by layer, enforcing the invariants:
  //    (a) every current node gets ≥1 outgoing edge (+ a little extra fan-out),
  //    (b) every next node that still has no incoming edge gets a source.
  for (let l = 0; l < layers - 1; l++) {
    const cur = byLayer[l];
    const nxt = byLayer[l + 1];
    const hasIncoming = new Set<string>();
    for (const node of cur) {
      const primary = rng.pick(nxt);
      addEdge(node, primary.id);
      hasIncoming.add(primary.id);
      const extra = rng.range(0, MAP_GEN.maxFanout - 1);
      for (let e = 0; e < extra; e++) {
        const t = rng.pick(nxt);
        addEdge(node, t.id);
        hasIncoming.add(t.id);
      }
    }
    for (const target of nxt) {
      if (hasIncoming.has(target.id)) continue;
      const source = rng.pick(cur);
      addEdge(source, target.id);
      hasIncoming.add(target.id);
    }
  }

  // 3. Assemble the lookup + stable orderings.
  const nodes: Record<string, MapNode> = {};
  const order: string[] = [];
  for (const layerNodes of byLayer) {
    for (const node of layerNodes) {
      nodes[node.id] = node;
      order.push(node.id);
    }
  }
  return {
    seed,
    layers,
    nodes,
    startId: byLayer[0][0].id,
    finalIds: byLayer[layers - 1].map((n) => n.id),
    order,
  };
}

/** Look up a node by id (throws if absent — an id should always be valid). */
export function getNode(map: OverworldMap, id: string): MapNode {
  const node = map.nodes[id];
  if (!node) throw new Error(`overworld: no node "${id}"`);
  return node;
}

/**
 * The nodes reachable in one forward step from `id` — its edge targets, resolved
 * to nodes and ordered by their position in the next layer. A final node returns
 * `[]` (nothing forward of it).
 */
export function reachableFrom(map: OverworldMap, id: string): MapNode[] {
  return getNode(map, id)
    .edges.map((e) => getNode(map, e))
    .sort((a, b) => a.index - b.index);
}

/** True if a node is in the final layer (clearing it is run-complete). */
export function isFinalNode(map: OverworldMap, node: MapNode): boolean {
  return node.layer === map.layers - 1;
}

/**
 * Derive a combat node's encounter — deterministically from the run seed + the
 * node's id, with its **layer as the difficulty index** (deeper ⇒ harder). Reuses
 * `generation.ts` unchanged; the dedicated `streamFor` stream makes it identical
 * on replay regardless of what else the run draws.
 */
export function nodeEncounter(seed: string | number, node: MapNode): EncounterDef {
  return generateEncounter(streamFor(seed, `node:${node.id}`), node.layer);
}
