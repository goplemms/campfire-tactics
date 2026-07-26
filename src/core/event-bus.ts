/**
 * The battle trigger/event bus (D4).
 *
 * The combat loop announces moments; listeners react. This is the architectural
 * seam built **before any field entity exists** (D4): traps, nests, runes, nest
 * auras, opportunity attacks and Cook buffs are all later just listeners, never
 * special cases in the loop. M3 may have zero or one listener — the shape is the
 * point.
 *
 * Pure logic: no Phaser, no DOM.
 */

import type { Unit } from "./units";
import type { GridCoord } from "./iso";
import type { Gate } from "./gates";

/**
 * The typed event catalogue. Each key names an event; its value is the payload
 * shape delivered to listeners.
 */
export interface BattleEvents {
  turnStart: { unit: Unit };
  turnEnd: { unit: Unit };
  /** A unit entered a tile. `forced` marks a push/pull entry (D19). */
  unitEnterTile: { unit: Unit; tile: GridCoord; forced?: boolean };
  unitLeaveTile: { unit: Unit; tile: GridCoord };
  unitDamaged: { unit: Unit; amount: number; source?: Unit };
  unitHealed: { unit: Unit; amount: number; source?: Unit };
  unitDefeated: { unit: Unit; source?: Unit };
  /**
   * A bound unit was **freed by the rescue Act** mid-combat (D52) — a captured ally, or a
   * new on-board **captive recruit** (the L1 Cook) joining the party. `by` is the rescuer.
   * The render reacts (combat-log line + FX); telemetry/intel-reveal/ghost-token effects can
   * hook the same moment. The post-win auto-free ("freed by winning the field") is a separate
   * resolution tally (`res.rescued`), not this live event.
   */
  unitRescued: { unit: Unit; by?: Unit };
  /**
   * An enemy was **swayed to the player's side** mid-combat (D30/D62 bribe) — the Noble's
   * turn-coat. `unit` is the defector (now `side: "player"`), `by` the briber. The render
   * reacts by re-tinting the token to the ally palette (a listener, like `unitRescued`),
   * rather than the call site flipping `side` behind the type system.
   */
  unitSwayed: { unit: Unit; by?: Unit };
  /**
   * A fleeing unit reached a map edge and **left the field** (D84) — gone, not
   * dead (no defeat event, no kill credit). The render removes its token + logs
   * the exit; the win check reads the vacancy through {@link "./units".isActive}.
   */
  unitEscaped: { unit: Unit };
  /**
   * A unit's **standing order changed** (D84) — a transition rule fired (the
   * skittish guard breaking into flight, the wary guard provoked into the
   * charge). The render updates the stance telegraph + logs the turn of mood.
   */
  orderChanged: { unit: Unit; order: string };
  /** A scheduled/charged effect resolved on the timeline (D5/D16). */
  chargeResolved: { id: string };
  /** A scheduled/charged effect was cancelled before it resolved (D37 fizzle). */
  chargeFizzled: { id: string };
  /** A placed trap/snare sprang on a unit (D4/D13) — the render updates its marker. */
  trapSprung: { id: string; tile: GridCoord; unit: Unit };
  /**
   * An interactable **gate opened** (D103) — a cell/door unlocked. `cause` distinguishes a Thief's
   * lockpick Act, the automatic keyholder open when a tagged unit was defeated (`by` undefined), and a
   * `destroyed` door battered to 0 HP (`by` = the last attacker). The render lifts the bars, clears the
   * marker, logs it.
   */
  gateOpened: { gate: Gate; by?: Unit; cause: "lockpick" | "keyholder" | "destroyed" | "lever" };
  /**
   * A **destructible gate took a hit** (D103) but hasn't broken yet — `amount` off its durability,
   * `by` the attacker. The render flashes the door, refreshes its HP readout, and logs the shudder.
   */
  gateDamaged: { gate: Gate; by?: Unit; amount: number };
  /**
   * A gate was **locked shut** by a lever (D103) — the control-room seal slamming a door closed. The
   * render re-blocks the tile (redraws the grid), re-marks the gate, and logs the slam. `by` = the puller.
   */
  gateLocked: { gate: Gate; by?: Unit };
  /**
   * A fallen keyholder **dropped a key** (D117/M5) — a `dropOnDeath` gate's keys hit the board at `tile`
   * instead of the gate auto-opening. The render draws the key glyph; a player fetches it. `gates` = the
   * gate ids it turns.
   */
  keyDropped: { key: string; tile: GridCoord; gates: string[] };
  /**
   * A player unit **picked up a dropped key** (D117/M5) — `unit.carriedKey` now holds `gates`. The render
   * clears the board glyph, badges the carrier, and logs the pocket.
   */
  keyPickedUp: { unit: Unit; key: string; gates: string[] };
  /**
   * The deployment phase ended and combat begins (D67 clock fold) — the transition
   * seam. The render reacts by tearing down the staging visuals (the D12 veil, the
   * zone/reach overlays); future "opening of battle" effects can hook the same moment
   * instead of editing the scene's `startBattle`. Fired once, on the deploy→battle handoff.
   */
  battleBegan: Record<string, never>;
  /**
   * The enemy **front** (the deployment tempo source) was handed its turn on the CT clock
   * (D67 W3) — its net-closing "action." The capture-wave listener reacts: advance the net
   * one step, roll capture for the unprotected, and trip the alarm on a catch. Modeling the
   * front's turn as a bus event (rather than a hardcoded branch in the deploy loop) makes it
   * a real **slot on the clock** — other "as the net closes" effects can hook the same
   * moment. Live-phase only: replay reconstructs captures from the logged `capture` actions,
   * so it never re-fires this.
   */
  frontTurn: Record<string, never>;
}

/** All valid event names. */
export type BattleEventType = keyof BattleEvents;

/** A listener for a particular event payload. */
export type Handler<T> = (payload: T) => void;

/**
 * A minimal typed pub/sub bus. `on` returns an unsubscribe function. Handlers
 * for one event fire in subscription order; a throwing handler does not stop the
 * others (errors are isolated so one bad listener can't break the loop).
 */
export class EventBus {
  // Stored loosely (handlers keyed by event name); the public on/emit signatures
  // restore full type-safety at the boundary. The internal cast is the standard
  // workaround for indexing a mapped type by a generic key.
  private readonly handlers = new Map<BattleEventType, Set<Handler<never>>>();

  /** Subscribe to an event. Returns a function that unsubscribes. */
  on<K extends BattleEventType>(
    type: K,
    handler: Handler<BattleEvents[K]>,
  ): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler<never>);
    return () => {
      this.handlers.get(type)?.delete(handler as Handler<never>);
    };
  }

  /** Emit an event to all current subscribers. */
  emit<K extends BattleEventType>(type: K, payload: BattleEvents[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    // Snapshot so a handler that (un)subscribes mid-emit doesn't disturb us.
    for (const handler of [...set] as Handler<BattleEvents[K]>[]) {
      try {
        handler(payload);
      } catch (err) {
        // Isolate listener faults — one bad entity can't break the battle loop.
        console.error(`bus handler for "${type}" threw`, err);
      }
    }
  }

  /** Number of listeners on an event (handy for tests). */
  listenerCount(type: BattleEventType): number {
    return this.handlers.get(type)?.size ?? 0;
  }

  /** Drop all listeners. */
  clear(): void {
    this.handlers.clear();
  }
}
