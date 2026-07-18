/**
 * Interactable **gates** (D103) — the prison-break substrate.
 *
 * A gate occupies a tile and, while **locked**, is impassable: it physically encloses whatever it
 * shuts in (a cell's prisoner, who can't leave until it opens) *and* shuts out (a control-room door
 * that seals the guards on the far side). It is the *lock itself* — not a flag on the unit behind it —
 * so freeing a prisoner becomes "open the gate," and **how** you open it is **data**: an `openBy` list
 * of {@link GateLock} conditions, any one of which frees it. New ways to open a cell are new
 * records, not new branches (the D4 field-entity ethos, same as skills/objectives/events).
 *
 * This module is the **pure** core: the types + the open interpreters + the grid-walkability interplay.
 * No Phaser, no DOM, no `Math.random`. Staging arms gates onto a battle, the scene renders + drives the
 * interact Act, and the editor paints them — all on top of these primitives.
 *
 * Ships two conditions (the D103 first cut):
 *  - **lockpick** — an *adjacent* unit holding the Expert Lockpick capability (the Thief) spends an Act.
 *    Reuses the exact capability gate the captive rescue used (`unitHasCapability(by, "lockpick")`).
 *  - **keyholder** — the gate opens **automatically** when a unit matching `tag` is defeated ("the
 *    Captain holds the keys"). Event-driven, tag-bound like an objective — a different *shape* of open
 *    from the Act, which is the point: it proves the interpreter handles both.
 *
 * Seam-ready (not built): `lever` (a remote switch tile), `key` (a carried item), `destructible`
 * (bash it down) — each a new `GateLock` member + a case here, nothing else structural.
 */

import type { GridCoord } from "./iso";
import { manhattan } from "./combat";
import type { Unit } from "./units";
import { unitHasCapability } from "./jobs";
import { matchesTag, type ObjectiveTag } from "./objectives";
import type { TileGrid } from "./grid";

/**
 * One way a gate can be opened (D103). Any satisfied condition on a gate frees it (the list is OR'd),
 * so a cell that yields to *either* a lockpick *or* the Captain's keys carries both.
 */
export type GateLock =
  /** An adjacent Expert-Lockpick unit (the Thief) spends an Act to pick it. */
  | { kind: "lockpick" }
  /** Opens the instant a unit matching `tag` (a role or explicit id) is defeated — the keyholder drops the keys. */
  | { kind: "keyholder"; tag: ObjectiveTag };

/** A placed gate: a tile that blocks while `locked`, opened per its {@link GateLock} conditions. */
export interface Gate {
  id: string;
  pos: GridCoord;
  /** Impassable while true; opening clears its tile's block (see {@link openGateOnGrid}). */
  locked: boolean;
  /** The OR'd conditions any one of which opens it. Empty ⇒ a barred, un-openable gate (scenery). */
  openBy: GateLock[];
}

/** Build a gate — locked by default (the interesting state; an authored gate starts shut). */
export function makeGate(id: string, pos: GridCoord, openBy: GateLock[], locked = true): Gate {
  return { id, pos: { col: pos.col, row: pos.row }, locked, openBy };
}

/** Open a gate (idempotent) — the pure state change; grid unblocking is {@link openGateOnGrid}. */
export function openGate(gate: Gate): void {
  gate.locked = false;
}

/** Two tiles are orthogonally adjacent (a step apart) — the interact-range test. */
function adjacent(a: GridCoord, b: GridCoord): boolean {
  return manhattan(a, b) === 1;
}

/**
 * Can `by` open `gate` **right now by lockpicking** — the gate is locked, carries a `lockpick`
 * condition, and `by` is an adjacent Expert-Lockpick holder. Pure + capability-gated (never a jobId,
 * D54/D72), read by the logged interact Act so a refusal mutates nothing.
 */
export function canLockpickGate(gate: Gate, by: Unit): boolean {
  return (
    gate.locked &&
    gate.openBy.some((c) => c.kind === "lockpick") &&
    unitHasCapability(by, "lockpick") &&
    adjacent(by.pos, gate.pos)
  );
}

/** Every locked gate `by` could lockpick this instant (adjacent + capable) — for the scene's interact affordance. */
export function lockpickableGates(gates: readonly Gate[], by: Unit): Gate[] {
  return gates.filter((g) => canLockpickGate(g, by));
}

/**
 * The locked gates a `dead` unit's defeat opens — every locked gate with a `keyholder` condition
 * whose `tag` matches the fallen unit (the Captain drops the keys). Returned, not mutated, so the
 * caller opens them through {@link openGateOnGrid} and can log/animate each.
 */
export function gatesOpenedByDeath(gates: readonly Gate[], dead: Unit): Gate[] {
  return gates.filter(
    (g) => g.locked && g.openBy.some((c) => c.kind === "keyholder" && matchesTag(dead, c.tag)),
  );
}

/**
 * Stamp the gates' locked-state onto a freshly built grid: every **locked** gate blocks its tile, so
 * pathing/reach treat it as a wall. Call once at battle assembly, after the grid is built from the
 * authored `blocked` set. (An already-open gate leaves its tile as-is — it's just a doorway.)
 */
export function applyGatesToGrid(grid: TileGrid, gates: readonly Gate[]): void {
  for (const g of gates) if (g.locked) grid.setWalkable(g.pos, false);
}

/** Open a gate **and** clear its tile's block on the grid — the one call the loop uses to spring a gate. */
export function openGateOnGrid(grid: TileGrid, gate: Gate): void {
  openGate(gate);
  grid.setWalkable(gate.pos, true);
}
