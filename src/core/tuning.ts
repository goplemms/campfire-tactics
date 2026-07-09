/**
 * The balance surface — one place to find (and import) every tunable knob.
 *
 * The game's numbers live as named `as const` blocks **next to the code that
 * reads them** (so a rule and its constants stay together). That's good for
 * locality but bad for a *fine-tuning pass*, which wants to see — and sweep —
 * the whole balance surface at once. This module is that surface: a curated
 * **re-export index**, not a new home. Nothing is defined here; every symbol
 * still lives in its own module and this file just gathers them.
 *
 * Use it two ways:
 *  - **Read it** to discover what's tunable, grouped by domain.
 *  - **Import from it** (`import { AI, FLANK } from "../core/tuning"`) when a
 *    tool — the sim harness, a balance script — wants the knobs in one import.
 *
 * Deliberately **not** re-exported through the `core` barrel ({@link "./index"}),
 * which already `export *`s each source module — routing these through both would
 * collide. Import this module by path.
 *
 * Scope note: this gathers the **scalar/record knob blocks** (the numbers a
 * balance pass turns). Authored *content* tables — enemy rosters, stories,
 * events, job/skill definitions, difficulty policies — stay in their modules;
 * they're data, but they're authored, not swept.
 */

// --- Combat & statuses ------------------------------------------------------
export { FLANK } from "./combat";
export { STATUS_TUNING, CHANNEL_TUNING } from "./status";
export { TURN_THRESHOLD, ACT_COST, MOVE_COST, CHARGE_THRESHOLD } from "./clock";
export { MED_HEAL } from "./skills";
export { KIT } from "./jobs-data/combat";
export { SPOT } from "./traps";

// --- AI ----------------------------------------------------------------------
export { AI } from "./ai";

// --- Deployment & vision -----------------------------------------------------
export { REACH } from "./fog";

// --- Progression: leveling, fatigue, mortality -------------------------------
export { LEVELING } from "./leveling";
export { FATIGUE } from "./fatigue";
export { MORTALITY } from "./mortality";

// --- Camp economy: upkeep, recovery, rest ------------------------------------
export { UPKEEP, RECOVERY, CHUNK_FRACTION, CLERIC_COST } from "./upkeep";
export { REST } from "./recovery";
export { ECONOMY } from "./economy-actions";
export { THEFT } from "./theft";

// --- Guild & recruitment -----------------------------------------------------
export { GUILD } from "./guild";
export { RECRUIT } from "./recruitment";

// --- World: generation, map, node events -------------------------------------
export { GEN } from "./generation";
export { MAP_GEN } from "./overworld";
export { NODE_EVENTS } from "./node-events";
