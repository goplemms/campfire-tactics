/**
 * The **encounter layout** — the one data shape a battle is set up from, whichever way the level
 * was made. A hand-authored level ({@link "./authored".layoutFromAuthored}) and a seeded procedural
 * one ({@link "./generation".layoutFromGenerated}) both normalize to it, and
 * {@link "./staging".stageEncounter} then runs one straight pipeline over it:
 *
 *   layout → grid ({@link "./grid".TileGrid.fromLayout}) → entities ({@link "./encounter-entities"})
 *          → party placement ({@link "./party-placement"}) → Battle → traps → objectives
 *
 * Pure data (type-only module): no Phaser, no DOM, no `Math.random`.
 */

import type { GridCoord, Region } from "./iso";
import type { UnitSpec } from "./units";
import type { AuthoredGate, AuthoredLever, AuthoredTrap, CaptivePlacement } from "./authored";
import type { SpawnZone } from "./deployment";
import type { ObjectiveSpec } from "./objectives";

/** One enemy to stage: its full stat block, and whether it starts hidden (an unscouted ambush body, D44). */
export interface EnemySlot {
  spec: UnitSpec;
  hidden: boolean;
}

/** Everything a battle is built from: the board, what stands on it, where the party starts, and what wins it. */
export interface EncounterLayout {
  cols: number;
  rows: number;
  /** Permanent wall tiles. */
  blocked: readonly GridCoord[];
  enemies: EnemySlot[];
  /** Bound, player-side units the party can free (D52). */
  captives: CaptivePlacement[];
  /** Interactable gates and the levers that toggle them (D103). */
  gates: AuthoredGate[];
  levers: AuthoredLever[];
  /** Concealed enemy traps pre-placed on the field (D12). */
  traps: AuthoredTrap[];
  /** The garrison's target-priority span (D117). */
  controlRoom?: Region;
  /** The declared safe ground (D119), already filtered by the run's flags. Empty ⇒ the campfire. */
  spawnZones: SpawnZone[];
  /** Fixed party start tiles. Absent ⇒ the auto home edge (procedural). */
  playerSpawns?: readonly GridCoord[];
  /** The objectives to arm, the default elimination goal already injected. */
  objectives: ObjectiveSpec[];
}
