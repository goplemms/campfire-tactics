/**
 * Story events (M11, D23/D65) — the authored-as-data choice sub-engine.
 *
 * Split out of `node-events.ts` (R3, #119): the `story` {@link "./node-events".EventDef}
 * record still lives in the event registry, but its **content + resolvers** live here —
 * the story types, the authored {@link STORIES} pool, the D68 {@link PRESTIGE_OFFERS}
 * fork triggers, and the offer→accept substrate ({@link storyChoices} /
 * {@link applyStoryChoice}). Pure code motion: behaviour unchanged.
 *
 * A story is a prompt + a small (2-option) choice set; each option applies a
 * **deterministic** outcome (gold/morale/fatigue/material) and, for a
 * `target:"unit"` choice, a D65 memory/grant on the chosen member. **New stories
 * are new records**, not new branches (D4).
 *
 * Pure logic: no Phaser, no DOM.
 */

import type { RunState } from "./run";
import type { MapNode } from "./overworld";
import { streamFor } from "./rng";
import { Labels } from "./rng-labels";
import { evalPredicate, applyGrantEffect, type Predicate, type GrantEffect } from "./grants";
import { SCOUT_PRESTIGE_FLOOR } from "./jobs";
import { grantItem } from "./inventory";
import { earn, spend } from "./purse-journal";
import { nudgeMorale } from "./camp";
import { remember } from "./units";
import { emptyOutcome, type EventOutcome, type EventChoice } from "./node-events";

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
