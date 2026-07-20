/**
 * The **one cost grammar** (#113) — the unified shape every priced/paced verb declares.
 *
 * R4's grammar fold: combat and the overworld had two separate cost shapes — combat's
 * {@link "./skills".SkillCost} (`charge`/`cooldown`, denominated in the **CT clock**) and
 * the overworld's {@link "./overworld-cost".OverworldCost} (`cooldown`/`usesPerNode` pacing ×
 * a `fatigue`/`gold`/`influence`/`rp` price map, denominated in **node-steps**). This module
 * unifies them into one {@link Cost} type carrying a **clock-domain tag** ({@link ClockDomain}):
 * pacing is denominated in the surface's clock, price is a shared resource map. The two former
 * types become **structural views** of it (`SkillCost` = the CT view, `OverworldCost` = the
 * node-steps view) — flat, so every existing literal still type-checks with no change.
 *
 * This is a **type-only** module (no runtime exports): the grammar is a compile-time contract,
 * and the runtime gate/validator keep living in {@link "./overworld-cost"} (the D88 invariant
 * runs unchanged over the one home).
 *
 * Pure types: no Phaser, no DOM, no runtime.
 */

import type { CostKnob } from "./overworld-cost";

/**
 * The **clock** a cost's *pacing* is denominated in (#113): combat prices time on the **CT
 * clock** (`"ct"` — `charge` gauges, `cooldown` in CT), the overworld on **node-steps**
 * (`"node-steps"` — `cooldown` in node-steps, `usesPerNode` per-node caps). The tag names
 * which pacing knobs a surface reads; it is type-level today (no runtime field is required),
 * so it changes no behavior.
 */
export type ClockDomain = "ct" | "node-steps";

/**
 * A **carried material** consumed per cast (#113 material price) — the trap kit a Set Trap
 * spends, the herb the Medic's Heal burns. `count` is how many; `id` names the material when
 * it is fixed on the skill (the trap kit), and is **omitted** when the specific item is chosen
 * at cast time (the Medic picks salve/stimulant/antidote — the runtime herbId supplies it).
 * The declared price is read as **data** by the availability projection ({@link
 * "./inventory".canAffordMaterial} — grey out at 0 carried) and consumed in the commit half of
 * the apply path (never the resolver, #113).
 */
export interface MaterialCost {
  /** The material id, when fixed on the skill; omitted when the caster chooses it at cast time. */
  id?: string;
  /** How many are consumed per cast. */
  count: number;
}

/**
 * The **price map** (axis B) of the one cost grammar (#113) — the per-cast resources an
 * action spends, shared across surfaces. Every field is optional; an action may be
 * pure-pacing (no price). A {@link "./overworld-cost".CostKnob} provider prices dynamically
 * (Cook Stew at *the night's food value*), resolved once at check time (#126).
 */
export interface CostPrice {
  /** Fatigue spent on the acting character — the loose over-extension guardrail (D35/D73). */
  fatigue?: number;
  /** Run gold spent from the purse (`camp.purse`, D34/D30) — static, or a {@link "./overworld-cost".CostKnob} provider. */
  gold?: CostKnob;
  /**
   * Influence spent — the Noble's walled-off currency (D62; run-scoped). Static or a provider.
   * **Reserved (no verb prices in it yet):** the overworld gate fully checks + spends it, kept for
   * the planned **Influence revamp** (routing Bribe's spend through the shared gate). Declared-but-
   * unused **on purpose**, not dead.
   */
  influence?: CostKnob;
  /**
   * Rest Points spent. Static or a provider. **Reserved (no verb prices in it yet):** the overworld
   * gate honors it for a future RP-priced clearing verb (RP is live — banked nightly, spent on
   * healing). Declared-but-unused on purpose.
   */
  rp?: CostKnob;
  /**
   * A **carried material** consumed per cast (#113): the trap kit (Set Trap) and the Medic's
   * herb (Heal) declare it here and consume it in the commit half of the apply path — the
   * resolver-side `removeItem` is gone (the undo checkpoint's stash snapshot covers refunds).
   */
  material?: MaterialCost;
}

/**
 * The **one cost grammar** (#113) — pacing denominated in the surface's `clock` plus the shared
 * {@link CostPrice} map. The pacing knobs vary by clock: `charge` (CT-only) and `cooldown` (CT)
 * for combat; `cooldown` (node-steps) and `usesPerNode` for the overworld. {@link
 * "./skills".SkillCost} and {@link "./overworld-cost".OverworldCost} are structural views of this
 * — see each for the fields its surface reads.
 */
export interface Cost extends CostPrice {
  /** The clock this cost's pacing is denominated in (type-level tag; no runtime read today). */
  clock?: ClockDomain;
  /**
   * **Pacing (CT):** charge gauge speed (D5/D37) — the effect resolves later, when a
   * {@link "./clock".ScheduledEffect} filling by this each tick reaches 100. Lower = a
   * longer charge ("~N turns"); ≥100 lands next tick. Combat-only (a CT-clock mechanic).
   */
  charge?: number;
  /**
   * **Pacing (both clocks):** cooldown before the action can fire again — **CT** for a combat
   * skill (an instant-utility spam-limit, ~150–250 CT), **node-steps** for an overworld verb
   * (the D35 spine).
   */
  cooldown?: number;
  /**
   * **Pacing (node-steps):** per-node use cap (reset each node-step) — the limiter for a costless
   * signature overworld action (Cook Stew). Undefined ⇒ uncapped (paid its own way each cast).
   */
  usesPerNode?: number;
  /**
   * **Escape hatch (overworld):** true when the action is bounded by a finite **consumable**
   * rather than a pacing/price knob (the Merchant's *sell* — you can only sell what you carry),
   * so it satisfies the D61 no-free-and-unlimited invariant without a synthetic cooldown.
   */
  selfLimited?: boolean;
}
