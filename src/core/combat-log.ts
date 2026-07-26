/**
 * The combat **event log** (D117 M2a) — a stored, tick-stamped record of what
 * *happened* in a battle (damage dealt, turn boundaries), distinct from the
 * {@link "./turn".Battle} **command** log (`CombatAction[]`, the *inputs* a
 * {@link "./turn".replay} re-runs).
 *
 * Two consumers, one log:
 *  - **machine queries** — `in-combat`'s {@link exchangedDamageSince} (this file);
 *  - **player-facing display** — a real combat log ("Warden hit Rook for 6"); a later
 *    consumer reads the same entries (extend the union with heal/defeat kinds then).
 *
 * **Replay-safe by construction.** The log is *derived output*, not a replay source:
 * `Battle` populates it from the existing event bus (`unitDamaged`/`turnEnd`), both of
 * which fire only inside `apply` — so a `replay(commandLog)` re-emits them in the same
 * order and the event log reconstructs identically, leaving `replay(commandLog) === state`
 * untouched. Undo truncates it by length like the command log. **IDs, not `Unit` refs**
 * (the D111 command-log discipline): entries carry stable ids so they survive undo/replay.
 *
 * Pure logic: no `Math.random`, no Phaser/DOM.
 */

/** One recorded combat event. Extend the union with heal/defeat kinds when display wants them. */
export type CombatLogEntry =
  | {
      kind: "damage";
      /** Global clock tick when it landed ({@link "./clock".CTClock.time}). */
      time: number;
      /** The unit that took the damage. */
      targetId: string;
      /** The unit that dealt it, if any (sourceless for some field/trap damage). */
      sourceId?: string;
      /** Damage dealt — **may be 0** (a fully-soaked swing still emits `unitDamaged`). */
      amount: number;
    }
  | {
      kind: "turnEnd";
      /** Global clock tick when the turn ended. */
      time: number;
      /** The unit whose turn ended. */
      unitId: string;
    };

/**
 * `in-combat` **clause 1** — did `aId` and `bId` exchange **real** damage (`amount > 0`,
 * either direction) within `aId`'s current engagement window: **since `aId`'s most-recent
 * `turnEnd`** (or battle open, if `aId` has not completed a turn)?
 *
 * The window boundary is `aId`'s last `turnEnd` — the only turn marker that is
 * apply-reachable and therefore replay-safe to record (a `turnStart` fires outside
 * `apply` and would not reconstruct). So the window is `(aId's last turnEnd, now]`:
 * `aId` is engaged by **receiving** (or dealing, this window) real damage from `bId`
 * since it last finished a turn — a self-clearing, Speed-anchored window (R2: a faster
 * unit's turns are closer in ticks, so it drops out sooner). A 0-damage swing does **not**
 * engage (the command log couldn't tell a hit from a whiff — this is why the *event* log,
 * with `amount`, is the right substrate).
 *
 * O(window): scans back only to `aId`'s last `turnEnd`, not the whole battle.
 */
export function exchangedDamageSince(
  log: readonly CombatLogEntry[],
  aId: string,
  bId: string,
): boolean {
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.kind === "turnEnd") {
      if (e.unitId === aId) return false; // reached aId's last completed turn — window exhausted
      continue;
    }
    // e.kind === "damage"
    if (e.amount <= 0) continue; // a whiff is not an exchange
    if (
      (e.sourceId === aId && e.targetId === bId) ||
      (e.sourceId === bId && e.targetId === aId)
    ) {
      return true;
    }
  }
  return false; // no aId turnEnd found (aId's first turn): scanned to battle open, no exchange
}
