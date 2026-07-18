/**
 * **Micro-interaction fixtures** — the smallest bootable scenes that each isolate ONE
 * render+interaction, for the `#scene` micro-harness (`scripts/e2e-micro.mjs`).
 *
 * The middle rung of the test ladder: a **vitest** microtest proves a mechanic's *logic*; a
 * **full-encounter e2e** proves an *integrated flow*; these prove the **same single beat RENDERS +
 * drives without a freeze**, in a real scene, on the least board possible (one actor + the one entity
 * under test + a lone body so the deploy net has a danger source). Adding a mechanic's render guard =
 * one tiny fixture here + a ~10-line walker block. They double as a **clickable gallery** — bare
 * `#scene` lists them, so each interaction can be walked by hand in isolation.
 *
 * Pure data — no import-time side effects (the run is built lazily by `buildScenarioRun`).
 */

import type { UnitSpec } from "../units";
import type { AuthoredEncounter } from "../authored";
import type { ScenarioConfig } from "../scenario";

const STATS = { speed: 12, maxHp: 24, attack: 9, defense: 2, moveRange: 4, sightRadius: 5 };
const prisoner: UnitSpec = { id: "prisoner", name: "Prisoner", side: "player", pos: { col: 4, row: 1 }, jobId: "soldier", primaryJob: "soldier", ...STATS };
/** Walls that seal the prisoner at (4,1) in — the only way through is the gate at (3,1). */
const CELL_WALLS = [{ col: 4, row: 0 }, { col: 4, row: 2 }, { col: 5, row: 1 }];

// --- gate · lockpick — a Thief opens an adjacent locked cell (D103) -----------
const GATE_LOCKPICK_ENCOUNTER: AuthoredEncounter = {
  id: "micro-gate-lockpick",
  name: "Micro · Lockpick a Cell",
  cols: 6,
  rows: 3,
  blocked: CELL_WALLS,
  playerSpawns: [{ col: 2, row: 1 }], // the Thief — adjacent to the gate at (3,1)
  enemies: [{ templateId: "bandit-thug", pos: { col: 1, row: 0 } }], // one body → the deploy net has a source
  captives: [{ spec: prisoner, pos: { col: 4, row: 1 } }],
  gates: [{ id: "cell", pos: { col: 3, row: 1 }, openBy: [{ kind: "lockpick" }] }],
  reward: { gold: 20, materials: [] },
};

export const MICRO_GATE_LOCKPICK: ScenarioConfig = {
  id: "micro-gate-lockpick",
  name: "Micro · Lockpick a Cell",
  encounter: GATE_LOCKPICK_ENCOUNTER,
  parties: { thief: [{ id: "infil", side: "player", pos: { col: 0, row: 0 }, jobId: "thief", primaryJob: "thief", ...STATS }] },
  defaultParty: "thief",
};

// --- gate · keyholder — defeating the warden pops the cell (D103) -------------
const GATE_KEYHOLDER_ENCOUNTER: AuthoredEncounter = {
  id: "micro-gate-keyholder",
  name: "Micro · Keyholder Cell",
  cols: 6,
  rows: 3,
  blocked: CELL_WALLS,
  playerSpawns: [{ col: 1, row: 1 }], // the striker — adjacent to the warden at (2,1)
  enemies: [{ templateId: "bandit-thug", pos: { col: 2, row: 1 }, id: "warden", role: "captain" }], // the keyholder
  captives: [{ spec: prisoner, pos: { col: 4, row: 1 } }],
  gates: [{ id: "cell", pos: { col: 3, row: 1 }, openBy: [{ kind: "keyholder", tag: { role: "captain" } }] }],
  reward: { gold: 20, materials: [] },
};

export const MICRO_GATE_KEYHOLDER: ScenarioConfig = {
  id: "micro-gate-keyholder",
  name: "Micro · Keyholder Cell",
  encounter: GATE_KEYHOLDER_ENCOUNTER,
  parties: { assault: [{ id: "striker", side: "player", pos: { col: 0, row: 0 }, jobId: "soldier", primaryJob: "soldier", ...STATS, attack: 60 }] },
  defaultParty: "assault",
};

// --- gate · destructible — battering a door down (D103 Phase 3) ---------------
const GATE_DESTRUCTIBLE_ENCOUNTER: AuthoredEncounter = {
  id: "micro-gate-destructible",
  name: "Micro · Break a Door",
  cols: 6,
  rows: 3,
  blocked: CELL_WALLS,
  playerSpawns: [{ col: 2, row: 1 }], // the breaker — adjacent to the door at (3,1)
  enemies: [{ templateId: "bandit-thug", pos: { col: 1, row: 0 } }], // one body → the deploy net has a source
  captives: [{ spec: prisoner, pos: { col: 4, row: 1 } }],
  gates: [{ id: "door", pos: { col: 3, row: 1 }, openBy: [{ kind: "destructible", hp: 15 }] }], // 15 hp ÷ attack 9 = two hits
  reward: { gold: 20, materials: [] },
};

export const MICRO_GATE_DESTRUCTIBLE: ScenarioConfig = {
  id: "micro-gate-destructible",
  name: "Micro · Break a Door",
  encounter: GATE_DESTRUCTIBLE_ENCOUNTER,
  parties: { assault: [{ id: "breaker", side: "player", pos: { col: 0, row: 0 }, jobId: "soldier", primaryJob: "soldier", ...STATS }] },
  defaultParty: "assault",
};

// --- gate · enemy AI — a walled-off guard batters the door (D103 Phase 3) -----
const GATE_ENEMY_BATTER_ENCOUNTER: AuthoredEncounter = {
  id: "micro-gate-enemy-batter",
  name: "Micro · Guards Batter the Door",
  cols: 5,
  rows: 3,
  blocked: [{ col: 2, row: 0 }, { col: 2, row: 2 }], // wall column 2 except the door at (2,1)
  playerSpawns: [{ col: 4, row: 1 }], // the party, sealed on the far side of the door
  enemies: [{ templateId: "bandit-thug", pos: { col: 1, row: 1 } }], // a guard, walled off from the party by the door
  gates: [{ id: "door", pos: { col: 2, row: 1 }, openBy: [{ kind: "destructible", hp: 20 }] }],
  reward: { gold: 20, materials: [] },
};

export const MICRO_GATE_ENEMY_BATTER: ScenarioConfig = {
  id: "micro-gate-enemy-batter",
  name: "Micro · Guards Batter the Door",
  encounter: GATE_ENEMY_BATTER_ENCOUNTER,
  parties: { solo: [{ id: "hero", side: "player", pos: { col: 0, row: 0 }, jobId: "soldier", primaryJob: "soldier", ...STATS }] },
  defaultParty: "solo",
};

/** Every micro-interaction fixture, in gallery order — spread into the scenario registry. */
export const MICRO_SCENARIOS: ScenarioConfig[] = [MICRO_GATE_LOCKPICK, MICRO_GATE_KEYHOLDER, MICRO_GATE_DESTRUCTIBLE, MICRO_GATE_ENEMY_BATTER];
