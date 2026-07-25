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
  | { kind: "keyholder"; tag: ObjectiveTag }
  /** Has durability `hp`: attacking it (a unit within attack range) chips it down; it breaks open at 0. */
  | { kind: "destructible"; hp: number };

/** A placed gate: a tile that blocks while `locked`, opened per its {@link GateLock} conditions. */
export interface Gate {
  id: string;
  pos: GridCoord;
  /** Impassable while true; opening clears its tile's block (see {@link openGateOnGrid}). */
  locked: boolean;
  /** The OR'd conditions any one of which opens it. Empty ⇒ a barred, un-openable gate (scenery). */
  openBy: GateLock[];
  /** Current durability (from a `destructible` condition) — chipped by attacks, breaks at 0. Absent = indestructible. */
  hp?: number;
  /** Starting durability (for the render's HP readout). */
  maxHp?: number;
  /**
   * **Destroyed** (D106): a gate battered to 0 hp is smashed **permanently** — it leaves a passable
   * *remnant* (a marker, never a block) and can no longer be toggled. A lever can seal/unseal an
   * *intact* door all day, but once the guards break it down the breach is permanent — the reseal is
   * gone. Distinct from an *intact-open* gate (a lockpicked/keyholder/lever-opened door, `locked:false`
   * but `broken` falsy), which the lever can still slam shut.
   */
  broken?: boolean;
}

/** Build a gate — locked by default (the interesting state; an authored gate starts shut). */
export function makeGate(id: string, pos: GridCoord, openBy: GateLock[], locked = true): Gate {
  const gate: Gate = { id, pos: { col: pos.col, row: pos.row }, locked, openBy };
  const breakable = openBy.find((c) => c.kind === "destructible");
  if (breakable) { gate.hp = breakable.hp; gate.maxHp = breakable.hp; }
  return gate;
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
 * Can `by` open `gate` **right now with their key** — the living-keyholder Act (D108): the gate is
 * locked, carries a `keyholder` condition whose `tag` matches `by` (the Warden holds these keys), and
 * `by` is adjacent. The **active** counterpart to {@link gatesOpenedByDeath} (same `tag`): *alive*, the
 * keyholder walks up and turns the key (a fast Act, no HP grind); *dead*, the same tag pops the gate.
 * Pure; read by the logged `keyGate` Act so a refusal mutates nothing.
 */
export function canKeyGate(gate: Gate, by: Unit): boolean {
  return (
    gate.locked &&
    gate.openBy.some((c) => c.kind === "keyholder" && matchesTag(by, c.tag)) &&
    adjacent(by.pos, gate.pos)
  );
}

/** Every locked gate `by` could key this instant (adjacent keyholder) — for the scene affordance + the drive. */
export function keyableGates(gates: readonly Gate[], by: Unit): Gate[] {
  return gates.filter((g) => canKeyGate(g, by));
}

/**
 * Is `by` the keyholder of `gate` — a **position-independent** match (locked + a `keyholder` lock whose
 * `tag` matches `by`), *without* the adjacency {@link canKeyGate} requires. The AI drive (M2c) uses this
 * to decide whether a walled-off keyholder should *converge* on a gate (adjacency is then checked at the
 * candidate destination tile, not the unit's current position).
 */
export function keyholderOf(gate: Gate, by: Unit): boolean {
  return gate.locked && gate.openBy.some((c) => c.kind === "keyholder" && matchesTag(by, c.tag));
}

/** Whether `gate` can be broken by attacks — still locked (never a smashed remnant), carries a `destructible` condition + durability. */
export function isBreakable(gate: Gate): boolean {
  return gate.locked && !gate.broken && gate.hp !== undefined && gate.openBy.some((c) => c.kind === "destructible");
}

/** Whether `by` can attack `gate` right now — it's breakable and `by` is within its attack range (any unit; a door isn't lockpick-gated). */
export function canAttackGate(gate: Gate, by: Unit): boolean {
  return isBreakable(gate) && manhattan(by.pos, gate.pos) <= by.attackRange;
}

/** Every breakable gate `by` could hit this instant (in attack range) — for the scene's Break-Gate affordance. */
export function breakableGates(gates: readonly Gate[], by: Unit): Gate[] {
  return gates.filter((g) => canAttackGate(g, by));
}

/** Which gate Act `by` should take on `gate` right now (D108): prefer the **key** (fast) over the **batter** (grind); `undefined` if neither is possible. */
export type GateAct = "key" | "attack";
export function gateActFor(gate: Gate, by: Unit): GateAct | undefined {
  if (canKeyGate(gate, by)) return "key";
  if (canAttackGate(gate, by)) return "attack";
  return undefined;
}

/**
 * Chip `amount` off a breakable gate's durability (the guards battering the door). Returns **true when
 * it breaks** (hp reaches 0) — the caller then opens it via {@link openGateOnGrid}. A no-op (returns
 * false) on an indestructible/open gate or non-positive damage.
 */
export function damageGate(gate: Gate, amount: number): boolean {
  if (!isBreakable(gate) || amount <= 0) return false;
  gate.hp = Math.max(0, (gate.hp ?? 0) - amount);
  return gate.hp === 0;
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

/**
 * **Destroy** a gate (D106) — the terminal state a `destructible` door reaches at 0 hp. Like
 * {@link openGateOnGrid} it unlocks + unblocks the tile, but it also stamps `broken`: the door is a
 * **permanent, passable remnant** now, never to be re-sealed. This is the call the break-loop uses
 * (not `openGateOnGrid`), so a battered-down seal can't be slammed shut again by the lever — the
 * guards' several turns of battering *count*.
 */
export function destroyGateOnGrid(grid: TileGrid, gate: Gate): void {
  gate.broken = true;
  gate.locked = false;
  if (gate.hp !== undefined) gate.hp = 0; // a smashed door reads as spent, whatever brought it here
  grid.setWalkable(gate.pos, true);
}

/**
 * **Re-seal** a gate — the inverse of {@link openGateOnGrid} (the control-room lever slamming a door
 * shut): lock it and re-block its tile. A destructible door **keeps its accumulated damage** (D107):
 * re-sealing does *not* mend it, so the guards' battering *persists* across re-seals and each fresh
 * seal buys less time than the last. (Broken doors are permanent — see {@link destroyGateOnGrid}.)
 */
export function lockGateOnGrid(grid: TileGrid, gate: Gate): void {
  if (gate.broken) return; // a smashed door is a permanent breach — the reseal is gone (D106)
  gate.locked = true;
  grid.setWalkable(gate.pos, false);
}

/**
 * A **lever** (D103) — a pull-switch that **toggles** the locked state of its `targets` gates (the
 * control-room seal: pull it to slam an open door shut, sealing the guards out; pull again to reopen).
 * The remote-trigger `GateLock` shape — a gate opens/closes from a *distance*, not by touching it.
 */
export interface Lever {
  id: string;
  pos: GridCoord;
  /** Ids of the gates this lever toggles when pulled. */
  targets: string[];
}

/** Build a lever wired to the gate ids it toggles. */
export function makeLever(id: string, pos: GridCoord, targets: string[]): Lever {
  return { id, pos: { col: pos.col, row: pos.row }, targets: [...targets] };
}

/** Whether `by` can pull `lever` right now — standing on it or an adjacent step away. */
export function canPullLever(lever: Lever, by: Unit): boolean {
  return manhattan(by.pos, lever.pos) <= 1;
}

/** Every lever `by` could pull this instant — for the scene's Pull-Lever affordance. */
export function pullableLevers(levers: readonly Lever[], by: Unit): Lever[] {
  return levers.filter((l) => canPullLever(l, by));
}
