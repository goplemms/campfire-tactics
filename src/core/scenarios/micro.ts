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

// --- lever · seal — the infiltrator slams a door shut behind them (D103 Phase 3) ---
const LEVER_SEAL_ENCOUNTER: AuthoredEncounter = {
  id: "micro-lever-seal",
  name: "Micro · Seal the Door",
  cols: 5,
  rows: 3,
  blocked: [{ col: 3, row: 0 }, { col: 3, row: 2 }], // wall column 3 except the door at (3,1)
  playerSpawns: [{ col: 2, row: 1 }], // the infiltrator — beside the lever, in the control room
  enemies: [{ templateId: "bandit-thug", pos: { col: 0, row: 1 } }], // a guard on the far side
  captives: [],
  // The control-room door starts OPEN (the infiltrator walked through) and is destructible — once the
  // lever seals it, the guard batters it (the full Phase-3 loop).
  gates: [{ id: "door", pos: { col: 3, row: 1 }, locked: false, openBy: [{ kind: "destructible", hp: 20 }] }],
  levers: [{ id: "switch", pos: { col: 2, row: 0 }, targets: ["door"] }], // beside the spawn
  reward: { gold: 20, materials: [] },
};

export const MICRO_LEVER_SEAL: ScenarioConfig = {
  id: "micro-lever-seal",
  name: "Micro · Seal the Door",
  encounter: LEVER_SEAL_ENCOUNTER,
  parties: { solo: [{ id: "infil", side: "player", pos: { col: 0, row: 0 }, jobId: "thief", primaryJob: "thief", ...STATS }] },
  defaultParty: "solo",
};

// --- gate · remnant — a smashed door is a PERMANENT breach the lever can't re-seal (D106) ---
const GATE_REMNANT_ENCOUNTER: AuthoredEncounter = {
  id: "micro-gate-remnant",
  name: "Micro · Smashed Door Remnant",
  cols: 5,
  rows: 3,
  blocked: [{ col: 3, row: 0 }, { col: 3, row: 2 }], // wall column 3 except the door at (3,1)
  playerSpawns: [{ col: 2, row: 1 }], // the breaker — adjacent to the door AND beside the lever at (2,0)
  enemies: [{ templateId: "bandit-thug", pos: { col: 0, row: 1 } }], // a body on the far side → deploy net source
  captives: [],
  // A destructible seal wired to a lever. Once the breaker smashes it, the lever must NOT re-seal it.
  gates: [{ id: "door", pos: { col: 3, row: 1 }, openBy: [{ kind: "destructible", hp: 15 }] }], // 15 ÷ attack 9 = two hits
  levers: [{ id: "switch", pos: { col: 2, row: 0 }, targets: ["door"] }],
  reward: { gold: 20, materials: [] },
};

export const MICRO_GATE_REMNANT: ScenarioConfig = {
  id: "micro-gate-remnant",
  name: "Micro · Smashed Door Remnant",
  encounter: GATE_REMNANT_ENCOUNTER,
  parties: { assault: [{ id: "breaker", side: "player", pos: { col: 0, row: 0 }, jobId: "soldier", primaryJob: "soldier", ...STATS }] },
  defaultParty: "assault",
};

// --- gate · re-seal — the lever keeps a battered door's damage, no top-up (D107) ---
const GATE_RESEAL_ENCOUNTER: AuthoredEncounter = {
  id: "micro-gate-reseal",
  name: "Micro · Re-seal Keeps Damage",
  cols: 5,
  rows: 3,
  blocked: [{ col: 3, row: 0 }, { col: 3, row: 2 }], // wall column 3 except the door at (3,1)
  playerSpawns: [{ col: 2, row: 1 }], // the breaker — adjacent to the door AND beside the lever at (2,0)
  enemies: [{ templateId: "bandit-thug", pos: { col: 4, row: 1 } }], // a body on the far side → deploy net source
  captives: [],
  // A destructible seal, wired to a lever. Batter it partway, toggle it, and the readout must persist.
  gates: [{ id: "door", pos: { col: 3, row: 1 }, openBy: [{ kind: "destructible", hp: 20 }] }], // one hit (9) → 11, holds
  levers: [{ id: "switch", pos: { col: 2, row: 0 }, targets: ["door"] }],
  reward: { gold: 20, materials: [] },
};

export const MICRO_GATE_RESEAL: ScenarioConfig = {
  id: "micro-gate-reseal",
  name: "Micro · Re-seal Keeps Damage",
  encounter: GATE_RESEAL_ENCOUNTER,
  parties: { assault: [{ id: "breaker", side: "player", pos: { col: 0, row: 0 }, jobId: "soldier", primaryJob: "soldier", ...STATS }] },
  defaultParty: "assault",
};

// --- key · drop — felling a `dropOnDeath` warden drops a key to fetch + turn (D117/M5) ---
const KEY_DROP_ENCOUNTER: AuthoredEncounter = {
  id: "micro-key-drop",
  name: "Micro · Drop the Key",
  cols: 6,
  rows: 3,
  blocked: CELL_WALLS,
  playerSpawns: [{ col: 1, row: 1 }], // the striker — adjacent to the warden at (2,1)
  enemies: [{ templateId: "bandit-thug", pos: { col: 2, row: 1 }, id: "warden", role: "captain" }], // the keyholder
  captives: [{ spec: prisoner, pos: { col: 4, row: 1 } }],
  // `dropOnDeath`: his fall drops a key at (2,1) instead of popping the cell — the fetch tile is also the
  // only walkable cell adjacent to the gate, so one step both pockets the key and lines up the Turn Key.
  gates: [{ id: "cell", pos: { col: 3, row: 1 }, openBy: [{ kind: "keyholder", tag: { role: "captain" }, dropOnDeath: true }] }],
  reward: { gold: 20, materials: [] },
};

export const MICRO_KEY_DROP: ScenarioConfig = {
  id: "micro-key-drop",
  name: "Micro · Drop the Key",
  encounter: KEY_DROP_ENCOUNTER,
  parties: { assault: [{ id: "striker", side: "player", pos: { col: 0, row: 0 }, jobId: "soldier", primaryJob: "soldier", ...STATS, attack: 60 }] },
  defaultParty: "assault",
};

/** Every micro-interaction fixture, in gallery order — spread into the scenario registry. */
export const MICRO_SCENARIOS: ScenarioConfig[] = [MICRO_GATE_LOCKPICK, MICRO_GATE_KEYHOLDER, MICRO_GATE_DESTRUCTIBLE, MICRO_GATE_ENEMY_BATTER, MICRO_LEVER_SEAL, MICRO_GATE_REMNANT, MICRO_GATE_RESEAL, MICRO_KEY_DROP];
