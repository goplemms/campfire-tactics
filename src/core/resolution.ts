/**
 * Resolution — closing a battle and feeding the next phase (D13).
 *
 * M5b lands the **material-recovery** half: recovery is **outcome-gated and
 * whole-field** — a **win** controls the entire battlefield, so every **unsprung,
 * recoverable** field entity (yours *and* the enemy's salvage) returns to storage;
 * **flee/lose → nothing**. Captures and rewards are sketched here as a seam for
 * M6's full run loop.
 *
 * Pure logic: no Phaser, no DOM.
 */

import type { FieldEntity } from "./entities";
import { isRecoverable } from "./entities";
import type { Inventory } from "./inventory";
import { grantItem } from "./inventory";
import type { Side } from "./units";

/** What Resolution reclaimed. */
export interface RecoveryResult {
  /** Material ids returned to storage, one entry per recovered entity. */
  recovered: string[];
}

/**
 * Recover unsprung, recoverable field entities into the inventory **on a win**
 * (D13). Sprung entities, consumed materials, and any non-win outcome recover
 * nothing. Recovered materials are added back to storage (cap permitting).
 */
export function recoverMaterials(
  entities: readonly FieldEntity[],
  winner: Side | undefined,
  inv: Inventory,
): RecoveryResult {
  const recovered: string[] = [];
  if (winner !== "player") return { recovered };
  for (const e of entities) {
    if (!isRecoverable(e)) continue;
    if (e.sprung || !e.recoverable) continue;
    // Recovered gear lands unconditionally (D75) — even over cap; the discard
    // step (menu / autoTrim) resolves any overflow afterward.
    grantItem(inv, e.materialId, 1);
    recovered.push(e.materialId);
  }
  return { recovered };
}
