import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import { createRun, type RunState } from "./run";
import { getNode } from "./overworld";
import { visibleNodes, isNodeVisible, reachLimit, REACH } from "./fog";
import { reachableFrom } from "./overworld";

/** A roster whose intelligence we can dial to move the reach tier. */
function roster(intelligence: number): Unit[] {
  return [
    createUnit({ id: "Rook", side: "player", pos: { col: 0, row: 1 }, jobId: "soldier", speed: 12, maxHp: 30, attack: 9, defense: 3, moveRange: 4, sightRadius: 5, awareness: 4, intelligence }),
  ];
}

function newRun(seed: string, intelligence = 0): RunState {
  return createRun(seed, { party: roster(intelligence), difficultyId: "normal", gold: 200 });
}

describe("fog — reach limit scales with intel (D48)", () => {
  it("the limit grows with the tier off a half-map base", () => {
    expect(reachLimit(0)).toBe(REACH.base);
    expect(reachLimit(3)).toBe(REACH.base + 3 * REACH.bandStep);
    expect(reachLimit(3)).toBeGreaterThan(reachLimit(0));
  });
});

describe("fog — visibility is an intel-scaled mask (D48)", () => {
  it("widens with intel tier — a smarter party sees deeper", () => {
    // Same seed/map; only the party's Intelligence (the reach tier) differs.
    const dim = newRun("fog-widen", 0); // tier 0
    const sharp = newRun("fog-widen", 9); // tier 3 (the top breakpoint)
    expect(visibleNodes(sharp).length).toBeGreaterThanOrEqual(visibleNodes(dim).length);
    // The sharp party sees strictly more on a map deep enough to fog at tier 0.
    if (visibleNodes(dim).length < dim.map.order.length) {
      expect(visibleNodes(sharp).length).toBeGreaterThan(visibleNodes(dim).length);
    }
  });

  it("always shows the immediately-reachable choices — even at reach 0", () => {
    const run = newRun("fog-immediate", 0);
    const visible = new Set(visibleNodes(run).map((n) => n.id));
    for (const n of reachableFrom(run.map, run.mapNodeId)) {
      expect(visible.has(n.id)).toBe(true);
    }
    // The current node is visible too.
    expect(isNodeVisible(run, run.mapNodeId)).toBe(true);
  });

  it("hides deep nodes at low intel (the deep-planning fog)", () => {
    // With a 7-layer map and a half-map base, a tier-0 party can't see the final.
    const run = newRun("fog-deep", 0);
    const finalId = run.map.finalIds[0];
    const finalLayer = getNode(run.map, finalId).layer;
    // The final node is `finalLayer` steps from the start (layer 0).
    if (finalLayer > reachLimit(0)) {
      expect(isNodeVisible(run, finalId)).toBe(false);
    }
  });

  it("is a pure projection — stable for a seed (no live RNG)", () => {
    const a = visibleNodes(newRun("fog-stable", 3)).map((n) => n.id);
    const b = visibleNodes(newRun("fog-stable", 3)).map((n) => n.id);
    expect(a).toEqual(b);
  });
});
