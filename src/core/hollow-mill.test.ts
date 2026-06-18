import { describe, it, expect } from "vitest";
import { THE_HOLLOW_MILL, E1_SKIRMISH, TRAP_FIELD, E2_AMBUSH, E3_HOLDOUT } from "./hollow-mill";
import { stageEncounter } from "./staging";
import { isConcealedTrap } from "./entities";
import { canDisarm } from "./traps";
import { validateExpedition } from "./expedition";
import { createRunFromExpedition } from "./run";
import { RunLoop } from "./runloop";
import { jobLevelOf } from "./leveling";
import { intelFloor } from "./intel";
import { createUnit } from "./units";

function freshLoop(): RunLoop {
  return new RunLoop(createRunFromExpedition(THE_HOLLOW_MILL));
}

/** Walk the expedition node by node; `onCombat` decides each fight's fate. */
function drive(loop: RunLoop, onCombat: (loop: RunLoop) => void): void {
  let guard = 0;
  while (!loop.isTerminal() && guard++ < 20) {
    const reachable = loop.reachable();
    if (reachable.length === 0) break;
    const node = loop.choose(reachable[0].id);
    if (node.kind === "combat") {
      loop.startEncounter();
      loop.beginBattle();
      onCombat(loop);
      loop.resolve();
    } else {
      loop.playCurrentNode(); // rest / event — no fight
    }
  }
}

/** Force a clean win: every enemy down (the sapper too ⇒ the closing-gate is met). */
function forceWin(loop: RunLoop): void {
  for (const u of loop.staged!.battle.units) if (u.side === "enemy") u.alive = false;
}

describe("The Hollow Mill — the framework's first AuthoredExpedition (D52)", () => {
  it("is a valid hand-built expedition (connectivity + authored bindings)", () => {
    expect(validateExpedition(THE_HOLLOW_MILL)).toEqual([]);
  });

  it("binds its combat nodes to the three authored encounters", () => {
    const m = THE_HOLLOW_MILL.map;
    expect(m.nodes.e1.authoredId).toBe(E1_SKIRMISH.id);
    expect(m.nodes.e2.authoredId).toBe(E2_AMBUSH.id);
    expect(m.nodes.e3.authoredId).toBe(E3_HOLDOUT.id);
    expect(m.finalIds).toEqual(["e3"]);
    // The camp + rest nodes carry no fight.
    expect(m.nodes.start.kind).toBe("rest");
    expect(m.nodes.rest.kind).toBe("rest");
  });

  it("boots with the bundle (party, purse, supplies)", () => {
    const run = createRunFromExpedition(THE_HOLLOW_MILL);
    expect(run.party).toHaveLength(5); // Vale the Scout is the trapper (Survivalist subsumed)
    expect(run.camp.gold).toBe(120);
    expect(run.expeditionId).toBe("hollow-mill");
  });

  it("the L1→L2 unlock lands after E1 (the authored XP tuning)", () => {
    const loop = freshLoop();
    loop.choose("e1");
    loop.startEncounter();
    loop.beginBattle();
    forceWin(loop);
    loop.resolve();
    // Every surviving fighter reached primary-job L2 (the 2nd-active unlock).
    for (const u of loop.run.party) {
      if (u.jobId === "chef") continue; // Pip the support body uses the deployed path
      expect(jobLevelOf(u, u.primaryJob)).toBeGreaterThanOrEqual(2);
    }
  });

  // --- The three graded terminals (deterministic) ---------------------------

  it("CLEAR: forcing each fight to a win completes the expedition (the prize)", () => {
    const loop = freshLoop();
    drive(loop, forceWin);
    expect(loop.isComplete()).toBe(true);
    expect(loop.run.complete).toBe(true);
  });

  it("OBJECTIVE-FAILURE on E3: the closing-gate fails ⇒ returns alive, no prize", () => {
    const loop = freshLoop();
    drive(loop, (l) => {
      const node = l.run.mapNodeId;
      if (node === "e3") {
        // Let the bridge-cut run out (Sapper alive) instead of clearing the field.
        const clock = l.staged!.battle.clock;
        for (let i = 0; i < 60 && l.staged!.objectives.some((o) => o.spec.kind === "closing-gate" && o.status() === "pending"); i++) clock.tick();
      } else {
        forceWin(l);
      }
    });
    const last = loop.run.history[loop.run.history.length - 1];
    expect(last.nodeId).toBe("e3");
    expect(last.result).toBe("objective-failure");
    expect(loop.isComplete()).toBe(false); // no prize
    expect(loop.run.party.some((u) => u.alive)).toBe(true); // the party came home alive
    expect(loop.isTerminal()).toBe(true); // but the final node ended the run
  });

  it("WIPE: losing E1 ends the run", () => {
    const loop = freshLoop();
    loop.choose("e1");
    loop.startEncounter();
    loop.beginBattle();
    for (const u of loop.combatants) u.alive = false; // the party falls
    const res = loop.resolve();
    expect(res.result).toBe("wipe");
    expect(loop.isOver()).toBe(true);
  });

  it("a pure AI auto-traverse reaches a terminal deterministically (replayable)", () => {
    const a = freshLoop();
    const b = freshLoop();
    a.autoTraverse();
    b.autoTraverse();
    expect(a.isTerminal()).toBe(true);
    expect(b.isTerminal()).toBe(true);
    // Same expedition + same deterministic sim ⇒ identical route + terminal.
    expect(a.run.path).toEqual(b.run.path);
    expect(a.run.complete).toBe(b.run.complete);
    expect(a.run.over).toBe(b.run.over);
  });

  it("the trap-field node stages concealed enemy traps the party can disarm (D12)", () => {
    const run = createRunFromExpedition(THE_HOLLOW_MILL);
    // The snares node sits on the main path (before the rest), bound to the trap field.
    const snares = THE_HOLLOW_MILL.map.nodes["snares"];
    expect(snares.kind).toBe("combat");
    expect(snares.authoredId).toBe(TRAP_FIELD.id);
    // Staging pre-registers the concealed traps as hidden enemy-owned bodies.
    const traps = stageEncounter(TRAP_FIELD, run.party).battle.entities.all().filter(isConcealedTrap);
    expect(traps).toHaveLength(5);
    expect(traps.every((t) => t.owner === "enemy" && !t.revealed && !t.sprung)).toBe(true);
    // …and the party fields a trap-trained unit (Bram) to harvest them.
    expect(run.party.some(canDisarm)).toBe(true);
  });

  it("the party floors intel at tier 2 — the intel teeth are reachable in the demo (D10)", () => {
    // The deploy edge is live by default at tier ≥ 2, and one Scout on E2 reaches
    // tier 3 to reveal its hidden ambush. Guards the lever from going latent again.
    const party = THE_HOLLOW_MILL.bundle.party.map(createUnit);
    expect(intelFloor(party)).toBeGreaterThanOrEqual(2);
  });
});
