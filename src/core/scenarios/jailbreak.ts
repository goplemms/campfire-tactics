/**
 * Scenario: **Jailbreak** — the interactable-gate showcase (D103), as a bootable `#scene` config.
 *
 * The gate model in one board: a **cell gate** (`openBy: lockpick + keyholder`) encloses a bound
 * prisoner behind walls — the Thief picks it open, *or* defeating the **Warden** (the keyholder,
 * `role: captain`) drops the keys and pops it. A second **keyholder-only** gate proves the Warden's
 * keys open *every* matching cell at once. The `bruiser` party arm can reach and fell the Warden;
 * the Thief always rides along to demo the lockpick Act.
 *
 * Pure data — no import-time side effects (the run is built lazily by `buildScenarioRun`).
 */

import type { UnitSpec } from "../units";
import type { AuthoredEncounter } from "../authored";
import type { ScenarioConfig } from "../scenario";

const STATS = { speed: 12, maxHp: 26, attack: 9, defense: 3, moveRange: 4, sightRadius: 5 };

/**
 * A 9×5 cell block. Cell A (gate @ (3,2)) boxes a prisoner at (4,2) — walls on its other three sides,
 * so the *only* way in is the gate. Cell B (gate @ (3,0), keyholder-only) proves the Warden's keys pop
 * more than one. The Warden sits mid-board, reachable by the assault arm.
 */
export const JAILBREAK_ENCOUNTER: AuthoredEncounter = {
  id: "jailbreak-block",
  name: "The Cell Block",
  cols: 9,
  rows: 5,
  // Walls that seal each prisoner in (only the gate tile is the way through).
  blocked: [
    { col: 4, row: 1 }, { col: 4, row: 3 }, { col: 5, row: 2 }, // cell A around the prisoner at (4,2)
    { col: 4, row: 0 }, { col: 5, row: 0 }, // cell B lip around (4,0)
  ],
  playerSpawns: [
    { col: 2, row: 3 }, // the assault body (party[0] = vanguard)
    { col: 2, row: 2 }, // the infiltrator (party[1] = infil) — adjacent to cell A's gate at (3,2)
  ],
  enemies: [
    { templateId: "bandit-captain", pos: { col: 6, row: 3 }, id: "the-warden", role: "captain" },
    { templateId: "bandit-thug", pos: { col: 6, row: 1 } },
  ],
  captives: [
    // Plain `reach` prisoners now — the GATE carries the lock (D103), not the captive.
    { spec: { id: "wrenna", name: "Wrenna", side: "player", pos: { col: 4, row: 2 }, jobId: "hunter", primaryJob: "hunter", ...STATS }, pos: { col: 4, row: 2 } },
    { spec: { id: "dorn", name: "Dorn", side: "player", pos: { col: 4, row: 0 }, jobId: "heavy-knight", primaryJob: "heavy-knight", ...STATS }, pos: { col: 4, row: 0 } },
  ],
  gates: [
    // Cell A: pick it (Thief) OR defeat the Warden.
    { id: "cell-a", pos: { col: 3, row: 2 }, openBy: [{ kind: "lockpick" }, { kind: "keyholder", tag: { role: "captain" } }] },
    // Cell B: keyholder-only — opens only when the Warden falls.
    { id: "cell-b", pos: { col: 3, row: 0 }, openBy: [{ kind: "keyholder", tag: { role: "captain" } }] },
  ],
  reward: { gold: 120, materials: [], xp: 90 },
};

/** The party: an assault body + an infiltrator (thief = holds Expert Lockpick; soldier = can't pick). */
function partySpecs(infilJob: "thief" | "soldier"): UnitSpec[] {
  return [
    { id: "vanguard", side: "player", pos: { col: 0, row: 0 }, jobId: "soldier", primaryJob: "soldier", ...STATS, attack: 60 },
    { id: "infil", side: "player", pos: { col: 0, row: 0 }, jobId: infilJob, primaryJob: infilJob, ...STATS },
  ];
}

export const JAILBREAK: ScenarioConfig = {
  id: "jailbreak",
  name: "Jailbreak (gate showcase)",
  encounter: JAILBREAK_ENCOUNTER,
  parties: {
    thief: partySpecs("thief"), // picks cell A at the gate; can also storm the Warden for the keys
    noPick: partySpecs("soldier"), // no lockpick — cell A only opens by felling the Warden (C4-style)
  },
  defaultParty: "thief",
};
