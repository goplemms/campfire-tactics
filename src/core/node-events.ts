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
import { marketOpenedFlag, type MapNode } from "./overworld";
import { createUnit, fieldsJob, primaryJobOf, remember, type Unit, type UnitSpec } from "./units";
import { streamFor } from "./rng";
import { Labels } from "./rng-labels";
import { evalPredicate, applyGrantEffect, type Predicate, type GrantEffect } from "./grants";
import { getJob, SCOUT_PRESTIGE_FLOOR } from "./jobs";
import { MATERIALS, grantItem, canAdd } from "./inventory";
import { getEquipment } from "./equipment";
import { addInfluence, influenceTier, type InfluenceTier } from "./economy";
import { merchantBuy, merchantPrice } from "./economy-actions";
import { rollMercenary } from "./guild";
import { recruitClassify, type RecruitOutcome } from "./recruitment";
import { thiefEventSkim } from "./theft";
import { earn, spend } from "./purse-journal";
import { rankOf } from "./num";
import { nudgeMorale } from "./camp";
import { accrueRp } from "./upkeep";

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
function emptyOutcome(kind: EventKind, summary = ""): EventOutcome {
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

// --- Story (an authored-as-data choice, D23) --------------------------------

/** A story option's deterministic outcome spec — **data** (M11, D23). */
export interface StoryOutcomeSpec {
  /** Fixed purse delta (negative = pay, positive = gain). */
  goldDelta?: number;
  /** A *seeded* purse gain rolled in `[min,max]` (instead of a fixed `goldDelta`). */
  goldRoll?: readonly [number, number];
  /** Camp morale delta (D8). */
  moraleDelta?: number;
  /** Party fatigue delta (D35; + tires the party). */
  fatigueDelta?: number;
  /** A small material reward dropped into storage under the cap (D6). */
  material?: string;
  /**
   * Write a **memory** flag on the targeted unit (D65) — the linked-event chain
   * (event A remembers; event B reads it). Requires a unit-targeted choice.
   */
  remember?: string;
  /**
   * Apply a **grant** (D65) to the targeted unit — `addHeldJob` (breadth) or
   * `prestige` (depth). Requires a unit-targeted choice; the offer→accept agency is
   * the choice itself (autoResolve, which targets no unit, never applies it).
   */
  grant?: GrantEffect;
  /** The result line shown after picking this option. */
  summary: string;
}

/** A story option (M11; D65 targeting/gating) — a label + its deterministic outcome. */
export interface StoryChoiceSpec {
  id: string;
  label: string;
  outcome: StoryOutcomeSpec;
  /**
   * If `"unit"`, the option **targets a party member** (D65): it expands to one
   * choice per *eligible* member, the `choiceId` encoding the unit as `id:unitId`.
   * The chosen unit receives the outcome's `remember`/`grant`. Omitted ⇒ a plain
   * party/camp choice (the existing behaviour).
   */
  target?: "unit";
  /**
   * An eligibility {@link "./grants".Predicate} (D65): for a `target:"unit"` choice
   * it gates **which members** qualify (evaluated per member — floor + memory +
   * identity); for a plain choice it gates whether the option is offered at all
   * (any member satisfies). Omitted ⇒ open.
   */
  when?: Predicate;
}

/** An authored story event (M11) — a prompt + a small (2-option) choice set. */
export interface StorySpec {
  id: string;
  prompt: string;
  choices: StoryChoiceSpec[];
}

/**
 * The authored story pool (M11, D23) — **data**, not a story engine. A couple of
 * sample beats prove the pattern: each is a prompt + two options, each option a
 * deterministic outcome. New stories are new records.
 */
export const STORIES: readonly StorySpec[] = [
  {
    id: "wounded-traveler",
    prompt: "A wounded traveler slumped by the roadside begs the caravan for aid.",
    choices: [
      {
        id: "help",
        label: "Tend their wounds",
        outcome: {
          moraleDelta: 2,
          fatigueDelta: 1,
          material: "rune-reagent",
          summary: "You tend the traveler; grateful, they press a pouch of reagent on you. (Morale up; the party tires a little.)",
        },
      },
      {
        id: "pass",
        label: "Press on without stopping",
        outcome: {
          moraleDelta: -1,
          summary: "You leave them to their fate; the caravan's mood sours a little.",
        },
      },
    ],
  },
  {
    id: "abandoned-shrine",
    prompt: "An abandoned wayside shrine stands by the path, its offering bowl long empty.",
    choices: [
      {
        id: "offer",
        label: "Leave an offering",
        outcome: {
          goldDelta: -10,
          moraleDelta: 3,
          summary: "You leave a few coins; the party marches on feeling watched over.",
        },
      },
      {
        id: "loot",
        label: "Pry the shrine for valuables",
        outcome: {
          goldRoll: [15, 40],
          moraleDelta: -2,
          summary: "You strip the shrine of what remains; a cold unease follows the caravan.",
        },
      },
    ],
  },
];

/**
 * D68 — the Scout's prestige-fork triggers, kept OUT of the random {@link STORIES} flavour
 * pool: a prestige offer drawn for an ineligible party collapses to a lone decline, so it
 * shouldn't dilute the flavour draw or the sim. Authored + tested here; the substrate's
 * offer→accept ({@link storyChoices} / {@link applyStoryChoice}) drives them. **Surfacing
 * them in a run** — a deliberate guild node, or an appear-only-when-eligible event — is a
 * curation follow-on.
 */
export const PRESTIGE_OFFERS: readonly StorySpec[] = [
  {
    id: "thieves-guild",
    prompt:
      "In a back-alley tavern a fence marks your Scout's deft hands and slides a guild token across the table: \"We could use someone who moves unseen.\"",
    choices: [
      {
        id: "join",
        label: "Join the thieves' guild",
        target: "unit",
        when: { kind: "jobLevel", job: "scout", min: SCOUT_PRESTIGE_FLOOR },
        outcome: {
          remember: "thieves-guild-invite",
          grant: { kind: "prestige", from: "scout", into: "thief" },
          summary: "Your Scout takes the token — and the trade. They are a Thief now.",
        },
      },
      { id: "decline", label: "Leave the token on the table", outcome: { summary: "You walk out into the night." } },
    ],
  },
  {
    id: "travelling-companion",
    prompt: "A quiet traveller falls into step with the caravan, sharing your Scout's watch through the long nights.",
    choices: [
      {
        id: "walk",
        label: "Share the road",
        target: "unit",
        when: { kind: "jobLevel", job: "scout", min: 1 },
        outcome: {
          remember: "traveled-with-stranger",
          summary: "Few words pass, but an understanding grows between your Scout and the stranger.",
        },
      },
      { id: "wary", label: "Keep your distance", outcome: { summary: "The traveller drifts off at the next fork." } },
    ],
  },
  {
    id: "the-reveal",
    prompt: "By a dying fire, the traveller you walked with sheds the disguise — an assassin, offering to teach what they know.",
    choices: [
      {
        id: "learn",
        label: "Accept the mentorship",
        target: "unit",
        when: {
          kind: "all",
          of: [
            { kind: "remembers", flag: "traveled-with-stranger" },
            { kind: "jobLevel", job: "scout", min: SCOUT_PRESTIGE_FLOOR },
          ],
        },
        outcome: {
          remember: "assassin-mentor",
          grant: { kind: "prestige", from: "scout", into: "assassin" },
          summary: "Your Scout learns the killing arts. They are an Assassin now.",
        },
      },
      { id: "refuse", label: "Refuse the blade", outcome: { summary: "You let the fire burn down in silence." } },
    ],
  },
];

/** Look up a story by id (M11). */
export function getStory(id: string): StorySpec | undefined {
  return STORIES.find((s) => s.id === id);
}

/** The **deterministic** story drawn for an event node (M11) — stable for a seed (D22). */
export function storyForNode(seed: string | number, node: MapNode): StorySpec {
  const rng = streamFor(seed, Labels.eventStory(node.id));
  return rng.pick(STORIES);
}

/**
 * Apply a story option to the run (M11, D23): mutate the purse/morale/fatigue and
 * drop any material reward (under the storage cap, D6). A seeded `goldRoll` rolls
 * deterministically from the node + option (D22). Returns the outcome.
 */
export function applyStoryChoice(run: RunState, node: MapNode, story: StorySpec, choiceId: string): EventOutcome {
  // A unit-targeted choice encodes the member as `id:unitId` (D65); split it off so
  // the base id still finds the StoryChoiceSpec and seeds the deterministic roll.
  const sep = choiceId.indexOf(":");
  const baseId = sep >= 0 ? choiceId.slice(0, sep) : choiceId;
  const targetId = sep >= 0 ? choiceId.slice(sep + 1) : undefined;
  const choice = story.choices.find((c) => c.id === baseId) ?? story.choices[0];
  const spec = choice.outcome;
  const out = emptyOutcome("story", spec.summary);

  let gold = spec.goldDelta ?? 0;
  if (spec.goldRoll) {
    const rng = streamFor(run.seed, Labels.eventStoryChoice(node.id, choice.id));
    gold += rng.range(spec.goldRoll[0], spec.goldRoll[1]);
  }
  if (gold !== 0) {
    // A pay can never drive the purse negative.
    const applied = gold < 0 ? -Math.min(run.camp.gold, -gold) : gold;
    const ctx = { nodeId: run.mapNodeId, night: run.night };
    if (applied > 0) earn(run.camp, applied, "event", "Story payout", ctx);
    else if (applied < 0) spend(run.camp, -applied, "event", "Story cost", ctx);
    out.goldDelta = applied;
  }
  if (spec.moraleDelta) {
    nudgeMorale(run.camp, spec.moraleDelta);
    out.moraleDelta = spec.moraleDelta;
  }
  if (spec.fatigueDelta) {
    for (const u of run.party) u.fatigue += spec.fatigueDelta;
    out.fatigueDelta = spec.fatigueDelta;
  }
  if (spec.material) {
    // The reward always lands (D75); over-cap is resolved by a discard at Break Camp.
    grantItem(run.inventory, spec.material);
    out.materials = [spec.material];
  }
  // D65 — a unit-targeted choice writes memory and/or applies a grant to that member.
  // (autoResolve picks the base id, so it targets no unit and applies neither — the
  // offer→accept agency is the explicit per-unit accept.)
  const target = targetId ? run.party.find((u) => u.id === targetId) : undefined;
  if (target && spec.remember) {
    remember(target, spec.remember);
    out.remembered = spec.remember;
  }
  if (target && spec.grant) {
    const res = applyGrantEffect(spec.grant, target, run);
    if (res.kind === "prestige" && res.ok) {
      out.prestiged = { unitId: target.id, from: res.from, into: res.into };
    }
  }
  return out;
}

/**
 * The interactive options a story surfaces (M11; D65 targeting/gating). A plain
 * choice yields one option (open, or gated by `when` against any member); a
 * `target:"unit"` choice **expands to one option per eligible party member** (gated
 * per member by `when`), the `choiceId` encoding the unit as `id:unitId`. Pure read.
 */
export function storyChoices(run: RunState, node: MapNode, story: StorySpec): EventChoice[] {
  const ctx = { run, node };
  const out: EventChoice[] = [];
  for (const c of story.choices) {
    if (c.target === "unit") {
      for (const u of run.party) {
        if (c.when && !evalPredicate(c.when, u, ctx)) continue;
        out.push({ id: `${c.id}:${u.id}`, label: `${c.label} — ${u.name}`, available: true });
      }
    } else {
      const available = c.when ? run.party.some((u) => evalPredicate(c.when!, u, ctx)) : true;
      out.push({ id: c.id, label: c.label, available });
    }
  }
  return out;
}

// --- The registry + the deterministic per-node pick (D4/D22) ----------------

/**
 * The event registry (M11, D4) — **data**. `eventForNode` weighted-picks among
 * these per event-node. Adding an event is adding a record here.
 */
export const EVENTS: readonly EventDef[] = [
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
  {
    // The Hollow Mill node-2 "A Traveler on the Road" (D52/D79): the **storage-scarcity**
    // beat. No longer a pick-one — a roadside traveler **presses gifts on the party
    // unconditionally** (trap kits + iron weapons), a grant that **always lands over the cap**
    // (D75) onto a full stash, so the player must **discard back to the cap** at Break Camp.
    // The iron weapons are the `iron-weapons` **party-gear** material (D78) — carrying them is
    // the party-wide +attack edge — so the discard is a real trade ("keep the buff or the
    // snares?"). The first **Cook Stew** (RP bank) rides *alongside* the gift when a Cook is
    // aboard. Authored — pinned to the node via `MapNode.eventId`, never seeded (weight 0).
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
  },
  {
    // The Hollow Mill Layer-5 **Market town** (D52): recruit Mira the Merchant (joins
    // the party as a camp body) + open a `basic` market here (Find Trade). The economy
    // hub every road reaches — the Merchant beat is guaranteed. Authored-only.
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
  },
];

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

/** Look up an event def by id (M11). */
export function getEvent(id: string): EventDef {
  const def = EVENTS.find((e) => e.id === id);
  if (!def) throw new Error(`node-events: no event "${id}"`);
  return def;
}

/** Ordered Influence bands, lowest → highest — for the standing-bias step math (D62). */
const INFLUENCE_ORDER: readonly InfluenceTier[] = ["unknown", "known", "respected", "favored", "renowned"];

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

// --- Early events: the arrival layer (D80) ----------------------------------

/**
 * The **early-event** tuning (D80) — a light event on the road *before* a node's main encounter,
 * decoupled from node-kind. **Occasional, never every node** (the D16/D35 anti-agony stance).
 * This first cut draws from the **random, node-agnostic pool** (reusing existing texture events);
 * tailored node-bound events + the gated encounter-bypass are a follow-up.
 */
export const EARLY_EVENT = {
  /** Per-node chance an early event fires on the road (illustrative — the structure is canon). */
  chance: 0.3,
  /**
   * The random pool (D80): auto-resolving texture events reused as arrival-layer beats — the
   * *pickpocket* (thief) and the standing-gated *patron* welcome. Interactive ones (a roadside
   * market trade) and tailored node-bound events extend this later.
   */
  pool: ["thief", "patron-welcome"] as const,
} as const;

/**
 * The **early event** a node hosts on the road (D80), or `null` for the common no-event case — a
 * deterministic, occasional pick from the random pool off `streamFor(seed, "early:<nodeId>")` (a
 * distinct stream from the node-event pick, so the two never collide). Skipped on **event** nodes
 * (they already run an event as their main content) and on **authored/pinned** nodes (their beat
 * stays hand-built). Standing-weighted like the node pick, so a gated boon (patron) only appears
 * once the party's Influence has earned it.
 */
export function earlyEventForNode(run: RunState, node: MapNode): EventDef | null {
  if (node.kind === "event" || node.eventId) return null;
  // A tailored, node-bound event (rare, high-impact) takes precedence over the random pool (D80).
  const tailored = tailoredEarlyEventFor(run, node);
  if (tailored) return tailored;
  const rng = streamFor(run.seed, Labels.early(node.id));
  if (!rng.chance(EARLY_EVENT.chance)) return null; // the common case — a quiet road
  const tier = influenceTier(run.overworld.influence);
  const pool = EARLY_EVENT.pool.map(getEvent).filter((e) => eventWeightAt(e, tier) > 0);
  if (pool.length === 0) return null;
  return rng.pickWeighted(pool, (e) => eventWeightAt(e, tier));
}

/** Resolve an early event (D80) — applies its {@link EventDef.autoResolve} to the run and returns the outcome. */
export function resolveEarlyEvent(run: RunState, node: MapNode, def: EventDef): EventOutcome {
  return def.autoResolve(run, node);
}

// --- Tailored early events + the gated encounter-bypass (D80) ----------------

/** Tailored-event / bypass tuning (D80) — all illustrative, the structure is canon. */
export const BYPASS = {
  /** How rare a tailored event is on an eligible (non-final combat) node. */
  chance: 0.18,
  /** Passage fee = base + layer × perLayer (a deeper blockade demands more). */
  feeBase: 30,
  feePerLayer: 15,
  /** The standing floor to be *offered* passage at all (a stranger gets no parley). */
  floor: "respected" as InfluenceTier,
  /** Bypass EXP per member = base + layer × perLayer — solid, but below a won fight (never strictly better). */
  xpBase: 20,
  xpPerLayer: 5,
} as const;

/** The passage fee to bypass a node's encounter (D80) — scales with map depth. */
export function bypassFee(node: MapNode): number {
  return BYPASS.feeBase + node.layer * BYPASS.feePerLayer;
}

/** The flat EXP each member keeps for bypassing a node's encounter (D80). */
export function bypassXp(node: MapNode): number {
  return BYPASS.xpBase + node.layer * BYPASS.xpPerLayer;
}

/**
 * **The Blockade** (D80) — the first tailored node-bound event: a hostile force bars the road at a
 * combat node. **Cut through** (decline → the encounter proceeds as normal, full loot), or **buy
 * passage** — gated on gold *and* an Influence floor, and **forgoing the loot**: you keep your HP
 * and the EXP but not the plunder (the {@link EventOutcome.bypass} short-circuits the fight). Never
 * strictly better than fighting — a situational call tied to the recovery economy.
 */
export const BLOCKADE: EventDef = {
  id: "blockade",
  kind: "toll", // a pay-to-pass fee — reuses the toll kind rather than minting a new one
  name: "The Blockade",
  teaser: "A blockade bars the road — cut through, or buy passage (gold + standing, but no plunder).",
  weight: 1,
  autoResolve(_run, _node) {
    // Headless / decline default: cut through — the encounter proceeds (no bypass, deterministic).
    return emptyOutcome("toll", "The caravan cut through the blockade.");
  },
  choices(run, node) {
    const fee = bypassFee(node);
    const canAfford = run.camp.gold >= fee;
    const standing = influenceTier(run.overworld.influence);
    const earned = rankOf(INFLUENCE_ORDER, standing) >= rankOf(INFLUENCE_ORDER, BYPASS.floor);
    return [
      {
        id: "pay",
        label: `Buy passage (${fee}g · needs ${BYPASS.floor})`,
        cost: fee,
        available: canAfford && earned,
        detail: !earned
          ? `Your standing isn't enough — needs ${BYPASS.floor}.`
          : !canAfford
            ? `Not enough purse gold (${fee}g).`
            : "Skip the fight: keep your HP and the EXP, but forgo the loot.",
      },
      { id: "fight", label: "Cut through", available: true, detail: "Take the encounter as normal — full loot." },
    ];
  },
  choose(run, node, choiceId) {
    if (choiceId === "pay") {
      const fee = bypassFee(node);
      spend(run.camp, fee, "toll", `Passage @ ${node.id}`, { nodeId: node.id, night: run.night });
      const out = emptyOutcome("toll", `Bought passage for ${fee}g — the fight is skipped, the plunder forgone.`);
      out.goldDelta = -fee;
      out.bypass = true; // the scene short-circuits the encounter (grants the bypass EXP, records the night)
      return out;
    }
    return emptyOutcome("toll", "The caravan cut through the blockade.");
  },
};

/** The tailored events, keyed by eligibility. Currently just {@link BLOCKADE}; authored maps pin more. */
const TAILORED_EVENTS: readonly EventDef[] = [BLOCKADE];

/**
 * The **tailored** early event a node hosts (D80), or `null` — a rare, deterministic pick off
 * `streamFor(seed, "tailored:<nodeId>")` (a distinct stream from both the node-event and the random
 * early-event picks). Only **non-final combat** nodes are eligible: a bypass skips a *fight*, and
 * the final node is the objective (never skippable). High-impact and rare, so it takes precedence
 * over the random pool when it fires.
 */
export function tailoredEarlyEventFor(run: RunState, node: MapNode): EventDef | null {
  if (node.kind !== "combat") return null;
  if (node.layer >= run.map.layers - 1) return null; // the final node is never bypassable
  const rng = streamFor(run.seed, Labels.tailored(node.id));
  if (!rng.chance(BYPASS.chance)) return null;
  return rng.pick(TAILORED_EVENTS);
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

/**
 * A one-line stat blurb for an offered/featured body. Names the unit's **effective**
 * class via {@link primaryJobOf} (D65) — a prestiged unit reads as its evolved job,
 * not its frozen `jobId`. Exported so that standardization is asserted directly
 * (`prestige.test.ts`) rather than only covered by the read-swap.
 */
export function describeUnit(u: Unit): string {
  return `${primaryJobOf(u) ?? "fighter"} · HP ${u.maxHp} · ATK ${u.attack} · SPD ${u.speed}`;
}
