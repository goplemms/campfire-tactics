import { describe, it, expect } from "vitest";
import { stageEncounter, encounterOutcome } from "./staging";
import { createUnit } from "./units";
import type { JobId } from "./jobs";
import type { AuthoredEncounter } from "./authored";

/**
 * The **lean infiltration taste** — "Pick the Cell", end-to-end and headless (D90).
 *
 * A standalone throwaway fixture (deliberately **not** wired into the live expedition — the
 * Wave-0 topology is a later pass): a **cuffed** captive (`release: lockpick`) behind a corner
 * guard, a modest garrison, a normal net board, win = `eliminate-all`. It proves the taste's
 * distinguishing claims on shipped rails:
 *  - a **Thief** frees the cuffed captive at deploy (the Expert Lockpick gate), and the freed
 *    body is **carried into combat** as a fielded fighter;
 *  - a **non-Thief** party is refused the pick, so it runs the **frontal** fight (C4) — and the
 *    bound captive never blocks or downgrades the node.
 *
 * The recruit-on-win path is the generic, capability-blind D52 seam (`resolveCaptiveRecruits`
 * reads no `release`) already proven for the L1 Cook, so it is not re-driven here.
 */

const STATS = { speed: 12, maxHp: 24, attack: 9, defense: 3, moveRange: 4, sightRadius: 5 };

/** The taste encounter — a cuffed prisoner only a Thief can pick free. */
const TASTE_ENCOUNTER: AuthoredEncounter = {
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
function partyWith(infilJob: JobId) {
  return [
    createUnit({ id: "anchor", side: "player", pos: { col: 0, row: 0 }, jobId: "soldier", primaryJob: "soldier", ...STATS }),
    createUnit({ id: "infil", side: "player", pos: { col: 0, row: 0 }, jobId: infilJob, primaryJob: infilJob, ...STATS }),
  ];
}

describe("the lean infiltration taste — Pick the Cell (D90)", () => {
  it("stages the prisoner as a bound, cuffed, player-side token — not yet a combatant", () => {
    const staged = stageEncounter(TASTE_ENCOUNTER, partyWith("thief"), { seed: 1 });
    const prisoner = staged.battle.units.find((u) => u.id === "prisoner")!;
    expect(prisoner).toBeDefined();
    expect(prisoner.side).toBe("player");
    expect(prisoner.captured).toBe(true); // bound: off the clock, never an AI target
    expect(prisoner.release).toEqual({ kind: "lockpick" }); // cuffed
  });

  it("the rescue Act refuses a non-Thief at deploy — a no-op that mutates nothing and isn't logged", () => {
    const staged = stageEncounter(TASTE_ENCOUNTER, partyWith("scout"), { seed: 1 });
    staged.battle.enterDeploy();
    const prisoner = staged.battle.units.find((u) => u.id === "prisoner")!;
    const scout = staged.battle.units.find((u) => u.id === "infil")!; // base Scout — no lockpick
    const logBefore = staged.battle.log.length;
    staged.battle.rescue(prisoner, scout);
    expect(prisoner.captured).toBe(true); // still bound — the cell held
    expect(staged.battle.log.length).toBe(logBefore); // refusal is unlogged (replay/undo never see it)
  });

  it("the Thief picks the cell at deploy, and the freed prisoner is carried into combat as a fighter", () => {
    const staged = stageEncounter(TASTE_ENCOUNTER, partyWith("thief"), { seed: 2 });
    staged.battle.enterDeploy();
    const prisoner = staged.battle.units.find((u) => u.id === "prisoner")!;
    const thief = staged.battle.units.find((u) => u.id === "infil")!; // Expert Lockpick
    staged.battle.rescue(prisoner, thief);
    expect(prisoner.captured).toBe(false); // picked free at deploy → on the clock, controllable

    // Carry into combat: after the boundary the freed prisoner is a fielded player the clock hands turns.
    staged.battle.beginBattle();
    staged.battle.seed();
    const handed: string[] = [];
    for (let i = 0; i < 80 && handed.length < 12; i++) {
      const a = staged.battle.nextActor();
      if (!a) break;
      if (a.side === "player") handed.push(a.id);
      a.ct = 0;
    }
    expect(handed).toContain("prisoner");
  });

  it("a non-Thief party runs the frontal fight (C4): the bound captive never blocks or downgrades the win", () => {
    const staged = stageEncounter(TASTE_ENCOUNTER, partyWith("scout"), { seed: 3 });
    staged.battle.enterDeploy();
    const prisoner = staged.battle.units.find((u) => u.id === "prisoner")!;
    const scout = staged.battle.units.find((u) => u.id === "infil")!;
    staged.battle.rescue(prisoner, scout); // refused — stays bound the whole fight
    expect(prisoner.captured).toBe(true);

    // Win the field frontally (clear the garrison).
    for (const u of staged.battle.units) if (u.side === "enemy") u.alive = false;
    expect(encounterOutcome(staged)).toBe("win"); // a bound captive is not a required objective
    expect(prisoner.captured).toBe(true); // still bound at the win — recruited via the generic D52 path
  });
});
