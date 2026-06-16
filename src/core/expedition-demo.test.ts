import { describe, it, expect } from "vitest";
import { generateOverworld, getNode, reachableFrom } from "./overworld";
import { eventForNode } from "./node-events";

// Guards the curated Expedition-demo map (M13, Path 1). The seed is pinned in
// `src/game/debug-battle.ts` (EXPEDITION_SEED); this asserts the showcase it was
// chosen for survives any generation change — if it breaks, re-curate + repin.
const EXPEDITION_SEED = "expedition-350";

describe("expedition demo — the curated map still showcases every element (M13)", () => {
  const map = generateOverworld(EXPEDITION_SEED);
  const nodes = map.order.map((id) => getNode(map, id));
  const interior = nodes.filter((n) => n.layer > 0 && n.layer < map.layers - 1);
  const eventKinds = new Set(
    interior.filter((n) => n.kind === "event").map((n) => eventForNode(EXPEDITION_SEED, n).kind),
  );

  it("is the deterministic 7-layer map (replayable)", () => {
    expect(map.layers).toBe(7);
    expect(generateOverworld(EXPEDITION_SEED)).toEqual(map);
  });

  it("opens on a layer that offers a combat AND a rest (a real first choice)", () => {
    const l1 = new Set(reachableFrom(map, map.startId).map((n) => n.kind));
    expect(l1.has("combat")).toBe(true);
    expect(l1.has("rest")).toBe(true);
  });

  it("puts the toll (known fee) and a shop (jump-to-market) on the route", () => {
    expect(eventKinds.has("toll")).toBe(true);
    expect(eventKinds.has("shop")).toBe(true);
  });

  it("carries multiple rest nodes incl. a deep one (in-place vs. premium recovery)", () => {
    const rests = interior.filter((n) => n.kind === "rest");
    expect(rests.length).toBeGreaterThanOrEqual(2);
    expect(rests.some((n) => n.layer >= 3)).toBe(true);
  });

  it("is deep enough that the final mission sits in the fog at a tier-1 party", () => {
    // base reach 3 + tier 1 = 4 < the final node's layer (6) → fogged until intel.
    const finalLayer = getNode(map, map.finalIds[0]).layer;
    expect(finalLayer).toBeGreaterThan(4);
  });
});
