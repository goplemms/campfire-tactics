/**
 * Scenario: **Pick the Cell** — the lean infiltration taste (D90), as a bootable
 * scenario config.
 *
 * Promoted here (out of `taste-infiltration.test.ts`) so **one config drives both**
 * the headless test and the visual `#scene` harness: a **cuffed** captive
 * (`release: lockpick`) behind a corner guard, a modest garrison, a normal net
 * board, win = `eliminate-all`. The **party matrix** carries the two arms the taste
 * distinguishes — a **thief** (holds Expert Lockpick → picks the cell at deploy, the
 * freed body is carried into combat) and a **scout** (no lockpick → refused, runs the
 * frontal fight, C4).
 *
 * Pure data — no side effects at import (the expedition is registered lazily by
 * {@link "../scenario".buildScenarioRun}).
 */

import type { JobId } from "../jobs";
import type { UnitSpec } from "../units";
import type { AuthoredEncounter } from "../authored";
import type { ScenarioConfig } from "../scenario";

const STATS = { speed: 12, maxHp: 24, attack: 9, defense: 3, moveRange: 4, sightRadius: 5 };

/** The taste encounter — a cuffed prisoner only a Thief can pick free. */
export const PICK_THE_CELL_ENCOUNTER: AuthoredEncounter = {
  id: "taste-cell-block",
  name: "The Cell Block (taste)",
  cols: 8,
  rows: 5,
  blocked: [],
  playerSpawns: [
    { col: 0, row: 1 },
    { col: 0, row: 2 },
    { col: 0, row: 3 },
  ],
  enemies: [
    { templateId: "bandit-thug", pos: { col: 5, row: 1 } },
    { templateId: "bandit-bowman", pos: { col: 6, row: 3 } },
    { templateId: "bandit-cutthroat", pos: { col: 7, row: 0 } }, // the cell guard, in the corner
  ],
  captives: [
    {
      spec: {
        id: "prisoner",
        name: "Bound Prisoner",
        side: "player",
        pos: { col: 7, row: 1 },
        jobId: "soldier",
        primaryJob: "soldier",
        ...STATS,
      },
      pos: { col: 7, row: 1 }, // beside the corner guard — the pick + rescue affordance
      release: { kind: "lockpick" }, // cuffed: only the Thief's Expert Lockpick frees it
    },
  ],
  reward: { gold: 60, materials: [], xp: 60 },
};

/** A two-body party whose infiltrator carries `infilJob` (thief = has lockpick; scout = not). */
function partySpecs(infilJob: JobId): UnitSpec[] {
  return [
    { id: "anchor", side: "player", pos: { col: 0, row: 0 }, jobId: "soldier", primaryJob: "soldier", ...STATS },
    { id: "infil", side: "player", pos: { col: 0, row: 0 }, jobId: infilJob, primaryJob: infilJob, ...STATS },
  ];
}

export const PICK_THE_CELL: ScenarioConfig = {
  id: "pick-the-cell",
  name: "Pick the Cell (taste)",
  encounter: PICK_THE_CELL_ENCOUNTER,
  parties: {
    thief: partySpecs("thief"), // holds Expert Lockpick — picks the cell
    scout: partySpecs("scout"), // no lockpick — refused, runs the frontal fight (C4)
  },
  defaultParty: "thief",
};
