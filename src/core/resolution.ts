/**
 * Resolution — closing a battle and feeding the next phase (D13).
 *
 * M5b lands the **material-recovery** half: recovery is **outcome-gated and
 * whole-field** — a **win** controls the entire battlefield, so every **unsprung,
 * recoverable** field entity (yours *and* the enemy's salvage) returns to storage;
 * **flee/lose → nothing**. Captures and rewards are sketched here as a seam for
 * M6's full run loop.
 *
 * **The snare sweep (D82).** Concealed enemy traps are `recoverable: false` (D54),
 * but a win *sweeps* them anyway — hidden or spotted alike — **provided a
 * trap-trained party member is still standing** ({@link canDisarm}, active): the
 * winning field is walked and cleared off-screen, so the player never roots around
 * a decided map to cash the kits. No sweeper aboard (downed, captured, or never
 * fielded) → the snares stay in the dirt. Sprung is always spent.
 *
 * Pure logic: no Phaser, no DOM.
 */

import type { FieldEntity } from "./entities";
import { isRecoverable, isConcealedTrap } from "./entities";
import type { Inventory } from "./inventory";
import { grantItem } from "./inventory";
import { isActive, type Side, type Unit } from "./units";
import { canDisarm } from "./traps";

/** What Resolution reclaimed. */
export interface RecoveryResult {
  /** Material ids returned to storage, one entry per recovered entity. */
  recovered: string[];
  /** How many of those were **swept enemy snares** (D82) — the telemetry slice. */
  swept: number;
}

/**
 * Recover unsprung, recoverable field entities into the inventory **on a win**
 * (D13). Sprung entities, consumed materials, and any non-win outcome recover
 * nothing. Recovered materials are added back to storage (cap permitting).
 *
 * Pass the player `party` to enable the **snare sweep** (D82): with an active
 * trap-trained member among them, unsprung concealed **enemy** traps are swept to
 * storage too — spotted or not — overriding their static `recoverable: false`.
 */
export function recoverMaterials(
  entities: readonly FieldEntity[],
  winner: Side | undefined,
  inv: Inventory,
  party: readonly Unit[] = [],
): RecoveryResult {
  const recovered: string[] = [];
  let swept = 0;
  if (winner !== "player") return { recovered, swept };
  // "Awake and able" (D82) is judged at the moment of victory, BEFORE mortality
  // resolution — a downed-then-recovered sweeper does not sweep. Today the only
  // incapacitation forms are downed (alive=false) and captured; a future 0-HP-style
  // status (petrify/KO) must join this predicate when it lands.
  const sweeper = party.some((u) => isActive(u) && canDisarm(u));
  for (const e of entities) {
    if (!isRecoverable(e)) continue;
    if (e.sprung) continue;
    // The sweep (D82): a standing trap-trained survivor clears the won field's
    // enemy snares, whether or not they were ever spotted.
    const sweepable = sweeper && isConcealedTrap(e) && e.owner === "enemy";
    if (!e.recoverable && !sweepable) continue;
    // Recovered gear lands unconditionally (D75) — even over cap; the discard
    // step (menu / autoTrim) resolves any overflow afterward.
    grantItem(inv, e.materialId, 1);
    recovered.push(e.materialId);
    if (!e.recoverable) swept++;
  }
  return { recovered, swept };
}
