import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import { createRun, type RunState } from "./run";
import { RunLoop } from "./runloop";
import { generateOverworld, getNode, type MapNode } from "./overworld";
import { countOf } from "./inventory";
import { merchantPrice } from "./economy-actions";
import {
  EVENTS,
  getEvent,
  eventForNode,
  resolveEvent,
  eventChoices,
  chooseEventOption,
  shopStock,
  shopBuy,
  recruiterOffer,
  hireRecruit,
  storyForNode,
  applyStoryChoice,
  STORIES,
  getStory,
  NODE_EVENTS,
  tollFee,
  nodeFee,
  type EventKind,
} from "./node-events";

let nextId = 0;
function fighter(name: string): Unit {
  return createUnit({
    id: `${name}-${nextId++}`,
    side: "player",
    pos: { col: -1, row: -1 },
    name,
    jobId: "soldier",
    speed: 11,
    maxHp: 28,
    attack: 9,
    defense: 3,
    moveRange: 4,
    sightRadius: 5,
    awareness: 3,
    intelligence: 3,
  });
}

function newRun(seed: string, gold = 200, storageCap = 6): RunState {
  return createRun(seed, { party: [fighter("Rook")], difficultyId: "normal", gold, storageCap });
}

/** A fixed synthetic event node; we vary the seed to land a desired event kind. */
const NODE: MapNode = { id: "n3-1", layer: 3, index: 1, kind: "event", edges: [] };

/** Find a seed whose {@link eventForNode} picks `kind` for {@link NODE}. */
function seedFor(kind: EventKind): string {
  for (let i = 0; i < 500; i++) {
    const s = `evt-${i}`;
    if (eventForNode(s, NODE).kind === kind) return s;
  }
  throw new Error(`no seed produced a ${kind} event`);
}

// --- The registry is data (D4) ----------------------------------------------

describe("node-events — the registry is data (D4)", () => {
  it("EVENTS holds ≥4 events covering all four kinds", () => {
    expect(EVENTS.length).toBeGreaterThanOrEqual(4);
    const kinds = new Set(EVENTS.map((e) => e.kind));
    for (const k of ["thief", "shop", "recruiter", "story"] as EventKind[]) {
      expect(kinds.has(k)).toBe(true);
    }
  });

  it("every event carries an id, name, teaser, weight and an autoResolve", () => {
    for (const e of EVENTS) {
      expect(e.id).toBeTruthy();
      expect(e.name).toBeTruthy();
      expect(e.teaser).toBeTruthy();
      expect(e.weight).toBeGreaterThan(0);
      expect(typeof e.autoResolve).toBe("function");
    }
  });

  it("getEvent looks an event up by id (throws if absent)", () => {
    expect(getEvent("thief").kind).toBe("thief");
    expect(() => getEvent("nope")).toThrow();
  });
});

// --- Determinism (D22) ------------------------------------------------------

describe("node-events — the event pick is deterministic (D22)", () => {
  it("eventForNode is stable for a seed + node", () => {
    const map = generateOverworld("pick");
    for (const id of map.order) {
      const node = getNode(map, id);
      expect(eventForNode("pick", node).id).toBe(eventForNode("pick", node).id);
    }
  });

  it("different seeds and different nodes diverge in their picks", () => {
    // Across the registry's kinds, the pick is not a constant.
    const kinds = new Set<string>();
    for (let i = 0; i < 60; i++) kinds.add(eventForNode(`seed-${i}`, NODE).kind);
    expect(kinds.size).toBeGreaterThan(1);

    const map = generateOverworld("nodes");
    const picks = new Set(map.order.map((id) => eventForNode("nodes", getNode(map, id)).id));
    expect(picks.size).toBeGreaterThan(1);
  });

  it("every outcome roll reproduces for a seed (story auto-resolution)", () => {
    const seed = seedFor("story");
    const a = newRun(seed);
    const b = newRun(seed);
    const outA = resolveEvent(a, NODE);
    const outB = resolveEvent(b, NODE);
    expect(outA).toEqual(outB);
    expect(a.camp.gold).toBe(b.camp.gold);
    expect(a.camp.morale).toBe(b.camp.morale);
  });
});

// --- Shop (Merchant ACCESS reused, D30/D34) ---------------------------------

describe("node-events — shop buys from the purse under the cap (D30/D34)", () => {
  it("a roadside shop is always a `basic` market (D61) — priced the same at any node", () => {
    const restNode: MapNode = { ...NODE, kind: "rest" };
    const seed = "shop-price";
    const onEvent = shopStock(seed, NODE);
    const onRest = shopStock(seed, restNode);
    // The shop event is its own guaranteed market, independent of the node's tier.
    expect(onEvent[0].price).toBe(merchantPrice("basic"));
    expect(onRest[0].price).toBe(merchantPrice("basic"));
    expect(onEvent[0].price).toBeGreaterThan(0);
  });

  it("shopStock is a stable, seeded selection from the registry", () => {
    const seed = "shop-stock";
    expect(shopStock(seed, NODE)).toEqual(shopStock(seed, NODE));
    expect(shopStock(seed, NODE).length).toBe(NODE_EVENTS.shopStockSize);
  });

  it("a buy spends purse gold into storage at the node-tier price", () => {
    const seed = seedFor("shop");
    const run = newRun(seed, 200);
    const offer = shopStock(seed, NODE)[0];
    const before = run.camp.gold;
    const out = shopBuy(run, NODE, offer.materialId);
    expect(out.goldDelta).toBe(-offer.price);
    expect(run.camp.gold).toBe(before - offer.price);
    expect(countOf(run.inventory, offer.materialId)).toBe(1);
    expect(out.materials).toEqual([offer.materialId]);
  });

  it("respects the storage cap (a full stash refuses, spending nothing)", () => {
    const seed = seedFor("shop");
    const run = newRun(seed, 500, 1); // 1 slot only
    const offer = shopStock(seed, NODE)[0];
    expect(shopBuy(run, NODE, offer.materialId).goldDelta).toBe(-offer.price); // fills the slot
    const goldAfterFirst = run.camp.gold;
    const second = shopBuy(run, NODE, offer.materialId); // no room now
    expect(second.goldDelta).toBe(0);
    expect(run.camp.gold).toBe(goldAfterFirst); // nothing spent
  });

  it("refuses when the purse can't cover the price", () => {
    const seed = seedFor("shop");
    const run = newRun(seed, 1);
    const offer = shopStock(seed, NODE)[0];
    const out = shopBuy(run, NODE, offer.materialId);
    expect(out.goldDelta).toBe(0);
    expect(countOf(run.inventory, offer.materialId)).toBe(0);
  });

  it("the headless default buys nothing (deterministic no-op)", () => {
    const seed = seedFor("shop");
    const run = newRun(seed, 200);
    const out = resolveEvent(run, NODE);
    expect(out.kind).toBe("shop");
    expect(run.camp.gold).toBe(200);
  });
});

// --- Recruiter (a rolled body for purse gold, D33) --------------------------

describe("node-events — recruiter hires a rolled body for the purse (D33)", () => {
  it("the offer is a deterministic rolled body, node-scoped", () => {
    const seed = seedFor("recruiter");
    const a = recruiterOffer(seed, NODE);
    const b = recruiterOffer(seed, NODE);
    expect(a.unit.id).toBe(`recruit-${NODE.id}`);
    expect(a.unit).toEqual(b.unit);
    expect(a.price).toBe(NODE_EVENTS.recruiterHireCost);
    // A different node yields a distinct id (no collision).
    const other = recruiterOffer(seed, { ...NODE, id: "n4-0" });
    expect(other.unit.id).not.toBe(a.unit.id);
  });

  it("hiring debits the purse and the body joins run.party immediately", () => {
    const seed = seedFor("recruiter");
    const run = newRun(seed, 200);
    const offer = recruiterOffer(seed, NODE);
    const before = run.camp.gold;
    const out = hireRecruit(run, offer);
    expect(out.recruited?.id).toBe(offer.unit.id);
    expect(out.goldDelta).toBe(-offer.price);
    expect(run.camp.gold).toBe(before - offer.price);
    expect(run.party.some((u) => u.id === offer.unit.id)).toBe(true);
    // Idempotent: a second hire of the same body is a clean no-op.
    expect(hireRecruit(run, offer).recruited).toBeUndefined();
  });

  it("declining is a clean no-op (no party change, nothing spent)", () => {
    const seed = seedFor("recruiter");
    const run = newRun(seed, 200);
    const partyBefore = run.party.length;
    const out = chooseEventOption(run, NODE, "decline");
    expect(out.goldDelta).toBe(0);
    expect(run.party.length).toBe(partyBefore);
    expect(run.camp.gold).toBe(200);
  });

  it("a poor purse can't hire (spends nothing)", () => {
    const seed = seedFor("recruiter");
    const run = newRun(seed, 5);
    const out = hireRecruit(run, recruiterOffer(seed, NODE));
    expect(out.recruited).toBeUndefined();
    expect(run.camp.gold).toBe(5);
  });

  it("honors the temp↔permanent flag (D33): generic temporary, authored permanent", () => {
    const seed = seedFor("recruiter");
    const offer = recruiterOffer(seed, NODE);
    // A rolled body is generic → temporary (no permanent guild join).
    expect(offer.classify.temporary).toBe(true);
    expect(offer.classify.permanent).toBe(false);
    // An authored body would be a permanent recruit.
    const authored = recruiterOffer(seed, NODE);
    authored.unit.authored = true;
    authored.classify = { permanent: true, temporary: false };
    const run = newRun(seed, 200);
    const out = hireRecruit(run, authored);
    expect(out.summary).toMatch(/guild/i);
  });

  it("the headless default declines (party unchanged)", () => {
    const seed = seedFor("recruiter");
    const run = newRun(seed, 200);
    const before = run.party.length;
    const out = resolveEvent(run, NODE);
    expect(out.kind).toBe("recruiter");
    expect(run.party.length).toBe(before);
    expect(run.camp.gold).toBe(200);
  });
});

// --- Story (an authored choice, D23) ----------------------------------------

describe("node-events — story applies a deterministic outcome (D23)", () => {
  it("the story drawn + its choice set are stable for a seed", () => {
    const seed = seedFor("story");
    const s1 = storyForNode(seed, NODE);
    const s2 = storyForNode(seed, NODE);
    expect(s1.id).toBe(s2.id);
    expect(s1.choices.length).toBe(2);
    expect(eventChoices(newRun(seed), NODE).map((c) => c.id)).toEqual(s1.choices.map((c) => c.id));
  });

  it("each option applies its deterministic outcome (gold/morale/fatigue/material)", () => {
    // Drive every option of every authored story and confirm deterministic effects.
    for (const story of STORIES) {
      for (const choice of story.choices) {
        const a = newRun("story-det", 200);
        const b = newRun("story-det", 200);
        const outA = applyStoryChoice(a, NODE, story, choice.id);
        const outB = applyStoryChoice(b, NODE, story, choice.id);
        expect(outA).toEqual(outB);
        expect(a.camp.gold).toBe(b.camp.gold);
        expect(a.camp.morale).toBe(b.camp.morale);
        // The recorded deltas match the mutations they describe.
        expect(a.camp.morale).toBe(200 * 0 + outA.moraleDelta); // morale started at 0
      }
    }
  });

  it("a seeded gold roll (the shrine 'loot') reproduces for a seed", () => {
    const shrine = getStory("abandoned-shrine")!;
    const a = newRun("shrine", 100);
    const b = newRun("shrine", 100);
    const outA = applyStoryChoice(a, NODE, shrine, "loot");
    const outB = applyStoryChoice(b, NODE, shrine, "loot");
    expect(outA.goldDelta).toBe(outB.goldDelta);
    expect(outA.goldDelta).toBeGreaterThan(0);
    expect(a.camp.gold).toBe(100 + outA.goldDelta);
  });

  it("a pay can never drive the purse negative", () => {
    const shrine = getStory("abandoned-shrine")!;
    const run = newRun("broke", 3);
    const out = applyStoryChoice(run, NODE, shrine, "offer"); // -10g
    expect(run.camp.gold).toBeGreaterThanOrEqual(0);
    expect(out.goldDelta).toBe(-3); // capped at the purse
  });
});

// --- Thief regression (D30) -------------------------------------------------

describe("node-events — the thief event still skims, blunted by the Banker (D30)", () => {
  it("a thief event skims the purse via the registry", () => {
    const seed = seedFor("thief");
    const run = newRun(seed, 120);
    const out = resolveEvent(run, NODE);
    expect(out.kind).toBe("thief");
    expect(out.stolen).toBeGreaterThan(0);
    expect(run.camp.gold).toBe(120 - (out.stolen ?? 0));
  });

  it("Banker protection blunts the skim", () => {
    const seed = seedFor("thief");
    const open = newRun(seed, 200);
    const guarded = newRun(seed, 200);
    guarded.overworld.protection = 0.5;
    const stolenOpen = resolveEvent(open, NODE).stolen ?? 0;
    const stolenGuarded = resolveEvent(guarded, NODE).stolen ?? 0;
    expect(stolenGuarded).toBeLessThan(stolenOpen);
  });
});

// --- The toll: a visible, known fee (D48) -----------------------------------

describe("node-events — the toll is a visible, known fee (D48)", () => {
  it("tollFee is deterministic per node + seed (knowable in advance)", () => {
    expect(tollFee("toll-seed", NODE)).toBe(tollFee("toll-seed", NODE));
    expect(tollFee("toll-seed", NODE)).toBeGreaterThanOrEqual(NODE_EVENTS.tollMin);
    expect(tollFee("toll-seed", NODE)).toBeLessThanOrEqual(NODE_EVENTS.tollMax);
  });

  it("nodeFee reports the fee for a toll node and 0 otherwise", () => {
    const tollSeed = seedFor("toll");
    expect(nodeFee(tollSeed, NODE)).toBe(tollFee(tollSeed, NODE));
    // A non-toll event node carries no visible fee.
    const thiefSeed = seedFor("thief");
    expect(nodeFee(thiefSeed, NODE)).toBe(0);
    // A non-event node never carries a fee.
    expect(nodeFee(tollSeed, { ...NODE, kind: "combat" })).toBe(0);
  });

  it("resolving a toll pays the known fee from the purse (never negative)", () => {
    const seed = seedFor("toll");
    const fee = tollFee(seed, NODE);
    const run = newRun(seed, fee + 50);
    const out = resolveEvent(run, NODE);
    expect(out.kind).toBe("toll");
    expect(out.goldDelta).toBe(-fee);
    expect(run.camp.gold).toBe(50);

    // Broke: the toll takes what it can, never driving the purse negative.
    const poor = newRun(seed, 3);
    resolveEvent(poor, NODE);
    expect(poor.camp.gold).toBe(0);
  });
});

// --- The interpreter + autoTraverse determinism -----------------------------

describe("node-events — autoResolve keeps autoTraverse deterministic (D22)", () => {
  it("eventChoices/chooseEventOption dispatch by kind", () => {
    const shopSeed = seedFor("shop");
    expect(eventChoices(newRun(shopSeed), NODE).every((c) => c.id.startsWith("buy:"))).toBe(true);

    const recSeed = seedFor("recruiter");
    expect(eventChoices(newRun(recSeed), NODE).map((c) => c.id)).toEqual(["hire", "decline"]);

    const storySeed = seedFor("story");
    expect(eventChoices(newRun(storySeed), NODE).length).toBe(2);

    const thiefSeed = seedFor("thief");
    expect(eventChoices(newRun(thiefSeed), NODE)).toEqual([]); // no choice
  });

  it("a full map with event nodes auto-traverses identically for a seed", () => {
    // Find a seed whose map actually contains an event node.
    let seed = "";
    for (let i = 0; i < 60; i++) {
      const s = `auto-${i}`;
      const map = generateOverworld(s);
      if (map.order.some((id) => getNode(map, id).kind === "event")) {
        seed = s;
        break;
      }
    }
    expect(seed).not.toBe("");

    function fixedFighter(): Unit {
      return createUnit({
        id: "Rook", side: "player", pos: { col: -1, row: -1 }, name: "Rook", jobId: "soldier",
        speed: 11, maxHp: 28, attack: 9, defense: 3, moveRange: 4, sightRadius: 5, awareness: 3, intelligence: 3,
      });
    }
    function play(): RunState["history"] {
      const run = createRun(seed, { party: [fixedFighter()], difficultyId: "normal", gold: 200 });
      new RunLoop(run).autoTraverse();
      return run.history;
    }
    expect(play()).toEqual(play());
  });
});
