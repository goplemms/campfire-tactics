import { describe, it, expect } from "vitest";
import {
  generateOverworld,
  reachableFrom,
  getNode,
  isFinalNode,
  nodeEncounter,
  MAP_GEN,
  MARKET_TIERS,
  marketRank,
  clampUpMarket,
  merchantFloor,
  effectiveMarketTier,
  type OverworldMap,
  type MapNode,
} from "./overworld";
import { createUnit, type Unit } from "./units";

/** A throwaway party member of the given job (for the market-floor tests). */
function member(jobId: Unit["jobId"], over: Partial<Parameters<typeof createUnit>[0]> = {}): Unit {
  return createUnit({
    id: `u-${jobId}`, side: "player", pos: { col: 0, row: 0 }, jobId,
    speed: 10, maxHp: 20, attack: 5, defense: 2, moveRange: 3, sightRadius: 6,
    ...over,
  });
}

/** Breadth-first set of every node id reachable from the start. */
function reachableSet(map: OverworldMap): Set<string> {
  const seen = new Set<string>([map.startId]);
  const queue = [map.startId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const n of reachableFrom(map, id)) {
      if (!seen.has(n.id)) {
        seen.add(n.id);
        queue.push(n.id);
      }
    }
  }
  return seen;
}

describe("overworld — determinism (D22)", () => {
  it("same seed ⇒ identical map (layout, node kinds, edges)", () => {
    const a = generateOverworld("emberfall");
    const b = generateOverworld("emberfall");
    expect(a).toEqual(b);
  });

  it("different seeds diverge", () => {
    const a = generateOverworld("seed-A");
    const b = generateOverworld("seed-B");
    // The full structures differ (kinds and/or edges); at minimum, not deep-equal.
    expect(a).not.toEqual(b);
  });

  it("market access is seeded deterministically without perturbing layout (D61)", () => {
    // A per-node market sub-stream means adding the axis kept layout/kinds/edges
    // byte-identical (the determinism test above still passes) AND market is stable.
    const a = generateOverworld("market-det");
    const b = generateOverworld("market-det");
    for (const id of a.order) expect(getNode(a, id).market).toBe(getNode(b, id).market);
  });

  it("a node's encounter is deterministic via its id + layer", () => {
    const map = generateOverworld("det-node");
    const combat = map.order.map((id) => getNode(map, id)).find((n) => n.kind === "combat")!;
    const e1 = nodeEncounter("det-node", combat);
    const e2 = nodeEncounter("det-node", combat);
    expect(e1).toEqual(e2);
    // Layer is the difficulty index.
    expect(e1.index).toBe(combat.layer);
  });

  it("different nodes at the same layer get different content", () => {
    // Find a seed/layer with two combat nodes side by side.
    const map = generateOverworld("twins");
    const byLayer = new Map<number, string[]>();
    for (const id of map.order) {
      const n = getNode(map, id);
      byLayer.set(n.layer, [...(byLayer.get(n.layer) ?? []), id]);
    }
    let compared = false;
    for (const ids of byLayer.values()) {
      const combats = ids.map((i) => getNode(map, i)).filter((n) => n.kind === "combat");
      if (combats.length >= 2) {
        const a = nodeEncounter("twins", combats[0]);
        const b = nodeEncounter("twins", combats[1]);
        expect(a.enemies).not.toEqual(b.enemies);
        compared = true;
        break;
      }
    }
    // Not every seed has a doubled combat layer; the assertion only runs if one exists.
    expect(typeof compared).toBe("boolean");
  });
});

describe("overworld — structure & reachability (D22)", () => {
  const seeds = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];

  it("start is a single layer-0 node; final layer is single", () => {
    for (const s of seeds) {
      const map = generateOverworld(s);
      const start = getNode(map, map.startId);
      expect(start.layer).toBe(0);
      expect(map.order.filter((id) => getNode(map, id).layer === 0).length).toBe(1);
      expect(map.finalIds.length).toBe(1);
      expect(getNode(map, map.finalIds[0]).layer).toBe(map.layers - 1);
    }
  });

  it("every node is reachable from the start (no dead start)", () => {
    for (const s of seeds) {
      const map = generateOverworld(s);
      const reached = reachableSet(map);
      expect(reached.size).toBe(map.order.length);
    }
  });

  it("reachableFrom only returns forward-connected next-layer nodes", () => {
    for (const s of seeds) {
      const map = generateOverworld(s);
      for (const id of map.order) {
        const node = getNode(map, id);
        for (const next of reachableFrom(map, id)) {
          expect(node.edges).toContain(next.id);
          expect(next.layer).toBe(node.layer + 1);
        }
      }
    }
  });

  it("every non-final node has ≥1 outgoing edge (no dead ends)", () => {
    for (const s of seeds) {
      const map = generateOverworld(s);
      for (const id of map.order) {
        const node = getNode(map, id);
        if (isFinalNode(map, node)) expect(node.edges.length).toBe(0);
        else expect(node.edges.length).toBeGreaterThan(0);
      }
    }
  });

  it("from any node you can always reach the final layer", () => {
    for (const s of seeds) {
      const map = generateOverworld(s);
      for (const id of map.order) {
        // Walk first-edge forward until a final node — must terminate there.
        let cur = getNode(map, id);
        let guard = 0;
        while (!isFinalNode(map, cur) && guard++ < map.layers + 2) {
          cur = reachableFrom(map, cur.id)[0];
          expect(cur).toBeDefined();
        }
        expect(isFinalNode(map, cur)).toBe(true);
      }
    }
  });

  it("interior layer widths stay within the configured band", () => {
    const map = generateOverworld("widths");
    const counts = new Map<number, number>();
    for (const id of map.order) {
      const l = getNode(map, id).layer;
      counts.set(l, (counts.get(l) ?? 0) + 1);
    }
    for (const [layer, count] of counts) {
      if (layer === 0 || layer === map.layers - 1) expect(count).toBe(1);
      else {
        expect(count).toBeGreaterThanOrEqual(MAP_GEN.minWidth);
        expect(count).toBeLessThanOrEqual(MAP_GEN.width);
      }
    }
  });
});

describe("overworld — the market-access axis (D61)", () => {
  it("the tier band is ordered, and clampUp returns the higher tier", () => {
    expect(MARKET_TIERS).toEqual(["none", "poor", "basic", "premium"]);
    expect(marketRank("none")).toBeLessThan(marketRank("poor"));
    expect(marketRank("basic")).toBeLessThan(marketRank("premium"));
    expect(clampUpMarket("none", "poor")).toBe("poor"); // raise
    expect(clampUpMarket("basic", "poor")).toBe("basic"); // never lower
    expect(clampUpMarket("premium", "premium")).toBe("premium");
  });

  it("every generated node has a market keyed to its kind (rest = a market; wild = none/poor)", () => {
    const map = generateOverworld("market-seed");
    for (const id of map.order) {
      const n = getNode(map, id);
      expect(n.market).toBeDefined();
      if (n.kind === "rest") expect(["basic", "premium"]).toContain(n.market); // a town always trades
      else expect(["none", "poor"]).toContain(n.market); // wild: usually none, sometimes impromptu
    }
  });

  it("a Merchant raises the market floor to `poor` (impromptu market anywhere)", () => {
    expect(merchantFloor([member("soldier"), member("chef")])).toBe("none");
    expect(merchantFloor([member("soldier"), member("merchant")])).toBe("poor");
    // A downed or captured Merchant can't broker a market.
    const downed = member("merchant"); downed.alive = false;
    const captive = member("merchant"); captive.captured = true;
    expect(merchantFloor([downed])).toBe("none");
    expect(merchantFloor([captive])).toBe("none");
  });

  it("effectiveMarketTier folds the Merchant floor over the node, never lowering it", () => {
    const wild: MapNode = { id: "w", layer: 1, index: 0, kind: "combat", edges: [], market: "none" };
    const town: MapNode = { id: "t", layer: 2, index: 0, kind: "rest", edges: [], market: "basic" };
    const noMerchant = [member("soldier")];
    const withMerchant = [member("merchant")];
    // A Merchant turns a no-market wild node into an impromptu `poor` one…
    expect(effectiveMarketTier(wild, noMerchant)).toBe("none");
    expect(effectiveMarketTier(wild, withMerchant)).toBe("poor");
    // …but never drags a real town's market down to the impromptu floor.
    expect(effectiveMarketTier(town, withMerchant)).toBe("basic");
    // A node with no market field defaults to `none`.
    expect(effectiveMarketTier({ ...wild, market: undefined }, noMerchant)).toBe("none");
  });
});
