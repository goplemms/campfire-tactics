/**
 * Scenario: **The Prison Assault** — the dual-OR finale (D97), as a bootable scenario.
 *
 * Mirrors the live finale's **shape** so the `#scene` harness exercises the extraction
 * render surface in isolation — the **exit-span tint**, the **two OR'd goal rows** in the
 * objective check-list, and the **lockpick cells** — without driving a whole run. The party
 * matrix carries the two win-paths: an **infiltration** arm (holds a Thief → picks the cells,
 * escorts the prisoners to the exit) and a **frontal** arm (no lockpick → storms the garrison,
 * C4). Win = `eliminate-all` **OR** `extraction` (get every freed prisoner to the exit).
 *
 * A self-contained mirror (like `pick-the-cell.ts`), NOT an import of the live `PRISON_ASSAULT`
 * — so the registry stays **pure data** (no import-time expedition registration). The live
 * finale's mechanics are pinned separately in `hollow-mill.test.ts` / `wave0-arc.test.ts`.
 *
 * Pure data — no import-time side effects (registration is lazy in {@link "../scenario".buildScenarioRun}).
 */

import type { JobId } from "../jobs";
import type { UnitSpec } from "../units";
import type { GridCoord } from "../iso";
import type { AuthoredEncounter } from "../authored";
import type { ScenarioConfig } from "../scenario";

const STATS = { speed: 12, maxHp: 26, attack: 9, defense: 3, moveRange: 4, sightRadius: 5 };

/** The extraction exit span — the home/left edge the freed prisoners must be walked back to. */
const EXIT: GridCoord[] = [
  { col: 0, row: 0 }, { col: 0, row: 1 }, { col: 0, row: 2 }, { col: 0, row: 3 }, { col: 0, row: 4 },
];

/** A cuffed cell prisoner — `role: "prisoner"` (the extraction escortee) + `release: lockpick`. */
function cell(id: string, name: string, pos: GridCoord) {
  return {
    spec: { id, name, side: "player", pos, jobId: "soldier", primaryJob: "soldier", role: "prisoner", ...STATS } as UnitSpec,
    pos,
    release: { kind: "lockpick" } as const,
  };
}

/** The finale-shaped encounter — a garrison, two cells, and the two OR'd goals. */
export const PRISON_ASSAULT_SCENARIO_ENCOUNTER: AuthoredEncounter = {
  id: "scene-prison-assault",
  name: "The Prison Assault (finale)",
  cols: 8,
  rows: 5,
  blocked: [{ col: 4, row: 2 }],
  playerSpawns: [{ col: 0, row: 1 }, { col: 0, row: 2 }, { col: 0, row: 3 }],
  enemies: [
    { templateId: "bandit-captain", pos: { col: 7, row: 2 }, id: "warden", role: "captain" },
    { templateId: "bandit-thug", pos: { col: 6, row: 1 } },
    { templateId: "bandit-bowman", pos: { col: 6, row: 3 } },
  ],
  captives: [
    cell("cell-a", "Gaunt Prisoner", { col: 7, row: 0 }),
    cell("cell-b", "Shackled Prisoner", { col: 7, row: 4 }),
  ],
  objectives: [
    { id: "storm", kind: "eliminate-all", required: true, label: "Storm the prison — defeat the garrison" },
    {
      id: "liberate",
      kind: "extraction",
      required: true,
      label: "Free the prisoners and escort them to the exit",
      span: EXIT,
      escort: { role: "prisoner" },
    },
  ],
  reward: { gold: 120, materials: [], xp: 80 },
};

/** A two-body party whose infiltrator carries `infilJob` (thief = has lockpick; soldier = not). */
function partySpecs(infilJob: JobId): UnitSpec[] {
  return [
    { id: "anchor", side: "player", pos: { col: 0, row: 0 }, jobId: "soldier", primaryJob: "soldier", ...STATS },
    { id: "infil", side: "player", pos: { col: 0, row: 0 }, jobId: infilJob, primaryJob: infilJob, ...STATS },
  ];
}

export const PRISON_ASSAULT_SCENARIO: ScenarioConfig = {
  id: "prison-assault",
  name: "The Prison Assault (finale)",
  encounter: PRISON_ASSAULT_SCENARIO_ENCOUNTER,
  parties: {
    infiltration: partySpecs("thief"), // holds Expert Lockpick — picks the cells, extracts
    frontal: partySpecs("soldier"), // no lockpick — storms the garrison (C4)
  },
  defaultParty: "infiltration",
};
