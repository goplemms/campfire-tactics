/**
 * Standing orders (D81/D84) — the data registry of **unit behaviors when not
 * player-driven**.
 *
 * An order is a record, not a planner branch (D4 ethos): a **posture** (how the
 * unit plans its turns — {@link "./ai".planEnemyTurn} dispatches on it) plus
 * optional **transition rules** — events that rewrite `unit.standingOrder` to
 * another order, one-way. Transitions live in the core turn/apply path, so
 * headless play, replay, and undo reproduce them identically:
 *
 * - {@link StandingOrderDef.onMeleeStruck} fires inside the attack resolution
 *   (an adjacent blow landing) — the skittish guard's "run after the first
 *   melee hit".
 * - {@link StandingOrderDef.onFoeWithin} fires at the unit's turn-open from
 *   board state, and is **sticky** — once provoked, provoked (no bait-and-retreat
 *   reset). It shapes only future *plans* (which are logged as concrete actions),
 *   so replay needs no record of it.
 *
 * Postures:
 * - **hold** — the leashed guard (D81): acts only within `leash` of its
 *   {@link "./units".Unit.post}, walks back when displaced, never charges.
 * - **flee** — bolt for the nearest map edge (D84): never attacks; a fleeing
 *   unit that reaches an edge tile **escapes off-map** on its turn (a logged
 *   `escape` action) — gone from the field, excluded from every active check,
 *   so a lone fleeing survivor's exit **ends the encounter as a player win**.
 * - **charge** — the default planner (what an unordered unit does).
 *
 * The player-side `"defend"` (D41) is a reserved auto-action, not an AI posture —
 * the planner treats unknown ids as charge, so it needs no record here. It **is**
 * authorable, though ({@link PLAYER_AUTO_ORDERS}), so the vocabulary a content
 * validator refuses against is the **union** of the two — see
 * {@link standingOrderIds}.
 *
 * ## Two order namespaces exist; do not conflate them (the `run-flags.ts` shape)
 *  - **{@link STANDING_ORDERS}** — the AI dispatch table. `planEnemyTurn` reads
 *    `orderOf(unit)?.posture`; the turn loop reads `onMeleeStruck`/`onFoeWithin`.
 *    An id here *changes how a unit plays*.
 *  - **{@link PLAYER_AUTO_ORDERS}** — reserved *player-side* auto-actions (D41
 *    `defend`). Nothing dispatches on them yet (the auto-execution turn-loop is a
 *    later pass), but shipped content authors them on captives and recruits, so
 *    they are part of the authorable vocabulary.
 *
 * ## Why the vocabulary is enumerable at all (D122 / #216)
 * `Unit.standingOrder` is a bare `string`, and `orderOf` is a plain lookup: a typo
 * misses the registry and the unit **silently falls back to the default planner** —
 * a leashed guard that charges, a skittish guard that never bolts. While the
 * encounter is TypeScript nothing catches that either (the field is `string`, not a
 * union); once the body is JSON there is no compiler at all. So this module is the
 * authoritative list a content validator can refuse against — the same fix
 * `run-flags.ts` is for the `run.flags` bag and `EQUIPMENT` ids were for the
 * equip surface.
 *
 * **Deliberately NOT wired into the planner.** `orderOf` keeps returning
 * `undefined` on an unknown id rather than throwing: it runs inside every enemy
 * turn plan, replay, and undo restore, and repro dumps legitimately carry orders
 * written by an older build. Refuse at the **authoring boundary**
 * ({@link isKnownStandingOrder}, read by `validateLevel`), not in the engine —
 * exactly the line `run-flags.ts` draws for `stageEncounter`.
 *
 * Pure data + lookups: no Phaser, no DOM, no `Math.random`.
 */

import type { Unit } from "./units";

/** How an ordered unit plans its turns. */
export type OrderPosture = "hold" | "flee" | "charge";

/** One standing-order record — a posture plus its transition rules (D84). */
export interface StandingOrderDef {
  id: string;
  posture: OrderPosture;
  /** Hold only: how far from the post the unit strays to act (default {@link "./ai".AI.holdLeash}). */
  leash?: number;
  /** A **melee** blow landing on this unit rewrites its order to this id (the skittish guard). */
  onMeleeStruck?: string;
  /** An active foe within `range` of the unit's POST at its turn-open rewrites its order (sticky). */
  onFoeWithin?: { range: number; next: string };
  /** The hover-card stance line — telegraph the *intent*, never the trigger. */
  stance?: string;
}

/** The AI orders (D81/D84). New behavior = a new record, never a new planner branch. */
const ORDERS: StandingOrderDef[] = [
  /** The plain leashed guard (D81) — the L3 straggler's original order. */
  { id: "hold", posture: "hold", leash: 2, stance: "holds its ground" },
  /**
   * The **skittish guard** (D84) — holds its post until the first melee blow
   * lands, then bolts for the map edge. The L3 straggler: his post is the east
   * edge, so one melee hit sends him off-map — the win without the kill.
   */
  { id: "hold-skittish", posture: "hold", leash: 2, onMeleeStruck: "flee", stance: "holds its ground" },
  /**
   * The **wary guard** (D84) — holds until a foe presses within `range` of its
   * post, then commits to the charge (sticky; encoded + tested, not yet authored
   * into a node — the L6A captors are the natural takers).
   */
  { id: "hold-wary", posture: "hold", leash: 2, onFoeWithin: { range: 3, next: "charge" }, stance: "holds its ground" },
  /** Bolting for the nearest map edge (D84) — reach it and the unit is gone. */
  { id: "flee", posture: "flee", stance: "bolting for the map edge!" },
  /** The default planner, as an explicit id (a transition target). */
  { id: "charge", posture: "charge" },
];

/**
 * Build a registry keyed off each record's own `.id` (D114 — never a hand-duplicated
 * literal). Fails loud at load on a duplicate or empty id. Copied from
 * `run-flags.ts`'s {@link "./run-flags".registerRunFlags}, including the trick below.
 */
export function registerStandingOrders<T extends { id: string }>(defs: readonly T[], what: string): Record<string, T> {
  // **Null prototype, deliberately.** A standing order is arbitrary authored input, and on a
  // normal object `"toString" in obj` is `true` while `obj["toString"]` hands back
  // `Object.prototype.toString` *typed as a def* — so a lookup miss reads as a hit and a
  // validator would wave through an order that does not exist (and `orderOf` would hand the
  // planner a function where it expects a record). A prototype-less map has no inherited keys.
  const out: Record<string, T> = Object.create(null);
  for (const def of defs) {
    if (!def.id) throw new Error(`${what}: a record has an empty id`);
    if (out[def.id]) throw new Error(`${what}: duplicate id "${def.id}"`);
    out[def.id] = def;
  }
  return out;
}

/** The AI-order registry by id (D81/D84) — what {@link orderOf} dispatches through. */
export const STANDING_ORDERS: Record<string, StandingOrderDef> = registerStandingOrders(ORDERS, "STANDING_ORDERS");

/**
 * One **reserved player-side auto-action** (D41) — a D114 registry record, keyed off its own
 * `.id`. Deliberately a *different* record type from {@link StandingOrderDef}: it has no
 * posture and no transitions, because nothing plans a turn from it. It exists so the
 * authorable vocabulary is enumerable, not so the planner grows a branch.
 */
export interface PlayerAutoOrderDef {
  /** The literal value authored into `UnitSpec.standingOrder`. */
  id: string;
  /** Short label for a picker row. */
  label: string;
  /** What it will mean once the auto-execution turn-loop lands, and what it means today. */
  description: string;
}

/**
 * The reserved player-side orders content may author.
 *
 * `defend` is the D41 universal brace (`DEFEND.id` in `jobs-data/support.ts`). The id is a
 * **literal on purpose**, the same call `run-flags.ts` makes: importing the `SkillDef` here
 * would drag `jobs-data` into every module that touches an order, for one string. It is pinned
 * against `DEFEND.id` in `standing-orders.test.ts` instead, so the two cannot drift.
 *
 * ⚠️ **Authored today, dispatched by nothing.** Pip the Cook, the Cuffed Cell's prisoner, the
 * finale's two cell prisoners and Mira all carry `standingOrder: "defend"` — five shipped specs.
 * `orderOf` returns `undefined` for every one of them (they are player-side, so no planner runs
 * on them anyway). The field is a **standing intent** waiting on the auto-execution turn-loop.
 * That is why refusing it would be wrong and why it must be in the vocabulary.
 */
export const PLAYER_AUTO_ORDERS: Record<string, PlayerAutoOrderDef> = registerStandingOrders(
  [
    {
      id: "defend",
      label: "Defend",
      description:
        "Brace instead of acting when not player-driven (D41's universal Defend). Reserved: the auto-execution turn-loop is a later pass, so nothing reads it yet — it is authored intent on captives and recruits.",
    },
  ],
  "PLAYER_AUTO_ORDERS",
);

/** Look up an AI standing order by id; `undefined` on a miss (D114 registry shape). */
export function getStandingOrder(id: string): StandingOrderDef | undefined {
  return STANDING_ORDERS[id];
}

/**
 * **Every standing order authored content may set** — the AI ids *plus* the reserved
 * player-side ones, in registry order. This union, not `Object.keys(STANDING_ORDERS)`, is the
 * authoring vocabulary: `defend` is legitimate on a captive and is not an AI posture.
 */
export function standingOrderIds(): string[] {
  return [...Object.keys(STANDING_ORDERS), ...Object.keys(PLAYER_AUTO_ORDERS)];
}

/** Whether `id` is a standing order authored content may set (either namespace). */
export function isKnownStandingOrder(id: string): boolean {
  return id in STANDING_ORDERS || id in PLAYER_AUTO_ORDERS;
}

/** The unit's standing-order record, or undefined for manual/default behavior. */
export function orderOf(unit: Unit): StandingOrderDef | undefined {
  return unit.standingOrder ? getStandingOrder(unit.standingOrder) : undefined;
}
