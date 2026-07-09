import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import { createRun } from "./run";
import type { MapNode } from "./overworld";
import type { JobId } from "./jobs";
import { applyStoryChoice, type StorySpec } from "./stories";

const NODE: MapNode = { id: "n", layer: 1, index: 0, kind: "event", edges: [] } as MapNode;
const BASE = "fix-base" as JobId;
const ELITE = "fix-elite" as JobId;

function hero(): Unit {
  return createUnit({
    id: "hero", side: "player", pos: { col: -1, row: -1 },
    jobId: BASE, jobLevels: { "fix-base": { level: 3, xp: 0 } },
    speed: 10, maxHp: 24, attack: 8, defense: 2, moveRange: 4, sightRadius: 5,
  });
}

// One option prestiges the targeted hero; another rolls a SEEDED gold reward — so the
// path exercises both the (RNG-free) grant application and the seeded roll.
const STORY: StorySpec = {
  id: "det",
  prompt: "A mentor, or a glinting cache.",
  choices: [
    { id: "accept", label: "Accept", target: "unit", when: { kind: "jobLevel", job: BASE, min: 3 }, outcome: { grant: { kind: "prestige", from: BASE, into: ELITE }, summary: "trained" } },
    { id: "loot", label: "Loot the cache", outcome: { goldRoll: [15, 40], summary: "loot" } },
  ],
};

describe("prestige / grant / memory determinism (D65)", () => {
  it("the auto/applied path is byte-identical across re-runs for a fixed seed", () => {
    const a = createRun("seed-X", { party: [hero()], gold: 100 });
    const b = createRun("seed-X", { party: [hero()], gold: 100 });

    // The seeded gold roll is stable for the seed (same node + option label).
    const lootA = applyStoryChoice(a, NODE, STORY, "loot");
    const lootB = applyStoryChoice(b, NODE, STORY, "loot");
    expect(lootA.goldDelta).toBe(lootB.goldDelta);
    expect(lootA.goldDelta).toBeGreaterThan(0);

    // The prestige application is a pure function of the inputs — identical outcome + unit state.
    const accA = applyStoryChoice(a, NODE, STORY, "accept:hero");
    const accB = applyStoryChoice(b, NODE, STORY, "accept:hero");
    expect(accA).toEqual(accB);
    expect(a.party).toEqual(b.party);
    expect(a.party[0].primaryJob).toBe(ELITE);
  });
});
