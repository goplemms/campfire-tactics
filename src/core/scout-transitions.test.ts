import { describe, it, expect } from "vitest";
import { createUnit, recalls, type Unit } from "./units";
import { createRun } from "./run";
import type { MapNode } from "./overworld";
import { PRESTIGE_OFFERS, storyChoices, applyStoryChoice } from "./node-events";
import { SCOUT_PRESTIGE_FLOOR } from "./jobs";

const NODE: MapNode = { id: "n-event", layer: 1, index: 0, kind: "event", edges: [] } as MapNode;
const offer = (id: string) => PRESTIGE_OFFERS.find((s) => s.id === id)!;

function scout(id: string, level: number): Unit {
  return createUnit({
    id, side: "player", pos: { col: -1, row: -1 },
    jobId: "scout", jobLevels: { scout: { level, xp: 0 } },
    speed: 14, maxHp: 24, attack: 9, defense: 2, moveRange: 5, sightRadius: 6,
  });
}
const runWith = (party: Unit[]) => createRun("scout-transitions", { party });

describe("Scout transition — thieves' guild → Thief (D68)", () => {
  const guild = offer("thieves-guild");

  it("offers the Thief prestige to a floor-met Scout; nothing to one below the floor", () => {
    const ready = runWith([scout("vale", SCOUT_PRESTIGE_FLOOR)]);
    expect(storyChoices(ready, NODE, guild).map((c) => c.id)).toContain("join:vale");
    const green = runWith([scout("vale", 1)]);
    expect(storyChoices(green, NODE, guild).map((c) => c.id)).not.toContain("join:vale");
  });

  it("accepting prestiges the Scout into a Thief in place", () => {
    const run = runWith([scout("vale", SCOUT_PRESTIGE_FLOOR)]);
    const out = applyStoryChoice(run, NODE, guild, "join:vale");
    expect(out.prestiged).toEqual({ unitId: "vale", from: "scout", into: "thief" });
    expect(run.party[0].primaryJob).toBe("thief");
  });
});

describe("Scout transition — the travelling-companion chain → Assassin (D68)", () => {
  const meet = offer("travelling-companion");
  const reveal = offer("the-reveal");

  it("the reveal offers nothing until the Scout has walked with the stranger (linked memory)", () => {
    const run = runWith([scout("vale", SCOUT_PRESTIGE_FLOOR)]);
    // Floor met, but the memory gate is not → no mentorship offer yet (only the plain refuse).
    expect(storyChoices(run, NODE, reveal).map((c) => c.id)).not.toContain("learn:vale");

    applyStoryChoice(run, NODE, meet, "walk:vale");
    expect(recalls(run.party[0], "traveled-with-stranger")).toBe(true);

    // Now both gates pass → the offer surfaces.
    expect(storyChoices(run, NODE, reveal).map((c) => c.id)).toContain("learn:vale");
  });

  it("accepting the mentorship prestiges the Scout into an Assassin", () => {
    const run = runWith([scout("vale", SCOUT_PRESTIGE_FLOOR)]);
    applyStoryChoice(run, NODE, meet, "walk:vale");
    const out = applyStoryChoice(run, NODE, reveal, "learn:vale");
    expect(out.prestiged).toEqual({ unitId: "vale", from: "scout", into: "assassin" });
    expect(run.party[0].primaryJob).toBe("assassin");
  });
});
