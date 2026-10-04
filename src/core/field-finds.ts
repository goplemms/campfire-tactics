/**
 * **Field finds** — the named, modest uniques an authored level hides in a supply crate on the board.
 *
 * A find is not stash gear: the battle that holds it may be the run's last (The Rescue's side-door
 * crate is), so a find pays off **in the fight it is found in**. The first player unit to step onto
 * the crate puts the find on, and it confers a fight-long status ({@link FieldFindDef.confers}); the
 * after-action report names it as a trophy. Deliberately small: one status, no inventory, no transfer.
 *
 * Registry shape per the conventions doc: `Def` record + const registry keyed off `.id` + a getter
 * returning `undefined`.
 *
 * Pure logic: no Phaser, no DOM, no `Math.random`.
 */

import { sureFooted, type StatusInstance } from "./status";

/** A field find (pure data): what the crate holds and what wearing it does for the rest of the fight. */
export interface FieldFindDef {
  id: string;
  /** Player-facing name (the report's trophy line, the pickup hint). */
  name: string;
  /** One line on what it does, for the pickup hint and the report. */
  effect: string;
  /** The fight-long status the wearer gains on pickup. */
  confers: () => StatusInstance;
}

function registry(defs: readonly FieldFindDef[]): Record<string, FieldFindDef> {
  const out: Record<string, FieldFindDef> = {};
  for (const d of defs) {
    if (out[d.id]) throw new Error(`field-finds: duplicate id "${d.id}"`);
    out[d.id] = d;
  }
  return out;
}

/**
 * The finds registry. **Smuggler's Wraps** — the side-door crate in The Rescue: the reward for
 * scouting the side door that doesn't depend on carrying a lockpick (a Thief-less infiltrator still
 * gets something for the trip), and +1 move is the right size for it: it helps that body rejoin the
 * fight or get back out, and it doesn't change who wins.
 */
export const FIELD_FINDS: Record<string, FieldFindDef> = registry([
  {
    id: "smugglers-wraps",
    name: "Smuggler's Wraps",
    effect: "+1 move for the rest of the fight",
    confers: () => sureFooted(1),
  },
]);

/** Look up a field find by id. */
export function getFieldFind(id: string): FieldFindDef | undefined {
  return FIELD_FINDS[id];
}
