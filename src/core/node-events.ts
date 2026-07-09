/**
 * Node events (M11, D23/D4) — the event-node registry + one resolver.
 *
 * M10 added a third overworld node kind — `event` — but with exactly **one** event
 * behind it (the thief that skims the purse, {@link "./theft"}). D23 deferred the
 * rest of the menagerie. M11 is that batch: it generalizes `event` into a
 * **data-driven registry**. An {@link EventDef} declares an event (id, kind, name,
 * teaser, weight, an {@link EventDef.autoResolve} for the headless path); {@link
 * eventForNode} picks **which** event an event-node runs, **deterministically per
 * node** (D22); and one interpreter ({@link resolveEvent}/{@link eventChoices}/
 * {@link chooseEventOption}) drives them. **New events are new records, not new
 * branches** (D4).
 *
 * Four events ship, each **reusing M10's machinery** rather than adding economy:
 *
 * - **thief** — folds the M10 skim into a record ({@link "./theft".thiefEventSkim}).
 * - **shop** — a seeded stock bought from the **purse** into caravan storage,
 *   reusing the Merchant verb ({@link "./economy-actions".merchantBuy}), node-tier
 *   priced, under the storage cap (D6), never the treasury (D34).
 * - **recruiter** — a **rolled** body ({@link "./guild".rollMercenary}) hired for
 *   purse gold who joins `run.party` immediately (a field reinforcement). Honors the
 *   temp↔permanent flag (D33) when an authored body appears (authored cast deferred).
 * - **story** — a small **authored-as-data** choice (2 options), each applying a
 *   **deterministic** outcome (gold/morale/fatigue/material). The first narrative
 *   beat — data, not a story engine (D23).
 *
 * **Determinism (D22):** which event fires, the shop stock, the recruiter roll, the
 * story drawn, and every outcome roll all derive from seeds (`streamFor(seed,
 * "event:<nodeId>")` + per-facet labels) — no live RNG, no `Math.random`. Each
 * {@link EventDef} carries an {@link EventDef.autoResolve} so the headless path
 * ({@link "./runloop".RunLoop.autoTraverse}) stays deterministic.
 *
 * Pure logic: no Phaser, no DOM.
 */

import type { RunState } from "./run";
import type { MapNode } from "./overworld";
import { type Unit } from "./units";
import { describeUnit } from "./dossier";
import { streamFor } from "./rng";
import { Labels } from "./rng-labels";
import { MATERIALS, grantItem, canAdd } from "./inventory";
import { getEquipment } from "./equipment";
import { addInfluence, influenceTier, type InfluenceTier } from "./economy";
import { merchantBuy, merchantPrice } from "./economy-actions";
import { rollMercenary } from "./guild";
import { recruitClassify, type RecruitOutcome } from "./recruitment";
import { thiefEventSkim } from "./theft";
import { spend } from "./purse-journal";
import { rankOf } from "./num";
import { nudgeMorale } from "./camp";
import { storyForNode, storyChoices, applyStoryChoice } from "./stories";
import { HOLLOW_MILL_EVENTS } from "./hollow-mill-events";

/**
 * An event kind (M11; **toll** added M13/D48). New kinds are new records on
 * {@link EVENTS} (D4). The **toll** is the forecast's visible node fee — "a thief
 * that tells you the price up front and doesn't sneak" — a *known*, deterministic
 * cost you see while planning and **route around** (vs. the fogged thief skim).
 */
export type EventKind = "thief" | "shop" | "recruiter" | "story" | "toll" | "patron" | "provision" | "town";

/** Node-event tuning — all data, a numbers pass later (D23/D30/D33/D48). */
export const NODE_EVENTS = {
  /** How many distinct supplies a shop offers at once (seeded from the registry). */
  shopStockSize: 2,
  /** Purse cost to hire a recruiter's rolled body (D33). */
  recruiterHireCost: 40,
  /** The toll fee range (D48) — deterministic per node, tuning deferred. */
  tollMin: 10,
  tollMax: 30,
} as const;

/** Patron's Welcome payout (D62) — a standing-gated boon, no gold-from-nothing. Tuning later. */
const PATRON = {
  /** Morale lift from the feast (D8). */
  morale: 2,
  /** A parting gift dropped into storage — `valuables` you can later sell at a market (D61). */
  gift: "valuables",
  /** Goodwill compounds: the welcome nudges standing up a touch. */
  influence: 2,
} as const;

/**
 * A toll node's **deterministic, visible** fee (M13, D48): a stable per-node gold
 * cost rolled from `streamFor(seed, "event:<id>:toll")`, so the route
 * [forecast](overworld.md) can read it **in advance** (the cost is knowable; only
 * loot is fogged) and the player can **route around** it. Stable for a seed (D22).
 */
export function tollFee(seed: string | number, node: MapNode): number {
  const rng = streamFor(seed, Labels.eventToll(node.id));
  return rng.range(NODE_EVENTS.tollMin, NODE_EVENTS.tollMax);
}

/**
 * The **visible node fee** on a node's path (M13, D48): the {@link tollFee} when the
 * node's deterministic event is a **toll**, else 0. Upkeep is the travel cost; this
 * is the only *extra*, known cost the forecast layers on (deterministic within
 * reach). Pure projection — reads the seed-built event pick, mutates nothing.
 */
export function nodeFee(seed: string | number, node: MapNode): number {
  if (node.kind !== "event") return 0;
  return eventForNode(seed, node).kind === "toll" ? tollFee(seed, node) : 0;
}

/**
 * The structured outcome an event resolution produces — the render reads it and the
 * run-history records its `goldDelta`. Every field is a *net* effect already applied
 * to the run (the resolvers mutate `run`); this is the report, not a command.
 */
export interface EventOutcome {
  kind: EventKind;
  /** Net purse (`run.camp.gold`) delta — negative for a skim/spend, positive for a find. */
  goldDelta: number;
  /** Net camp morale delta (story). */
  moraleDelta: number;
  /** Net fatigue delta applied across the party (story; + tires, − would rest). */
  fatigueDelta: number;
  /** Material ids added to storage (a shop buy / a story reward). */
  materials: string[];
  /** A body recruited into `run.party` (recruiter), if any. */
  recruited?: Unit;
  /** Theft only: gold skimmed off the purse (blunted by Banker protection, D30). */
  stolen?: number;
  /** A human-readable result line for the render. */
  summary: string;
  /**
   * A **prestige** applied to a party unit (D65 offer→accept), if any — reported so
   * the render + run-history can react. The job evolved in place; `jobId` is frozen.
   */
  prestiged?: { unitId: string; from: string; into: string };
  /** A **memory** flag written on a party unit (D65 linked-event chain), if any. */
  remembered?: string;
  /**
   * D80 **encounter bypass**: this outcome **short-circuits the node's main encounter** — the day
   * resolves here (keep HP + EXP, forgo the loot) and the loop returns to camp with no fight. Set
   * by a tailored bypass event's paid choice; the scene calls {@link "./runloop".RunLoop.bypassEncounter}.
   */
  bypass?: boolean;
}

/** A blank outcome of a kind (resolvers fill in what they apply). */
export function emptyOutcome(kind: EventKind, summary = ""): EventOutcome {
  return { kind, goldDelta: 0, moraleDelta: 0, fatigueDelta: 0, materials: [], summary };
}

/**
 * An event definition (M11) — **data**. `weight` drives the deterministic pick;
 * `teaser` is the banded map preview (D24); `autoResolve` is the headless default
 * resolution (D22) so {@link "./runloop".RunLoop.autoTraverse} stays deterministic.
 */
export interface EventDef {
  id: string;
  kind: EventKind;
  name: string;
  /** A banded teaser shown on the map before committing (D24). */
  teaser: string;
  /** Relative weight in the deterministic per-node pick. */
  weight: number;
  /**
   * How the Noble's **standing** sways this event's odds (D62): a `boon` grows likelier
   * with higher Influence, a `bane` (thief/toll) rarer. Omitted ⇒ unaffected. The "quality
   * of what happens on the map rises with your standing" lever — read by {@link eventForNode}.
   */
  standingBias?: "boon" | "bane";
  /**
   * The minimum Influence **band** at which this event can appear at all (D62) — a
   * premium event gated behind real standing (e.g. the Patron's Welcome at `favored`).
   * Omitted ⇒ available at any standing.
   */
  minInfluence?: InfluenceTier;
  /**
   * The headless default resolution (D22): what the auto path applies when nobody
   * is interacting — a thief skims, a shop is passed, a recruiter is declined, a
   * story takes its seed-picked option. Mutates `run`; returns the outcome.
   */
  autoResolve(run: RunState, node: MapNode): EventOutcome;
  /**
   * The interactive options the render surfaces (M11). **Omitted** ⇒ the event has
   * no choice (a thief/toll just resolves). Pure read — mutates nothing. Lives on
   * the record so a new interactive event kind is a new record, not a new switch arm.
   */
  choices?(run: RunState, node: MapNode): EventChoice[];
  /**
   * Apply a chosen option (M11). **Omitted** ⇒ falls back to {@link autoResolve}.
   * Mutates `run`; returns the outcome (already applied).
   */
  choose?(run: RunState, node: MapNode, choiceId: string): EventOutcome;
}

// --- Shop (Merchant ACCESS reused, D30) -------------------------------------

/** A single shop offer — a supply at a node-tier price (M11). */
export interface ShopOffer {
  materialId: string;
  name: string;
  price: number;
}

/**
 * A roadside **shop event** is itself a guaranteed market (D61) — independent of the
 * event node's own (usually `none`/`poor`) seeded market tier, it always trades at a
 * **`basic`** market, so its stock is always buyable.
 */
const SHOP_MARKET_TIER = "basic" as const;

/**
 * A shop's **seeded** stock (M11) — a stable, node-keyed selection of supplies from
 * the {@link "./inventory".MATERIALS} registry, each at the **shop market price**
 * ({@link "./economy-actions".merchantPrice}). Stable for a seed (D22).
 */
export function shopStock(seed: string | number, node: MapNode): ShopOffer[] {
  const rng = streamFor(seed, Labels.eventShop(node.id));
  const price = merchantPrice(SHOP_MARKET_TIER);
  // Medical herbs (D40) are authored-quest provisioning, not overworld shop
  // stock; sell-only loot (D61) is never bought; equippable gear (D77) and party-gear
  // (D78) are not generic shuffle stock (they come from authored grants / a future
  // weapon market) — all excluded so the seeded shop selection stays stable (and adding
  // them to MATERIALS leaves un-upgraded runs byte-identical).
  const stockable = Object.keys(MATERIALS).filter(
    (id) => !MATERIALS[id].medical && !MATERIALS[id].loot && !MATERIALS[id].partyGear && !getEquipment(id),
  );
  const ids = rng.shuffle(stockable).slice(0, NODE_EVENTS.shopStockSize);
  return ids.map((id) => ({ materialId: id, name: MATERIALS[id].name, price }));
}

/**
 * Buy one supply from a shop offer (M11) — reuses the Merchant verb
 * ({@link "./economy-actions".merchantBuy}): spends **purse** gold into caravan
 * storage under the cap (D6), never the treasury (D34). Returns the outcome
 * (`goldDelta < 0` on a buy; `summary` carries any refusal).
 */
export function shopBuy(run: RunState, _node: MapNode, materialId: string): EventOutcome {
  const before = run.camp.gold;
  const res = merchantBuy(run, materialId, SHOP_MARKET_TIER);
  const out = emptyOutcome("shop");
  if (!res.applied) {
    out.summary = res.reason ?? "Can't buy that.";
    return out;
  }
  out.goldDelta = run.camp.gold - before; // negative (spent)
  out.materials = [materialId];
  out.summary = res.detail ?? `Bought ${MATERIALS[materialId]?.name ?? materialId}.`;
  return out;
}

// --- Recruiter (a rolled body for purse gold, D33) --------------------------

/** A recruiter's offered body + its purse price (M11, D33). */
export interface RecruiterOffer {
  unit: Unit;
  price: number;
  /** How it would resolve on return (temp generic / perm authored, D33). */
  classify: RecruitOutcome;
}

/**
 * A recruiter's **deterministic** offer (M11, D33): a {@link "./guild".rollMercenary}
 * rolled body keyed by the node (so its stats + the price are stable for a seed,
 * D22), at the {@link NODE_EVENTS.recruiterHireCost} purse price. The rolled body's
 * id is node-scoped so two recruiter nodes never collide.
 */
export function recruiterOffer(seed: string | number, node: MapNode): RecruiterOffer {
  const base = rollMercenary(`${seed}#recruit:${node.id}`, 0);
  const unit: Unit = { ...base, id: `recruit-${node.id}` };
  return { unit, price: NODE_EVENTS.recruiterHireCost, classify: recruitClassify(unit) };
}

/**
 * Hire a recruiter's offered body (M11, D33): spend **purse** gold and push the unit
 * into `run.party` immediately — a field reinforcement for the rest of the run.
 * Refuses (spending nothing) if the purse can't cover it, or if the body already
 * joined (idempotent). Honors the temp↔permanent flag for an authored body (D33).
 */
export function hireRecruit(run: RunState, offer: RecruiterOffer): EventOutcome {
  const out = emptyOutcome("recruiter");
  if (run.party.some((u) => u.id === offer.unit.id)) {
    out.summary = `${offer.unit.name} already rides with the caravan.`;
    return out;
  }
  if (run.camp.gold < offer.price) {
    out.summary = `Not enough purse gold (${offer.price}g) to hire ${offer.unit.name}.`;
    return out;
  }
  spend(run.camp, offer.price, "recruit", `Hire ${offer.unit.name}`, { nodeId: run.mapNodeId, night: run.night });
  run.party.push(offer.unit);
  out.goldDelta = -offer.price;
  out.recruited = offer.unit;
  out.summary = offer.classify.permanent
    ? `${offer.unit.name} joins the caravan — and the guild on return.`
    : `${offer.unit.name} joins the caravan for the run.`;
  return out;
}

// --- The registry + the deterministic per-node pick (D4/D22) ----------------

/**
 * The event registry (M11, D4) — **data**. `eventForNode` weighted-picks among
 * these per event-node. Adding a *core* event is adding a record here; authored
 * expedition events (the Hollow Mill beats) register in via {@link registerEvent}
 * at load (see the bottom of this module). The array order is load-bearing: the
 * seeded {@link eventForNode} pick iterates it, so records **append** in a fixed
 * order (the weight-0 authored records never enter the pool, so their position is
 * irrelevant to the pick — but the append keeps the order stable regardless).
 */
export const EVENTS: EventDef[] = [
  {
    id: "thief",
    kind: "thief",
    name: "Thief on the Road",
    teaser: "A thief on the road — it skims the purse (Banker protection blunts it).",
    weight: 3,
    standingBias: "bane", // standing keeps the roads friendlier — thieves grow rarer (D62)
    autoResolve(run, node) {
      const theft = thiefEventSkim(run, node);
      const out = emptyOutcome("thief");
      out.stolen = theft.stolen;
      out.goldDelta = -theft.stolen;
      out.summary = theft.stolen > 0
        ? `A thief skimmed ${theft.stolen}g off the purse.`
        : "A thief tried the purse but came away empty.";
      return out;
    },
  },
  {
    id: "shop",
    kind: "shop",
    name: "Roadside Market",
    teaser: "A roadside market — spend purse gold on supplies (node-tier prices).",
    weight: 3,
    standingBias: "boon", // a known caravan draws more opportunities (D62)
    autoResolve(_run, _node) {
      // Headless default: buy nothing (a deterministic no-op).
      return emptyOutcome("shop", "The caravan passed the roadside market without trading.");
    },
    choices(run, node) {
      return shopStock(run.seed, node).map((offer) => {
        const room = canStoreMore(run, offer.materialId);
        const affordable = run.camp.gold >= offer.price;
        return {
          id: `buy:${offer.materialId}`,
          label: `Buy ${offer.name} (${offer.price}g purse)`,
          cost: offer.price,
          available: affordable && room,
          detail: !affordable ? "Not enough purse gold." : !room ? "No storage room." : "Spend purse gold into storage.",
        };
      });
    },
    choose(run, node, choiceId) {
      if (choiceId.startsWith("buy:")) return shopBuy(run, node, choiceId.slice(4));
      return emptyOutcome("shop", "The caravan moved on from the market.");
    },
  },
  {
    id: "recruiter",
    kind: "recruiter",
    name: "Wandering Sellsword",
    teaser: "A wandering sellsword — hire a body for purse gold to join the run.",
    weight: 2,
    standingBias: "boon", // sellswords seek out a caravan with a name (D62)
    autoResolve(_run, _node) {
      // Headless default: decline (a clean no-op — no party change).
      return emptyOutcome("recruiter", "The caravan passed on the sellsword's offer.");
    },
    choices(run, node) {
      const offer = recruiterOffer(run.seed, node);
      const affordable = run.camp.gold >= offer.price;
      return [
        {
          id: "hire",
          label: `Hire ${offer.unit.name} (${offer.price}g purse)`,
          cost: offer.price,
          available: affordable,
          detail: affordable ? `${describeUnit(offer.unit)} — joins the run party.` : "Not enough purse gold.",
        },
        { id: "decline", label: "Decline", available: true, detail: "Send the sellsword on their way." },
      ];
    },
    choose(run, node, choiceId) {
      if (choiceId === "hire") return hireRecruit(run, recruiterOffer(run.seed, node));
      return emptyOutcome("recruiter", "The caravan declined the sellsword.");
    },
  },
  {
    id: "story",
    kind: "story",
    name: "A Choice on the Road",
    teaser: "Something on the road asks a choice of the caravan.",
    weight: 2,
    standingBias: "boon",
    autoResolve(run, node) {
      // Headless default: take a seed-picked option (deterministic, D22).
      const story = storyForNode(run.seed, node);
      const rng = streamFor(run.seed, Labels.eventStoryAuto(node.id));
      const choice = rng.pick(story.choices);
      return applyStoryChoice(run, node, story, choice.id);
    },
    choices(run, node) {
      return storyChoices(run, node, storyForNode(run.seed, node));
    },
    choose(run, node, choiceId) {
      return applyStoryChoice(run, node, storyForNode(run.seed, node), choiceId);
    },
  },
  {
    id: "toll",
    kind: "toll",
    name: "Tollgate",
    teaser: "A tollgate — a known fee to pass (see the forecast). Route around it to save.",
    weight: 2,
    standingBias: "bane", // standing greases the way — fewer gates demand a toll (D62)
    autoResolve(run, node) {
      // A known, announced fee (D48): pay it from the purse to pass. Never drives
      // the purse negative; the pay-or-fight-the-guards choice is deferred (D23/D30).
      const fee = tollFee(run.seed, node);
      const paid = Math.min(run.camp.gold, fee);
      spend(run.camp, paid, "toll", `Toll @ ${node.id}`, { nodeId: node.id, night: run.night });
      const out = emptyOutcome("toll");
      out.goldDelta = -paid;
      out.summary = paid >= fee
        ? `Paid the ${fee}g toll to pass.`
        : `Scraped together ${paid}g of the ${fee}g toll to pass.`;
      return out;
    },
  },
  {
    // The standing-gated premium event (D62): a local patron feasts the company. The
    // *upside of a renowned Noble* — morale, a parting gift, and goodwill that compounds.
    // No gold-from-nothing (the economy stays scarce); it's a boon you earn with standing.
    id: "patron-welcome",
    kind: "patron",
    name: "Patron's Welcome",
    teaser: "A local patron throws open their doors — your standing precedes you.",
    weight: 4,
    standingBias: "boon",
    minInfluence: "favored", // only a well-regarded caravan is feasted (D62)
    autoResolve(run, _node) {
      const out = emptyOutcome("patron", "A patron feasts the company — spirits lift, and a parting gift is pressed into your hands.");
      nudgeMorale(run.camp, PATRON.morale);
      out.moraleDelta = PATRON.morale;
      grantItem(run.inventory, PATRON.gift); // the gift always lands (D75)
      out.materials = [PATRON.gift];
      // Goodwill compounds: the welcome itself nudges standing up a touch (D62).
      addInfluence(run.overworld, PATRON.influence);
      return out;
    },
  },
];

/**
 * Register an event into the {@link EVENTS} registry (M11/R3, #119) — the seam authored
 * expedition events (the Hollow Mill beats) use instead of a hardcoded inline record.
 * Appends in call order (idempotent by id: re-registering the same id is a no-op, so a
 * doubly-loaded module can't duplicate a record). The append keeps the registry iteration
 * order stable, which the seeded {@link eventForNode} pick relies on.
 */
function registerEvent(def: EventDef): void {
  if (EVENTS.some((e) => e.id === def.id)) return;
  EVENTS.push(def);
}

/** Look up an event def by id (M11). */
export function getEvent(id: string): EventDef {
  const def = EVENTS.find((e) => e.id === id);
  if (!def) throw new Error(`node-events: no event "${id}"`);
  return def;
}

/**
 * Ordered Influence bands, lowest → highest — for the standing-bias step math (D62).
 * Exported for {@link "./early-events".BLOCKADE}'s passage-standing gate (R3 split, #119).
 */
export const INFLUENCE_ORDER: readonly InfluenceTier[] = ["unknown", "known", "respected", "favored", "renowned"];

/**
 * An event's **standing-adjusted weight** (D62): the base weight, scaled by how the
 * Noble's current band `tier` sways it (a `boon` grows, a `bane` shrinks), and **0**
 * when the event is gated above the current band (`minInfluence`). At `unknown` standing
 * every multiplier is 1 and nothing is gated, so this is identical to the base weight —
 * the no-Noble baseline is unchanged.
 */
export function eventWeightAt(def: EventDef, tier: InfluenceTier): number {
  const step = rankOf(INFLUENCE_ORDER, tier); // 0 (unknown) .. 4 (renowned)
  if (def.minInfluence && rankOf(INFLUENCE_ORDER, def.minInfluence) > step) return 0;
  if (def.standingBias === "boon") return def.weight * (1 + 0.5 * step); // up to 3× at renowned
  if (def.standingBias === "bane") return def.weight * Math.max(0.2, 1 - 0.2 * step); // down to 0.2×
  return def.weight;
}

/**
 * The event an event-node runs (M11, D22; standing-weighted D62) — a **deterministic
 * weighted pick** from `streamFor(seed, "event:<nodeId>")`, so each event node has a
 * **stable** event for a seed. The pick is biased by the Noble's standing `tier`
 * ({@link eventWeightAt}): higher standing makes boons likelier, banes rarer, and
 * unlocks premium events — *quality scales with Influence*. (Callers should only ask
 * this of an `event`-kind node; it doesn't check the kind.)
 */
export function eventForNode(seed: string | number, node: MapNode, tier: InfluenceTier = "unknown"): EventDef {
  // An authored expedition can pin a specific event to a node (D52) — honored before
  // the seeded pick so the hand-built event nodes (pick-one camp, Merchant town) run
  // their exact beat. Falls through to the seeded pick if the id is unknown.
  if (node.eventId) {
    const pinned = EVENTS.find((e) => e.id === node.eventId);
    if (pinned) return pinned;
  }
  const rng = streamFor(seed, Labels.event(node.id));
  const pool = EVENTS.filter((e) => eventWeightAt(e, tier) > 0);
  return rng.pickWeighted(pool, (e) => eventWeightAt(e, tier));
}

// --- The interpreter: resolve / choices / choose (D4) -----------------------

/**
 * The **headless** resolution of the current node's event (M11) — applies the
 * event's {@link EventDef.autoResolve} (the deterministic default the auto path
 * uses). Returns the outcome (already applied to `run`).
 */
export function resolveEvent(run: RunState, node: MapNode): EventOutcome {
  return eventForNode(run.seed, node, influenceTier(run.overworld.influence)).autoResolve(run, node);
}

/** An interactive option the render surfaces for an event (M11). */
export interface EventChoice {
  id: string;
  label: string;
  /** Purse cost to take this option (shop/recruiter), if any. */
  cost?: number;
  /** True if the option is takeable right now (affordable / has room). */
  available: boolean;
  /** Hover/detail text. */
  detail?: string;
}

/**
 * The interactive options for the current node's event (M11) — delegated to the
 * event's own {@link EventDef.choices} (a shop lists stock, a recruiter offers
 * Hire/Decline, a story its options). An event without choices (thief/toll) yields
 * none. Pure read — mutates nothing.
 */
export function eventChoices(run: RunState, node: MapNode): EventChoice[] {
  const def = eventForNode(run.seed, node, influenceTier(run.overworld.influence));
  return def.choices?.(run, node) ?? [];
}

/**
 * Apply a chosen event option to the run (M11) — delegated to the event's own
 * {@link EventDef.choose}. An event without a `choose` (thief/toll, no choice) falls
 * back to its {@link EventDef.autoResolve}. Returns the outcome (already applied).
 */
export function chooseEventOption(run: RunState, node: MapNode, choiceId: string): EventOutcome {
  const def = eventForNode(run.seed, node, influenceTier(run.overworld.influence));
  return def.choose?.(run, node, choiceId) ?? def.autoResolve(run, node);
}

// --- Small local helpers ----------------------------------------------------

/** True if storage has room for one more of a material (reuses the cap, D6). */
function canStoreMore(run: RunState, materialId: string): boolean {
  return canAdd(run.inventory, materialId);
}

// --- Authored-event registration (R3, #119) ---------------------------------
// The Hollow Mill authored beats (`provision-choice`, `merchant-town`) live in
// `hollow-mill-events.ts` and register in here at load, in a fixed order, AFTER
// the core `EVENTS` records above — so the seeded pick's registry iteration order
// is unchanged (the authored records are weight-0 and never enter the pool anyway).
for (const def of HOLLOW_MILL_EVENTS) registerEvent(def);
