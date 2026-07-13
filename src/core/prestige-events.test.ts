import { describe, it, expect } from "vitest";
import { createUnit, recalls, type Unit, type UnitSpec } from "./units";
import { createRun } from "./run";
import type { MapNode } from "./overworld";
import type { JobId } from "./jobs";
import { applyStoryChoice, storyChoices, THIEVES_GUILD_CONTACT, type StorySpec } from "./stories";

const BASE = "fix-base" as JobId;
const ELITE = "fix-elite" as JobId;

function member(id: string, level: number): Unit {
  const spec: UnitSpec = {
    id,
    side: "player",
    pos: { col: -1, row: -1 },
    jobId: BASE,
    jobLevels: { "fix-base": { level, xp: 0 } },
    speed: 10,
    maxHp: 24,
    attack: 8,
    defense: 2,
    moveRange: 4,
    sightRadius: 5,
  };
  return createUnit(spec);
}

const NODE: MapNode = { id: "n-event", layer: 1, index: 0, kind: "event", edges: [] } as MapNode;

// A mentor's offer: accept targets a worthy soldier (jobLevel ≥ 3) and prestiges
// them; decline is a plain option. Throwaway fixture — never registered in EVENTS.
const OFFER: StorySpec = {
  id: "fix-offer",
  prompt: "A mentor offers to train a worthy soldier.",
  choices: [
    {
      id: "accept",
      label: "Accept the training",
      target: "unit",
      when: { kind: "jobLevel", job: BASE, min: 3 },
      outcome: { grant: { kind: "prestige", from: BASE, into: ELITE }, summary: "Trained into the elite." },
    },
    { id: "decline", label: "Decline", outcome: { summary: "The mentor moves on." } },
  ],
};

function runWith(party: Unit[]) {
  return createRun("prestige-events-seed", { party });
}

describe("node-event prestige offer → choice → accept (D65)", () => {
  it("lists only ELIGIBLE party members as unit-targeted choices (floor gate)", () => {
    const run = runWith([member("hero", 3), member("rookie", 1)]);
    const choices = storyChoices(run, NODE, OFFER);
    const ids = choices.map((c) => c.id);
    // Only the L3 hero qualifies for the targeted accept; decline is always offered.
    expect(ids).toEqual(["accept:hero", "decline"]);
  });

  it("accepting prestiges the chosen unit and reports it on the outcome", () => {
    const run = runWith([member("hero", 3), member("rookie", 1)]);
    const out = applyStoryChoice(run, NODE, OFFER, "accept:hero");

    expect(out.prestiged).toEqual({ unitId: "hero", from: BASE, into: ELITE });
    const hero = run.party.find((u) => u.id === "hero")!;
    expect(hero.primaryJob).toBe(ELITE);
    expect(hero.heldJobs).toEqual([ELITE]);
    expect(hero.jobId).toBe(BASE); // frozen original class
    // The other member is untouched — the offer targeted one unit.
    expect(run.party.find((u) => u.id === "rookie")!.primaryJob).toBe(BASE);
  });

  it("AGENCY: the un-targeted base choice (what autoResolve picks) applies no grant", () => {
    const run = runWith([member("hero", 3)]);
    // autoResolve picks `choice.id` (no `:unitId` suffix) → no target → no prestige.
    const out = applyStoryChoice(run, NODE, OFFER, "accept");
    expect(out.prestiged).toBeUndefined();
    expect(run.party[0].primaryJob).toBe(BASE); // unchanged — agency preserved
  });
});

describe("Thieves' Guild contact — the offer is Scout-only (#179)", () => {
  // A real party: a Scout the fence marks, and a Merchant who shouldn't be offered a
  // thief's token. The old `jobLevel scout >= 1` gate matched the Merchant too (an
  // untrained job reads level 1); `holdsJob scout` is "is a Scout" and gates correctly.
  function scout(id: string): Unit {
    return createUnit({ id, side: "player", pos: { col: -1, row: -1 }, jobId: "scout" as JobId, speed: 10, maxHp: 24, attack: 8, defense: 2, moveRange: 4, sightRadius: 5 });
  }
  function merchant(id: string): Unit {
    return createUnit({ id, side: "player", pos: { col: -1, row: -1 }, jobId: "merchant" as JobId, speed: 10, maxHp: 24, attack: 8, defense: 2, moveRange: 4, sightRadius: 5 });
  }

  it("offers the token to the Scout only, never a non-Scout party member", () => {
    const run = runWith([scout("vale"), merchant("mira")]);
    const ids = storyChoices(run, NODE, THIEVES_GUILD_CONTACT).map((c) => c.id);
    expect(ids).toEqual(["take-token:vale", "decline"]);
  });

  it("a party with no Scout gets only the decline", () => {
    const run = runWith([merchant("mira")]);
    const ids = storyChoices(run, NODE, THIEVES_GUILD_CONTACT).map((c) => c.id);
    expect(ids).toEqual(["decline"]);
  });
});

describe("node-event linked-memory chain (D65)", () => {
  // Event A: travelling together writes a memory flag on the chosen member.
  const MEET: StorySpec = {
    id: "meet",
    prompt: "A traveller asks to walk with the caravan.",
    choices: [
      {
        id: "greet",
        label: "Walk together",
        target: "unit",
        when: { kind: "all", of: [] }, // open to any member
        outcome: { remember: "met-traveller", summary: "You share the road a while." },
      },
    ],
  };
  // Event B: the reveal offers prestige only to a member who met the traveller AND
  // meets the floor — the meet → reveal chain, reading the memory bag end-to-end.
  const REVEAL: StorySpec = {
    id: "reveal",
    prompt: "The traveller reveals themselves a mentor.",
    choices: [
      {
        id: "accept",
        label: "Accept the mentorship",
        target: "unit",
        when: {
          kind: "all",
          of: [
            { kind: "remembers", flag: "met-traveller" },
            { kind: "jobLevel", job: BASE, min: 3 },
          ],
        },
        outcome: { grant: { kind: "prestige", from: BASE, into: ELITE }, summary: "Mentored into the elite." },
      },
    ],
  };

  it("event B offers the prestige only AFTER event A writes the memory flag", () => {
    const run = runWith([member("hero", 3)]);

    // Before meeting: the floor is met, but the memory gate is not → no offer.
    expect(storyChoices(run, NODE, REVEAL).map((c) => c.id)).toEqual([]);

    // Event A: walk together — writes the flag on the hero.
    const metOut = applyStoryChoice(run, NODE, MEET, "greet:hero");
    expect(metOut.remembered).toBe("met-traveller");
    expect(recalls(run.party[0], "met-traveller")).toBe(true);

    // Event B now surfaces the offer (memory + floor both satisfied), and accepting prestiges.
    expect(storyChoices(run, NODE, REVEAL).map((c) => c.id)).toEqual(["accept:hero"]);
    const out = applyStoryChoice(run, NODE, REVEAL, "accept:hero");
    expect(out.prestiged).toEqual({ unitId: "hero", from: BASE, into: ELITE });
  });
});
