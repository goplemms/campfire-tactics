import { describe, it, expect } from "vitest";
import { createUnit, recalls, type Unit } from "./units";
import { createRun } from "./run";
import type { MapNode } from "./overworld";
import { PRESTIGE_OFFERS, storyChoices, applyStoryChoice } from "./stories";
import { eventForNode } from "./node-events";
import { jobLevelOf } from "./leveling";
import { SCOUT_PRESTIGE_FLOOR } from "./jobs-data/scout-line";

const NODE: MapNode = { id: "n-event", layer: 1, index: 0, kind: "event", edges: [] } as MapNode;
const offer = (id: string) => PRESTIGE_OFFERS.find((s) => s.id === id)!;

function scout(id: string, level: number, xp = 0): Unit {
  return createUnit({
    id, side: "player", pos: { col: -1, row: -1 },
    jobId: "scout", jobLevels: { scout: { level, xp } },
    speed: 14, maxHp: 24, attack: 9, defense: 2, moveRange: 5, sightRadius: 6,
  });
}
const runWith = (party: Unit[]) => createRun("scout-transitions", { party });

describe("Scout transition — thieves' guild two-beat → Thief (D68 / C7)", () => {
  const contact = offer("thieves-guild-contact");
  const rite = offer("thieves-guild-rite");

  it("beat-1 (contact) is low-gated: writes the invite + grants scout JOB-XP, no prestige", () => {
    const run = runWith([scout("vale", 2)]); // below the floor — the contact still fires
    expect(storyChoices(run, NODE, contact).map((c) => c.id)).toContain("take-token:vale");

    const out = applyStoryChoice(run, NODE, contact, "take-token:vale");
    expect(recalls(run.party[0], "thieves-guild-invite")).toBe(true);
    expect(run.party[0].primaryJob).toBe("scout"); // armed, NOT prestiged
    expect(out.prestiged).toBeUndefined();
    expect(out.jobXp).toMatchObject({ job: "scout", amount: 50 });
  });

  it("beat-1's grant routes to the JOB axis (feeds the prestige gate), not character-XP", () => {
    // A scout at L2 with 60 xp: +50 rolls to L3 (xpPerJobLevel = 100) on the scout job.
    const run = runWith([scout("vale", 2, 60)]);
    applyStoryChoice(run, NODE, contact, "take-token:vale");
    expect(jobLevelOf(run.party[0], "scout")).toBe(3);
    expect(run.party[0].jobLevels.scout!.xp).toBe(10);
  });

  it("beat-2 (rite) stays shut until the floor is met AND the invite is held", () => {
    // Floor met but no invite → only the (gracious) decline shows.
    const noInvite = runWith([scout("vale", SCOUT_PRESTIGE_FLOOR)]);
    expect(storyChoices(noInvite, NODE, rite).map((c) => c.id)).not.toContain("initiate:vale");

    // Invite held but under the floor → still shut (the red-team's silent-dead-end guard;
    // Wave-0 topology guarantees the floor is met by this beat).
    const underFloor = runWith([scout("vale", 3)]);
    applyStoryChoice(underFloor, NODE, contact, "take-token:vale");
    expect(storyChoices(underFloor, NODE, rite).map((c) => c.id)).not.toContain("initiate:vale");
  });

  it("beat-2 fires the Scout→Thief prestige once armed + at the floor", () => {
    const run = runWith([scout("vale", SCOUT_PRESTIGE_FLOOR)]);
    applyStoryChoice(run, NODE, contact, "take-token:vale"); // arm the invite
    expect(storyChoices(run, NODE, rite).map((c) => c.id)).toContain("initiate:vale");

    const out = applyStoryChoice(run, NODE, rite, "initiate:vale");
    expect(out.prestiged).toEqual({ unitId: "vale", from: "scout", into: "thief" });
    expect(run.party[0].primaryJob).toBe("thief");
  });

  it("surfaces live: a node pinned to `guild-contact` resolves the beat via eventForNode", () => {
    const pinned = { ...NODE, id: "gc", eventId: "guild-contact" } as MapNode;
    const def = eventForNode("seed", pinned);
    expect(def.id).toBe("guild-contact");
    const run = runWith([scout("vale", 2)]);
    expect(def.choices!(run, pinned).map((c) => c.id)).toContain("take-token:vale");
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
