/**
 * Wave-0 arc integration (#168) — the **infiltration arm, end to end**, scripted.
 *
 * The sim's naive bot can't prove this arm's headline: `autoResolve` declines the
 * unit-targeted mentor offers, so it never prestiges. This drives the arm with the
 * *explicit* choices a player makes and proves the full chain the topology exists for:
 *
 *   guild-contact (arm the invite + job-XP) → the C3 fights (grind the Scout to L5)
 *     → guild-rite (fire Scout→Thief at the floor) → the Cuffed Cell (the fresh Thief
 *     can pick the lock the taste, D90, gates on Expert Lockpick).
 *
 * Plus the C4 control: a non-Thief body is refused that pick.
 *
 * Pure logic: no Phaser, no DOM.
 */

import { describe, it, expect } from "vitest";
import { THE_HOLLOW_MILL } from "./hollow-mill";
import { createRunFromExpedition } from "./run";
import { RunLoop } from "./runloop";
import { jobLevelOf } from "./leveling";
import { recalls } from "./units";
import { canRelease } from "./deployment";
import { SCOUT_PRESTIGE_FLOOR } from "./jobs-data/scout-line";

function freshLoop(): RunLoop {
  return new RunLoop(createRunFromExpedition(THE_HOLLOW_MILL));
}

/** Play a combat node to a forced clean win (every enemy down). */
function winCombat(loop: RunLoop, nodeId: string): void {
  loop.choose(nodeId);
  loop.startEncounter();
  loop.beginBattle();
  for (const u of loop.staged!.battle.units) if (u.side === "enemy") u.alive = false;
  loop.resolve();
}

/** Play an event node, taking a specific interactive option (or the auto default if none). */
function playEvent(loop: RunLoop, nodeId: string, choiceId?: string): void {
  loop.choose(nodeId);
  if (choiceId) {
    loop.chooseEvent(choiceId);
    loop.recordEventNight();
  } else {
    loop.playCurrentNode();
  }
}

const vale = (loop: RunLoop) => loop.run.party.find((u) => u.id === "vale")!;

describe("Wave-0 infiltration arm — the Thief path fires end to end (#168)", () => {
  it("arms at guild-contact, grinds the C3 fights to L5, prestiges at guild-rite, and picks the cell", () => {
    const loop = freshLoop();

    // Spine → the pre-fork Market (recruit Mira, the universal market intro).
    winCombat(loop, "e1"); // + Pip the Cook (captive-recruit)
    playEvent(loop, "camp2"); // the traveler's gift
    winCombat(loop, "snares");
    playEvent(loop, "market"); // Mira the Merchant
    expect(loop.run.party.some((u) => u.id === "mira")).toBe(true);

    // C7 beat-1 — the fence's token: arms the invite + a scout job-XP top-up, NO prestige yet.
    expect(vale(loop).primaryJob).toBe("scout");
    playEvent(loop, "guildContact", "take-token:vale");
    expect(recalls(vale(loop), "thieves-guild-invite")).toBe(true);
    expect(vale(loop).primaryJob).toBe("scout"); // armed, not yet prestiged

    // C3 — the arm's fights carry the Scout's guaranteed objective-XP to the floor.
    winCombat(loop, "den");
    winCombat(loop, "outerYard");
    expect(jobLevelOf(vale(loop), "scout")).toBeGreaterThanOrEqual(SCOUT_PRESTIGE_FLOOR);

    // C7 beat-2 — the rite fires the Scout→Thief prestige in place (the offer is live now).
    loop.choose("guildRite");
    expect(loop.eventChoices().map((c) => c.id)).toContain("initiate:vale");
    loop.chooseEvent("initiate:vale");
    loop.recordEventNight();
    expect(vale(loop).primaryJob).toBe("thief");

    // D90 — at the Cuffed Cell, the fresh Thief holds Expert Lockpick, so it can pick the cell
    // (the capability was EARNED in this run, not handed at boot); a non-Thief body cannot.
    loop.choose("cuffedCell");
    loop.startEncounter();
    loop.beginBattle();
    const captive = loop.staged!.battle.units.find((u) => u.id === "cell-prisoner")!;
    expect(captive.captured).toBe(true);
    expect(canRelease(captive, vale(loop))).toBe(true); // the in-run Thief picks the lock
    const edrin = loop.staged!.battle.units.find((u) => u.id === "edrin")!;
    expect(canRelease(captive, edrin)).toBe(false); // C4 — a non-Thief is refused the pick
  });

  it("C4 control: declining the rite leaves a Scout who is refused the cell (frontal default)", () => {
    const loop = freshLoop();
    winCombat(loop, "e1");
    playEvent(loop, "camp2");
    winCombat(loop, "snares");
    playEvent(loop, "market");
    playEvent(loop, "guildContact", "take-token:vale");
    winCombat(loop, "den");
    winCombat(loop, "outerYard");

    // At the floor, but the player DECLINES the guild's trade — no prestige.
    playEvent(loop, "guildRite", "decline");
    expect(vale(loop).primaryJob).toBe("scout");

    // The cell holds against the whole (Thief-less) party; the fight runs frontally.
    loop.choose("cuffedCell");
    loop.startEncounter();
    loop.beginBattle();
    const captive = loop.staged!.battle.units.find((u) => u.id === "cell-prisoner")!;
    for (const u of loop.staged!.battle.units.filter((u) => u.side === "player")) {
      expect(canRelease(captive, u)).toBe(false);
    }
    // …and winning still recruits the prisoner (recruit-on-win is capability-blind, D52).
    for (const u of loop.staged!.battle.units) if (u.side === "enemy") u.alive = false;
    loop.resolve();
    expect(loop.run.party.some((u) => u.id === "cell-prisoner")).toBe(true);
  });
});
