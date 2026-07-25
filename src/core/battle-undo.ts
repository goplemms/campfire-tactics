/**
 * Battle undo substrate (combat-actions Phase 2) — snapshots + checkpoints.
 *
 * Split out of `turn.ts` (R3, #121): the per-unit undoable-state snapshot
 * ({@link snapshotUnit}/{@link restoreUnit} + the {@link UnitSnapshot} field list —
 * **tripwired** by `snapshot-drift.test.ts`, #115/D87) and the whole-battle
 * checkpoint ({@link BattleCheckpoint} + {@link captureCheckpoint}/
 * {@link restoreCheckpoint}). `Battle` keeps the thin `beginUndo`/`undo` wiring and
 * delegates the capture/restore mechanics here. Pure code motion: behaviour unchanged.
 *
 * Pure logic: no Phaser, no DOM.
 */

import { refreshAuras } from "./combat";
import type { Unit, Side } from "./units";
import type { Inventory } from "./inventory";
import type { CTClock, ClockSnapshot } from "./clock";
import type { EntityRegistry, EntitySnapshot } from "./entities";
import type { StatusInstance } from "./status";
import type { UnitId } from "./combat-actions";
import type { Gate } from "./gates";
import type { TileGrid } from "./grid";
import type { GridCoord as Coord } from "./iso";

/**
 * A unit's undoable mutable state (everything a logged action can change).
 * The field list is **tripwired** by `snapshot-drift.test.ts` (#115): a new
 * `Unit` field must be classified there (snapshotted or deliberately not) and,
 * if snapshotted, added to {@link snapshotUnit}/{@link restoreUnit} in step.
 */
export interface UnitSnapshot {
  pos: Coord;
  hp: number;
  ct: number;
  alive: boolean;
  /** The unit's faction — a logged `sway` (D30/D62 bribe) flips it, so undo must restore it. */
  side: Side;
  captured: boolean;
  escaped?: boolean;
  /** The unit's standing order (D84) — a logged strike can transition it (the skittish guard). */
  standingOrder?: string;
  dugIn?: boolean;
  hidden?: boolean;
  concealed?: boolean;
  statuses: StatusInstance[];
  counters: Record<string, number>;
  cooldowns: Record<string, number>;
}

/**
 * A turn-undo checkpoint (combat-actions Phase 2): the battle's mutable state
 * **before** one applied action — enough to roll it back in place. Captures the
 * log length and the RNG draw counter (so re-rolled values re-derive identically),
 * plus the unit / clock / entity state. Restored by value into identity-stable
 * objects, so the render keeps every reference (no re-emission, no re-binding).
 */
export interface BattleCheckpoint {
  logLen: number;
  /** Length of the derived event log (D117) at checkpoint — undo truncates it back to here. */
  eventLogLen: number;
  drawCount: number;
  units: Map<UnitId, UnitSnapshot>;
  clock: ClockSnapshot;
  entities: EntitySnapshot;
  /** Shared-stash counts by value (D63) — so undoing a `placeTrap` refunds its kit. */
  stash?: Record<string, number>;
  /**
   * Gate `locked` + `hp` + `broken` state by id (D103/D106) — so undoing a lockpick Act (or a kill that
   * popped a keyholder cell, a hit on a destructible door, or the blow that *smashed* one) re-locks the
   * gate, restores its durability, clears the destroyed flag, *and* re-blocks its grid tile on restore.
   * Absent when the encounter has no gates (zero cost, like `stash`).
   */
  gates?: Map<string, { locked: boolean; hp?: number; broken?: boolean }>;
}

/** Capture a unit's undoable mutable state by value (tripwired, #115). */
export function snapshotUnit(u: Unit): UnitSnapshot {
  return {
    pos: { col: u.pos.col, row: u.pos.row },
    hp: u.hp,
    ct: u.ct,
    alive: u.alive,
    side: u.side,
    captured: u.captured,
    escaped: u.escaped,
    standingOrder: u.standingOrder,
    dugIn: u.dugIn,
    hidden: u.hidden,
    concealed: u.concealed,
    statuses: u.statuses.map((s) => ({ ...s, data: s.data ? { ...s.data } : undefined })),
    counters: { ...u.counters },
    cooldowns: { ...u.cooldowns },
  };
}

/** Write a unit snapshot back onto the (identity-stable) live unit (tripwired, #115). */
export function restoreUnit(u: Unit, s: UnitSnapshot): void {
  u.pos = { col: s.pos.col, row: s.pos.row };
  u.hp = s.hp;
  u.ct = s.ct;
  u.alive = s.alive;
  u.side = s.side;
  u.captured = s.captured;
  u.escaped = s.escaped;
  u.standingOrder = s.standingOrder;
  u.dugIn = s.dugIn;
  u.hidden = s.hidden;
  u.concealed = s.concealed;
  u.statuses = s.statuses.map((x) => ({ ...x, data: x.data ? { ...x.data } : undefined }));
  u.counters = { ...s.counters };
  u.cooldowns = { ...s.cooldowns };
}

/**
 * Capture the battle's mutable state before an action (a turn-undo checkpoint) —
 * the body of `Battle.captureCheckpoint`, over its explicit inputs. `logLen` and
 * `drawCount` are the caster's private scalars, passed in by the thin method.
 */
export function captureCheckpoint(
  units: readonly Unit[],
  logLen: number,
  eventLogLen: number,
  drawCount: number,
  clock: CTClock,
  entities: EntityRegistry,
  stash?: Inventory,
  gates?: readonly Gate[],
): BattleCheckpoint {
  const snaps = new Map<UnitId, UnitSnapshot>();
  for (const u of units) snaps.set(u.id, snapshotUnit(u));
  return {
    logLen,
    eventLogLen,
    drawCount,
    units: snaps,
    clock: clock.snapshot(),
    entities: entities.snapshot(),
    stash: stash ? { ...stash.counts } : undefined,
    gates: gates && gates.length ? new Map(gates.map((g) => [g.id, { locked: g.locked, hp: g.hp, broken: g.broken }])) : undefined,
  };
}

/**
 * Roll unit / clock / entity / stash state back to a checkpoint (and re-derive the
 * position-dependent tarpit aura) — the body of `Battle.restoreCheckpoint`, over its
 * explicit inputs. The caller (the thin `Battle` method) restores its private draw
 * counter + log length from the checkpoint alongside this.
 */
export function restoreCheckpoint(
  cp: BattleCheckpoint,
  units: Unit[],
  clock: CTClock,
  entities: EntityRegistry,
  stash?: Inventory,
  grid?: TileGrid,
  gates?: Gate[],
): void {
  for (const u of units) {
    const s = cp.units.get(u.id);
    if (s) restoreUnit(u, s);
  }
  clock.restore(cp.clock);
  entities.restore(cp.entities);
  if (cp.stash && stash) stash.counts = { ...cp.stash };
  // Gates: restore each `locked` from the snapshot, then re-derive walkability so a re-locked
  // gate blocks its tile again (and an un-locked one clears). Only when both are wired.
  if (cp.gates && gates && grid) {
    for (const g of gates) {
      const snap = cp.gates.get(g.id);
      if (snap !== undefined) {
        g.locked = snap.locked;
        g.hp = snap.hp;
        g.broken = snap.broken;
        grid.setWalkable(g.pos, !snap.locked); // a broken gate had locked=false → stays passable
      }
    }
  }
  // Positions reverted → re-derive the position-dependent tarpit aura (D40). The
  // restored statuses already match, so this is a confirming no-op in practice.
  refreshAuras(units);
}
