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
 * the planner treats unknown ids as charge, so it needs no record here.
 *
 * Pure data + lookups: no Phaser, no DOM.
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

/** The registry (D81/D84). New behavior = a new record, never a new planner branch. */
export const STANDING_ORDERS: Record<string, StandingOrderDef> = {
  /** The plain leashed guard (D81) — the L3 straggler's original order. */
  hold: { id: "hold", posture: "hold", leash: 2, stance: "holds its ground" },
  /**
   * The **skittish guard** (D84) — holds its post until the first melee blow
   * lands, then bolts for the map edge. The L3 straggler: his post is the east
   * edge, so one melee hit sends him off-map — the win without the kill.
   */
  "hold-skittish": { id: "hold-skittish", posture: "hold", leash: 2, onMeleeStruck: "flee", stance: "holds its ground" },
  /**
   * The **wary guard** (D84) — holds until a foe presses within `range` of its
   * post, then commits to the charge (sticky; encoded + tested, not yet authored
   * into a node — the L6A captors are the natural takers).
   */
  "hold-wary": { id: "hold-wary", posture: "hold", leash: 2, onFoeWithin: { range: 3, next: "charge" }, stance: "holds its ground" },
  /** Bolting for the nearest map edge (D84) — reach it and the unit is gone. */
  flee: { id: "flee", posture: "flee", stance: "bolting for the map edge!" },
  /** The default planner, as an explicit id (a transition target). */
  charge: { id: "charge", posture: "charge" },
};

/** The unit's standing-order record, or undefined for manual/default behavior. */
export function orderOf(unit: Unit): StandingOrderDef | undefined {
  return unit.standingOrder ? STANDING_ORDERS[unit.standingOrder] : undefined;
}
