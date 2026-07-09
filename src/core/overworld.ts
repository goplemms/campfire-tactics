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
import { Labels } from "./rng-labels";
import { generateEncounter, type EncounterDef } from "./generation";
import { fieldedUnits, primaryJobOf, type Unit } from "./units";
import { getJob, type JobLookup } from "./jobs";
import type { Predicate } from "./grants";
import { rankOf, clampUp } from "./num";

/**
 * A node kind (D23). A fight (`combat`), a no-battle recovery camp (`rest`), or a
 * no-battle **event** node (M10): the thief event (D30) — a purse-skim hazard on
 * the overworld, blunted by the Banker's protection ({@link "./theft"}). The
 * broader event-node batch (shops, recruiters, story) is later (D23); M10 builds
 * only the thief event the theft loop needs.
 */
export type NodeKind = "combat" | "rest" | "event";

/**
 * **Market-access tier (D61)** — *how good is trade at this node?* An ordered band
 * (the banding convention): `none` (no market — can't buy/sell here) < `poor` (an
 * impromptu/wild market, worse rates) < `basic` (a town) < `premium` (a proper
 * trade hub). Access is a **scarce resource** — the caravan can't find a market at
 * every node — and is **orthogonal to terrain** (a mountain town and a desert town
 * can both be `basic`): {@link MarketTier} is its **own** node axis with its own
 * seeder, today keyed off {@link NodeKind} (terrain later — the seeder signature is
 * left extensible). A Merchant in the party **raises the floor** ({@link merchantFloor}).
 */
export type MarketTier = "none" | "poor" | "basic" | "premium";

/** The market tiers low→high — the ordering the band's compare/clamp read. */
export const MARKET_TIERS: readonly MarketTier[] = ["none", "poor", "basic", "premium"];

/** A market tier's ordinal (none = 0 … premium = 3) — {@link "./num".rankOf} on {@link MARKET_TIERS}. */
export function marketRank(tier: MarketTier): number {
  return rankOf(MARKET_TIERS, tier);
}

/** The higher of two market tiers — {@link "./num".clampUp}, the shared "raise the floor" op. */
export function clampUpMarket(a: MarketTier, b: MarketTier): MarketTier {
  return clampUp(MARKET_TIERS, a, b);
}

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
  /**
   * Pins a specific authored **event** to this node (D52) — when set, an `event`-kind
   * node runs this exact {@link "./node-events".EventDef} id instead of the
   * deterministic seeded pick ({@link "./node-events".eventForNode}). The authored
   * expedition's hand-built event nodes (the pick-one camp, the Merchant town) ride
   * this; procedural nodes leave it unset and pick by seed.
   */
  eventId?: string;
  /**
   * **Market-access tier at this node (D61)** — seeded at generation from
   * {@link nodeMarket}. **Absent ⇒ `none`** (so older fixtures/maps read as "no
   * market" rather than crashing); the generator always sets it. Read through
   * {@link effectiveMarketTier}, which folds in the Merchant floor.
   */
  market?: MarketTier;
  /**
   * **Conditional node access as data (#127)** — a run-level {@link "./grants".Predicate}
   * that, when it holds, makes this node **inaccessible** ({@link "./run".nodeAccessible}
   * drops it from the reachable set). Evaluated unit-lessly via
   * {@link "./grants".evalPredicateRun}. Absent ⇒ always accessible (the default). The
   * authored Hollow Mill uses it for the secured Wagon (blocked once the Medic is freed);
   * procedural nodes leave it unset.
   */
  blockedWhen?: Predicate;
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
  /** Chance a `rest`/town node is a `premium` trade hub rather than a `basic` market (D61). */
  premiumMarketChance: 0.3,
  /** Chance a wild (`combat`/`event`) node has an impromptu `poor` market rather than `none` (D61). */
  wildMarketChance: 0.25,
} as const;

/**
 * Seed a node's **market-access tier** (D61). `rest`/town nodes always have a
 * market (`basic`, sometimes `premium`); wild `combat`/`event` nodes usually have
 * `none`, occasionally an impromptu `poor` market. Keyed off {@link NodeKind} for
 * now — the signature is left open for a future terrain axis (a desert town seeding
 * poorer than a crossroads). Pure: draws only from the passed stream.
 */
function nodeMarket(rng: ReturnType<typeof streamFor>, kind: NodeKind): MarketTier {
  if (kind === "rest") return rng.chance(MAP_GEN.premiumMarketChance) ? "premium" : "basic";
  return rng.chance(MAP_GEN.wildMarketChance) ? "poor" : "none";
}

/**
 * Total **market-tier lift** from fielded members' {@link "./jobs".JobPresence} (D72) —
 * the Merchant's Appraisal as *data* (Σ each fielded member's `presence.marketTierBonus`).
 * Read by {@link effectiveMarketTier} to raise an **existing** market a band; declared by
 * the verb-kit content pass, so it's 0 in production today (effectiveMarketTier stays
 * byte-identical until a class declares it).
 */
export function marketTierBonus(party: readonly Unit[], lookup: JobLookup = getJob): number {
  let bonus = 0;
  for (const u of fieldedUnits(party)) {
    bonus += lookup(primaryJobOf(u))?.presence?.marketTierBonus ?? 0;
  }
  return bonus;
}

/**
 * The **per-node flag id** a "open an impromptu market here" action sets (D72): the
 * Find-Trade shape, keyed by node so the mark is unambiguous and clears on the node-step
 * ({@link "./overworld-actions".tickCooldowns}). Read by {@link effectiveMarketTier}; set
 * by the `openMarket` overworld effect (the verb that *sets* it is the next content pass).
 */
export function marketOpenedFlag(nodeId: string): string {
  return `market-open:${nodeId}`;
}

/**
 * The market tier the caravan actually trades at (D61/D72/D70): the node's own innate market,
 * lifted by a fielded Merchant's **Appraisal** presence (+N bands on an *existing* market), then
 * floored to `poor` by a **per-node "impromptu market opened here" flag** (the Merchant's **Find
 * Trade**, D70) when `eco` carries one. `none` ⇒ no market here (buys/sells refused). The single
 * reader for both buying and selling, so access scarcity is applied in one place.
 *
 * **Order matters (D70):** Appraisal applies to the *innate* market **before** Find Trade's
 * floor, so a Find-Trade-conjured market stays `poor` (Appraisal never lifts it to `basic` — that
 * would make "a basic market anywhere for one action"). D70 retired the old always-on
 * `merchantFloor`: access at a barren node is now the *paid* Find Trade, not a freebie-by-presence.
 * `eco` is read **structurally** (just its `nodeFlags`) to avoid a cycle with the action layer.
 */
export function effectiveMarketTier(
  node: MapNode,
  party: readonly Unit[],
  eco?: { nodeFlags: Record<string, boolean> },
  lookup: JobLookup = getJob,
): MarketTier {
  let tier: MarketTier = node.market ?? "none";
  // Appraisal (presence, D72/D70): lift an **existing** (innate) market by N bands (capped) — it
  // never conjures one on a barren node (that's Find Trade), and runs BEFORE the Find-Trade floor
  // so the conjured market is never appraised up. `lookup` injectable for fixtures.
  if (tier !== "none") {
    const bonus = marketTierBonus(party, lookup);
    if (bonus > 0) tier = MARKET_TIERS[Math.min(MARKET_TIERS.length - 1, marketRank(tier) + bonus)];
  }
  // Find Trade (D70): an impromptu `poor` market at a barren node for this node-step.
  if (eco?.nodeFlags[marketOpenedFlag(node.id)]) tier = clampUpMarket(tier, "poor");
  return tier;
}

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
  const rng = streamFor(seed, Labels.map());
  const layers = MAP_GEN.layers;

  // 1. Build the columns of nodes.
  const byLayer: MapNode[][] = [];
  for (let l = 0; l < layers; l++) {
    const count = layerWidth(rng, l, layers);
    const layerNodes: MapNode[] = [];
    for (let i = 0; i < count; i++) {
      const id = `n${l}-${i}`;
      const kind = nodeKind(rng, l, layers);
      // Market draws from a per-node stream (D61) so it never perturbs the main
      // map stream — every seed's layout/kinds/edges stay byte-identical.
      const market = nodeMarket(streamFor(seed, Labels.market(id)), kind);
      layerNodes.push({ id, layer: l, index: i, kind, market, edges: [] });
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
  return generateEncounter(streamFor(seed, Labels.node(node.id)), node.layer);
}
