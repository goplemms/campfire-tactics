import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import { createRun, type RunState } from "./run";
import { RunLoop } from "./runloop";
import { generateOverworld, getNode, type MapNode } from "./overworld";
import { countOf, slotsOver } from "./inventory";
import { merchantPrice } from "./economy-actions";
import {
  EVENTS,
  getEvent,
  eventForNode,
  eventWeightAt,
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
  EARLY_EVENT,
  earlyEventForNode,
  resolveEarlyEvent,
  BYPASS,
  BLOCKADE,
  bypassFee,
  bypassXp,
  tailoredEarlyEventFor,
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
      // Seeded events weight into the per-node pick (> 0); authored-only events (D52 —
      // pinned to a node by `MapNode.eventId`) carry weight 0 so they never leak into
      // the seeded pool. Both are valid; only the non-negativity is universal.
      expect(e.weight).toBeGreaterThanOrEqual(0);
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

describe("node-events — standing gates event quality (D62)", () => {
  it("at 'unknown' standing the weights are the base weights (no-Noble baseline unchanged)", () => {
    for (const e of EVENTS) {
      // Premium events (minInfluence) are gated out at unknown; the rest match base.
      const expected = e.minInfluence ? 0 : e.weight;
      expect(eventWeightAt(e, "unknown")).toBe(expected);
    }
  });

  it("a boon grows likelier and a bane rarer as standing rises", () => {
    const shop = getEvent("shop"); // boon
    const thief = getEvent("thief"); // bane
    expect(eventWeightAt(shop, "renowned")).toBeGreaterThan(eventWeightAt(shop, "unknown"));
    expect(eventWeightAt(thief, "renowned")).toBeLessThan(eventWeightAt(thief, "unknown"));
  });

  it("the premium Patron's Welcome is gated below 'favored' standing", () => {
    const patron = getEvent("patron-welcome");
    expect(patron.minInfluence).toBe("favored");
    expect(eventWeightAt(patron, "respected")).toBe(0); // gated out
    expect(eventWeightAt(patron, "favored")).toBeGreaterThan(0); // unlocked
    expect(eventWeightAt(patron, "renowned")).toBeGreaterThan(0);
  });

  it("a patron event can only appear once standing is high enough", () => {
    const map = generateOverworld("patron-reach");
    const eventIds = map.order.map((id) => getNode(map, id)).filter((n) => n.kind === "event");
    const atUnknown = new Set(eventIds.map((n) => eventForNode("patron-reach", n, "unknown").id));
    const atRenowned = new Set(eventIds.map((n) => eventForNode("patron-reach", n, "renowned").id));
    expect(atUnknown.has("patron-welcome")).toBe(false); // never at low standing
    // (Whether a given map *has* a node that lands the patron at renowned is seed-dependent;
    // the gate — never below favored — is the invariant asserted above.)
    expect(atRenowned.size).toBeGreaterThan(0);
  });

  it("the Patron's Welcome boon: morale + a sellable gift + a touch of Influence (no gold-from-nothing)", () => {
    const run = newRun("patron-boon");
    run.overworld.influence = 16; // favored
    const moraleBefore = run.camp.morale;
    const infBefore = run.overworld.influence;
    const goldBefore = run.camp.gold;
    const out = getEvent("patron-welcome").autoResolve(run, NODE);
    expect(out.kind).toBe("patron");
    expect(run.camp.morale).toBe(moraleBefore + out.moraleDelta);
    expect(out.moraleDelta).toBeGreaterThan(0);
    expect(countOf(run.inventory, "valuables")).toBeGreaterThan(0); // a sellable gift
    expect(run.overworld.influence).toBeGreaterThan(infBefore); // goodwill compounds
    expect(out.goldDelta).toBe(0); // never mints gold
    expect(run.camp.gold).toBe(goldBefore);
  });
});

describe("node-events — the Node 2 traveler-gift overflows storage (D79)", () => {
  // Provision is `weight: 0` (never seeded — only pinned to a node by `eventId`), e.g. the
  // Hollow Mill's `camp2`. The render dispatches it as a *choice* (not auto-resolve); the
  // data it feeds the panel is pinned here.
  const PROVISION_NODE: MapNode = { id: "camp2", layer: 2, index: 0, kind: "event", edges: [], eventId: "provision-choice" };

  it("offers accept-gift, and cook-stew only with a Cook aboard (no pick-one anymore)", () => {
    const run = newRun("prov");
    expect(eventChoices(run, PROVISION_NODE).map((c) => c.id)).toEqual(["accept-gift"]);
    // A Cook in the party opens the second option (the L1 rescue paying forward).
    run.party.push(createUnit({ id: "pip", side: "player", pos: { col: -1, row: -1 }, name: "Pip", jobId: "cook", speed: 8, maxHp: 18, attack: 2, defense: 1, moveRange: 3, sightRadius: 4 }));
    expect(eventChoices(run, PROVISION_NODE).map((c) => c.id)).toEqual(["accept-gift", "cook-stew"]);
  });

  it("the gifts (trap kits + iron-weapons) always land — even over the cap (D75/D78)", () => {
    const run = newRun("prov2", 200, 5);
    // A full stash (mirrors the mill bundle): the gifts land anyway, over the cap.
    run.inventory.counts = { salve: 2, stimulant: 1, antidote: 2, "trap-kit": 2 }; // 5/5 — exactly full
    const trapsBefore = countOf(run.inventory, "trap-kit");
    chooseEventOption(run, PROVISION_NODE, "accept-gift");
    expect(countOf(run.inventory, "trap-kit")).toBe(trapsBefore + 2); // +2 gifted
    expect(countOf(run.inventory, "iron-weapons")).toBe(1); // the party-gear edge
    expect(slotsOver(run.inventory)).toBe(3); // 8 slots used over cap 5 — the discard to clear
  });

  it("even on an emptied stash (all traps spent at Node 1) the gift still overflows", () => {
    const run = newRun("prov3", 200, 5);
    run.inventory.counts = { salve: 3, stimulant: 1, antidote: 2 }; // 3 slots (traps all used)
    chooseEventOption(run, PROVISION_NODE, "accept-gift");
    expect(slotsOver(run.inventory)).toBeGreaterThan(0); // a discard is still forced
  });

  it("the cook-stew path takes the gifts AND banks RP", () => {
    const run = newRun("prov4", 200, 5);
    const rpBefore = run.rp;
    const out = chooseEventOption(run, PROVISION_NODE, "cook-stew");
    expect(countOf(run.inventory, "trap-kit")).toBe(2); // the gift still lands
    expect(countOf(run.inventory, "iron-weapons")).toBe(1);
    expect(out.materials).toEqual(expect.arrayContaining(["trap-kit", "iron-weapons"]));
    expect(run.rp).toBeGreaterThan(rpBefore); // plus the RP payoff
  });
});

// --- Early events: the arrival layer (D80) ----------------------------------

describe("node-events — early events are an occasional, deterministic arrival layer (D80)", () => {
  const combat = (id: string): MapNode => ({ id, layer: 2, index: 0, kind: "combat", edges: [] });

  it("is a pure deterministic pick — stable for a seed + node", () => {
    const a = earlyEventForNode(newRun("early-det"), combat("n2-0"));
    const b = earlyEventForNode(newRun("early-det"), combat("n2-0"));
    expect(a?.id ?? null).toBe(b?.id ?? null);
  });

  it("is occasional — some nodes carry one, most don't", () => {
    let fired = 0;
    const N = 120;
    for (let i = 0; i < N; i++) {
      if (earlyEventForNode(newRun("early-occ"), combat(`n-${i}`))) fired++;
    }
    expect(fired).toBeGreaterThan(0); // it does fire…
    expect(fired).toBeLessThan(N); // …but never on every node (the anti-agony stance)
  });

  it("never stacks onto an event-kind or authored/pinned node", () => {
    expect(earlyEventForNode(newRun("x"), { id: "n2-0", layer: 2, index: 0, kind: "event", edges: [] })).toBeNull();
    expect(earlyEventForNode(newRun("x"), { id: "n2-0", layer: 2, index: 0, kind: "combat", edges: [], eventId: "thief" })).toBeNull();
  });

  it("draws only from the random pool, and every fired event resolves with a summary", () => {
    for (let i = 0; i < 120; i++) {
      const run = newRun(`early-pool-${i}`);
      const node = combat(`n-${i}`);
      const def = earlyEventForNode(run, node);
      if (!def) continue;
      // A tailored event (the blockade) takes precedence; otherwise it's from the random pool.
      if (!tailoredEarlyEventFor(run, node)) expect(EARLY_EVENT.pool).toContain(def.id);
      const out = resolveEarlyEvent(run, node, def);
      expect(out.summary.length).toBeGreaterThan(0);
    }
  });

  it("at low standing the pool is thief-only; a favored caravan unlocks the patron", () => {
    // Patron is gated to `favored` (Influence ≥ 15) — so at the default standing every early
    // event is the thief, and the boon only joins the pool once standing has earned it (D62).
    const lowKinds = new Set<string>();
    const highKinds = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const node = combat(`n-${i}`);
      // This test is about the *random* pool's standing gating — skip nodes the tailored
      // (blockade) layer claims, which take precedence in earlyEventForNode.
      const low = newRun(`early-low-${i}`);
      if (!tailoredEarlyEventFor(low, node)) {
        const d1 = earlyEventForNode(low, node);
        if (d1) lowKinds.add(d1.id);
      }
      const high = newRun(`early-high-${i}`);
      high.overworld.influence = 20; // favored+
      if (!tailoredEarlyEventFor(high, node)) {
        const d2 = earlyEventForNode(high, node);
        if (d2) highKinds.add(d2.id);
      }
    }
    expect([...lowKinds]).toEqual(["thief"]); // nothing but the pickpocket at low standing
    expect(highKinds.has("patron-welcome")).toBe(true); // the boon appears once favored
  });
});

// --- Tailored events + the gated encounter-bypass (D80) ---------------------

describe("node-events — tailored events + the gated encounter-bypass (D80)", () => {
  const combat = (id: string, layer: number): MapNode => ({ id, layer, index: 0, kind: "combat", edges: [] });

  it("bypassFee and bypassXp scale with map depth", () => {
    expect(bypassFee(combat("a", 0))).toBe(BYPASS.feeBase);
    expect(bypassFee(combat("a", 3))).toBe(BYPASS.feeBase + 3 * BYPASS.feePerLayer);
    expect(bypassXp(combat("a", 3))).toBe(BYPASS.xpBase + 3 * BYPASS.xpPerLayer);
  });

  it("a tailored event is deterministic, and only on non-final combat nodes", () => {
    const run = newRun("tailored");
    const a = tailoredEarlyEventFor(run, combat("n2-0", 2));
    const b = tailoredEarlyEventFor(run, combat("n2-0", 2));
    expect(a?.id ?? null).toBe(b?.id ?? null); // stable for a seed + node
    // Never on a rest node…
    expect(tailoredEarlyEventFor(run, { id: "r", layer: 2, index: 0, kind: "rest", edges: [] })).toBeNull();
    // …nor on the final node (the objective is never skippable).
    expect(tailoredEarlyEventFor(run, combat("fin", run.map.layers - 1))).toBeNull();
  });

  it("when it fires, the tailored event is The Blockade", () => {
    let fired = null as ReturnType<typeof tailoredEarlyEventFor>;
    for (let i = 0; i < 300 && !fired; i++) {
      fired = tailoredEarlyEventFor(newRun("t"), combat(`c-${i}`, 2));
    }
    expect(fired?.id).toBe("blockade");
  });

  it("the bypass is gated on gold AND standing, and forgoes loot", () => {
    const node = combat("n2-0", 2);
    const fee = bypassFee(node);

    // Poor + no standing → the pay option is unavailable.
    const poor = newRun("blk-poor", fee - 1);
    const payPoor = BLOCKADE.choices!(poor, node).find((c) => c.id === "pay")!;
    expect(payPoor.available).toBe(false);

    // Rich + favored standing → available.
    const rich = newRun("blk-rich", fee + 100);
    rich.overworld.influence = 20; // ≥ the respected floor
    const payRich = BLOCKADE.choices!(rich, node).find((c) => c.id === "pay")!;
    expect(payRich.available).toBe(true);

    // Choosing pay spends the fee and flags a bypass.
    const goldBefore = rich.camp.gold;
    const out = BLOCKADE.choose!(rich, node, "pay");
    expect(out.bypass).toBe(true);
    expect(rich.camp.gold).toBe(goldBefore - fee);

    // Cutting through is always available and never bypasses.
    const cut = BLOCKADE.choose!(rich, node, "fight");
    expect(cut.bypass).toBeFalsy();
  });

  it("earlyEventForNode surfaces a tailored event ahead of the random pool", () => {
    let run: RunState | null = null;
    let node: MapNode | null = null;
    for (let i = 0; i < 300 && !node; i++) {
      const r = newRun(`t2-${i}`);
      const c = combat(`c2-${i}`, 2);
      if (tailoredEarlyEventFor(r, c)) {
        run = r;
        node = c;
      }
    }
    expect(node).not.toBeNull();
    expect(earlyEventForNode(run!, node!)?.id).toBe("blockade");
  });
});
