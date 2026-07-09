/**
 * Hollow Mill authored events (D52/D79) — the expedition's hand-authored node beats.
 *
 * Split out of `node-events.ts` (R3, #119): the two authored records the Hollow Mill
 * pins to its nodes — the Node-2 "A Traveler on the Road" provision beat and the
 * Layer-5 "Market Town" — plus their resolvers. They are **registered into the event
 * registry via {@link "./node-events".registerEvent}** (called by `node-events.ts`),
 * not hardcoded inline; they keep `weight: 0` so they never enter the seeded pool
 * (they run only when pinned to a node by `MapNode.eventId`). Pure code motion:
 * behaviour unchanged.
 *
 * Note (#119): {@link MIRA_SPEC} re-implements the merchant baseline by hand rather
 * than reusing hollow-mill's `member()` — that hand-rolled duplicate moves here
 * **as-is**; reconciling it would be a behaviour risk, not a motion.
 *
 * Pure logic: no Phaser, no DOM.
 */

import type { RunState } from "./run";
import { marketOpenedFlag, type MapNode } from "./overworld";
import { createUnit, fieldsJob, type UnitSpec } from "./units";
import { getJob } from "./jobs";
import { grantItem } from "./inventory";
import { accrueRp } from "./upkeep";
import { emptyOutcome, type EventDef, type EventOutcome } from "./node-events";

// --- The Hollow Mill authored-event resolvers (D52) -------------------------

/**
 * The Node 2 traveler's gifts (D79): trap kits + the iron-weapons **party-gear** material,
 * sized to **overflow the full bundle** (the cap-5 start) so a discard is forced at Break Camp
 * whether or not the player spent traps at Node 1. Grant-order is fixed (deterministic).
 */
const TRAVELER_GIFT: ReadonlyArray<readonly [string, number]> = [
  ["trap-kit", 2],
  ["iron-weapons", 1],
];

/**
 * Apply the Node 2 traveler-gift (D79): the gifts **always land** — over the storage cap if
 * need be (D75) — so the overflow forces a deliberate discard at Break Camp (the storage
 * lesson; carrying the iron weapons is the D78 party-wide +attack edge, so the discard is a
 * real trade). Every path takes the gifts; `cook-stew` additionally banks RP (the Cook payoff).
 */
export function applyProvisionChoice(run: RunState, choiceId: string): EventOutcome {
  const out = emptyOutcome("provision");
  // The gifts land unconditionally (D75) — grants don't vanish at the cap; the player chooses
  // what to let go at Break Camp (the discard menu, or autoTrim headless).
  for (const [id, n] of TRAVELER_GIFT) grantItem(run.inventory, id, n);
  out.materials = TRAVELER_GIFT.map(([id]) => id);
  if (choiceId === "cook-stew") {
    // The first Cook verb (E3): bank a little RP + ease the food line, and still take the gifts.
    accrueRp(run, 2);
    out.summary =
      "Pip cooks a hot stew for the road and the traveler both — spirits and rations hold (RP banked). The parting gifts, trap kits and old iron, ride on, packs be damned.";
    return out;
  }
  out.summary =
    "You thank the traveler and stow the gifts — trap kits and iron weapons, more than the stash was built for. Something will have to go before you march.";
  return out;
}

/** Mira the Merchant's spec (D52) — the Layer-5 town recruit, off the merchant baseline. */
const MIRA_SPEC: UnitSpec = (() => {
  const base = getJob("merchant")?.baseline;
  return {
    id: "mira",
    name: "Mira",
    side: "player",
    pos: { col: 0, row: 0 },
    jobId: "merchant",
    authored: true,
    speed: base?.speed ?? 9,
    maxHp: base?.maxHp ?? 20,
    attack: base?.attack ?? 5,
    defense: base?.defense ?? 2,
    moveRange: base?.moveRange ?? 3,
    sightRadius: base?.sightRadius ?? 4,
    attackRange: base?.attackRange ?? 1,
    intelligence: 2,
    awareness: 2,
    standingOrder: "defend",
  };
})();

/** Apply a Layer-5 town visit (D52): recruit Mira + open the market. */
export function applyTownVisit(run: RunState, node: MapNode, choiceId: string): EventOutcome {
  const out = emptyOutcome("town");
  if (choiceId === "open-market") {
    run.overworld.nodeFlags[marketOpenedFlag(node.id)] = true;
    out.summary = "The market opens — purse gold finally has a sink.";
    return out;
  }
  // Default / recruit-mira — Mira joins the party as a camp Merchant (idempotent).
  if (run.party.some((u) => u.id === "mira")) {
    out.summary = "Mira already rides with the caravan.";
    return out;
  }
  const mira = createUnit(MIRA_SPEC);
  run.party.push(mira);
  out.recruited = mira;
  out.summary = "Mira the Merchant joins the caravan — markets and a sharper purse.";
  return out;
}

// --- The authored records (registered into EVENTS by node-events.ts) ---------

/**
 * The Hollow Mill node-2 "A Traveler on the Road" (D52/D79): the **storage-scarcity**
 * beat. No longer a pick-one — a roadside traveler **presses gifts on the party
 * unconditionally** (trap kits + iron weapons), a grant that **always lands over the cap**
 * (D75) onto a full stash, so the player must **discard back to the cap** at Break Camp.
 * The iron weapons are the `iron-weapons` **party-gear** material (D78) — carrying them is
 * the party-wide +attack edge — so the discard is a real trade ("keep the buff or the
 * snares?"). The first **Cook Stew** (RP bank) rides *alongside* the gift when a Cook is
 * aboard. Authored — pinned to the node via `MapNode.eventId`, never seeded (weight 0).
 */
const PROVISION_CHOICE_EVENT: EventDef = {
  id: "provision-choice",
  kind: "provision",
  name: "A Traveler on the Road",
  teaser: "A traveler shares your fire and presses gifts on you — trap kits and old iron weapons, more than your packs were built to hold. (And a hot meal, if a Cook rides along.)",
  weight: 0, // authored-only — pinned by node, never seeded
  autoResolve(run, _node) {
    // Headless default: accept the gifts (they always land; the overflow is autoTrimmed at Break Camp).
    return applyProvisionChoice(run, "accept-gift");
  },
  choices(run, _node) {
    // A **fielded** Cook (D7): a captured Cook is bound and cooks nothing — this
    // check had forgotten `!u.captured` (the R2 audit's named behavior fix, #125).
    const cook = fieldsJob(run.party, "cook");
    return [
      {
        id: "accept-gift",
        label: "Accept the gifts and camp for the night",
        available: true,
        detail: "Trap kits + iron weapons (a party-wide attack edge) join the stash — even over your cap. You'll choose what to drop before you break camp.",
      },
      ...(cook
        ? [{ id: "cook-stew", label: "Accept, and have Pip cook a stew (banks Rest Points)", available: true, detail: "Take the gifts and break bread — Pip banks RP and eases the food line." }]
        : []),
    ];
  },
  choose(run, _node, choiceId) {
    return applyProvisionChoice(run, choiceId);
  },
};

/**
 * The Hollow Mill Layer-5 **Market town** (D52): recruit Mira the Merchant (joins
 * the party as a camp body) + open a `basic` market here (Find Trade). The economy
 * hub every road reaches — the Merchant beat is guaranteed. Authored-only.
 */
const MERCHANT_TOWN_EVENT: EventDef = {
  id: "merchant-town",
  kind: "town",
  name: "Market Town",
  teaser: "The first real town — a Merchant to recruit and a market to spend at.",
  weight: 0,
  autoResolve(run, node) {
    // Headless default: recruit Mira (the guaranteed economy beat) + open the market.
    return applyTownVisit(run, node, "recruit-mira");
  },
  choices(run, _node) {
    const mira = run.party.some((u) => u.id === "mira");
    return [
      {
        id: "recruit-mira",
        label: mira ? "Mira already rides with you" : "Recruit Mira the Merchant",
        available: !mira,
        detail: mira ? "Already recruited." : "A camp Merchant — markets, Find Trade, Savvy Barter.",
      },
      { id: "open-market", label: "Open the market here", available: true, detail: "Trade at a town market." },
    ];
  },
  choose(run, node, choiceId) {
    return applyTownVisit(run, node, choiceId);
  },
};

/** The authored records this module contributes to the event registry, in registration order. */
export const HOLLOW_MILL_EVENTS: readonly EventDef[] = [PROVISION_CHOICE_EVENT, MERCHANT_TOWN_EVENT];
