/**
 * BattleFlow, the deploy slice (design map, step 3) — the game master's first phase, driven
 * headlessly: **intents in, view state out**. What BattleScene's deploy machine used to decide
 * with loose fields (the actor, moved/acted/revealed, the budget, the alarm) now lives in one
 * object the render and the sim's bot both drive, so the phase where the unlogged mutations
 * clustered is finally visible to the fast suite.
 *
 * Pure logic: no Phaser, no DOM.
 */
import { describe, it, expect } from "vitest";
import { BattleFlow, HOLD_POSITION } from "./battle-flow";
import { Battle } from "./turn";
import { TileGrid } from "./grid";
import { createUnit, type Side, type Unit } from "./units";
import type { JobId } from "./jobs";
import { moveBudget } from "./combat";
import { RunLoop } from "./runloop";
import { createRun, type RunState } from "./run";
import { getNode } from "./overworld";

function unit(id: string, side: Side, pos: { col: number; row: number }, speed: number, jobId?: JobId): Unit {
  return createUnit({ id, side, pos, jobId, awareness: 2, speed, maxHp: 20, attack: 5, defense: 1, moveRange: 3, sightRadius: 4 });
}

/** The golden scenario's board: three players in a row, one ogre at the far edge. */
function scenario(seed = 7): { flow: BattleFlow; battle: Battle; bram: Unit; vale: Unit; cob: Unit } {
  const grid = new TileGrid(8, 5);
  const bram = unit("bram", "player", { col: 4, row: 2 }, 12, "soldier"); // forward, fastest — first up
  const vale = unit("vale", "player", { col: 3, row: 2 }, 8);
  const cob = unit("cob", "player", { col: 2, row: 2 }, 6);
  const battle = new Battle(grid, [bram, vale, cob, unit("ogre", "enemy", { col: 7, row: 2 }, 12)], { seed });
  const flow = new BattleFlow(battle);
  return { flow, battle, bram, vale, cob };
}

describe("BattleFlow — the deploy slice, headless", () => {
  it("enters pre-combat on the Battle's own clock; the first advance opens the fastest unit's turn", () => {
    const { flow, battle, bram } = scenario();
    flow.enterDeploy();
    expect(battle.phase).toBe("deploy");
    expect(flow.view()).toMatchObject({ phase: "deploy", actor: null, moveBudget: 0, canAct: false, controls: ["startBattle"] });
    const step = flow.advance();
    expect(step.kind).toBe("turn");
    if (step.kind !== "turn") return;
    expect(step.actor).toBe(bram);
    expect(flow.view()).toMatchObject({ actor: bram, moved: false, acted: false, moveBudget: moveBudget(bram), canAct: true });
    // A second advance is refused while the turn is open — the clock never steps under an acting unit.
    expect(flow.advance()).toMatchObject({ kind: "refused" });
  });

  it("a move steps to a lit tile through the logged verb and spends the weighted budget; out of reach / moves are named", () => {
    const { flow, battle, bram } = scenario();
    flow.enterDeploy();
    flow.advance();
    const before = flow.view().moveBudget;
    const reach = flow.reach();
    const step = reach.find((r) => r.path.length === 1)!;
    const res = flow.move(bram, step.tile);
    expect(res).toMatchObject({ ok: true, halted: false, cost: step.cost });
    expect(bram.pos).toEqual(step.tile);
    expect(battle.log[battle.log.length - 1]).toMatchObject({ kind: "move", unit: "bram" });
    expect(flow.view()).toMatchObject({ moved: true, moveBudget: before - step.cost, canUndo: true });
    expect(flow.move(bram, { col: 0, row: 0 })).toMatchObject({ ok: false, reason: "out-of-reach" });
    // Someone else's unit can't move on this turn.
    expect(flow.move(battle.units[1], step.tile)).toMatchObject({ ok: false, reason: "not-your-turn" });
  });

  it("Dig In spends the Act (logged); undo rolls the whole turn back — position, stance, budget", () => {
    const { flow, battle, bram } = scenario();
    flow.enterDeploy();
    flow.advance();
    const home = { ...bram.pos };
    const tile = flow.reach().find((r) => r.path.length === 1)!.tile;
    flow.move(bram, tile);
    expect(flow.digIn(bram)).toBe(true);
    expect(bram.dugIn).toBe(true);
    expect(flow.view()).toMatchObject({ acted: true, canAct: false, skills: [] });
    expect(flow.digIn(bram)).toBe(false); // one Act per turn
    expect(battle.log.map((a) => a.kind)).toEqual(["move", "digIn"]);
    expect(flow.undo(bram)).toBe(true);
    expect(bram.pos).toEqual(home);
    expect(bram.dugIn).toBe(false);
    expect(flow.view()).toMatchObject({ moved: false, acted: false, moveBudget: moveBudget(bram), canUndo: false });
    expect(battle.log).toEqual([]);
  });

  it("a unit that opens its turn dug in is hunkered (no verbs) until Take Action; acting breaks the stance", () => {
    const { flow, bram } = scenario();
    flow.enterDeploy();
    flow.advance();
    flow.digIn(bram);
    flow.endTurn(bram);
    // Step until bram is up again (the net's turns pass in between; no catch this early — the party sits in the campfire).
    let step = flow.advance();
    while (!(step.kind === "turn" && step.actor === bram)) {
      if (step.kind === "turn") flow.endTurn(step.actor);
      if (step.kind === "refused") throw new Error("the phase ended before bram's second turn");
      step = flow.advance();
    }
    expect(flow.view()).toMatchObject({ hunkered: true, canAct: false, skills: [] });
    expect(flow.spendAct(bram)).toBe(false); // a hunkered unit has to stand up first
    expect(flow.takeAction(bram)).toBe(true);
    expect(flow.view()).toMatchObject({ hunkered: false, canAct: true, revealed: true });
    expect(bram.dugIn).toBe(true); // Take Action alone keeps the benefit…
    expect(flow.spendAct(bram)).toBe(true);
    expect(bram.dugIn).toBe(false); // …acting breaks it
    expect(flow.view().acted).toBe(true);
  });

  it("End Turn closes the take-back window and spends CT on the log, like a combat turn", () => {
    const { flow, battle, bram } = scenario();
    flow.enterDeploy();
    flow.advance();
    const ct = bram.ct;
    expect(flow.endTurn(bram)).toBe(true);
    expect(flow.view().actor).toBeNull();
    expect(battle.canUndo()).toBe(false);
    expect(battle.log[battle.log.length - 1]).toMatchObject({ kind: "endTurn", unit: "bram", spend: { moved: false, acted: false } });
    expect(bram.ct).toBeLessThan(ct);
    expect(flow.endTurn(bram)).toBe(false); // no turn open
  });

  it("the net's turns close in and raise the alarm; then only Start Battle remains, and it commits through the logged boundary", () => {
    const { flow, battle } = scenario();
    flow.enterDeploy();
    const fronts: string[] = [];
    let step = flow.advance();
    for (let guard = 0; guard < 60 && step.kind !== "refused"; guard++) {
      if (step.kind === "turn") flow.endTurn(step.actor); // everyone holds position — the net gets them
      else fronts.push(`r${step.outcome.advancedTo}${step.outcome.captured ? ` caught ${step.outcome.captured.id}` : ""} → ${step.stage.kind}`);
      step = flow.advance();
    }
    expect(fronts.length).toBeGreaterThan(1);
    expect(fronts[fronts.length - 1]).toMatch(/→ (capture|overrun)$/);
    const view = flow.view();
    expect(view.phase).toBe("alarm");
    expect(view.alarm).toMatch(/capture|overrun/);
    expect(view.controls).toEqual(["startBattle"]);
    if (view.alarm === "capture") {
      expect(battle.units.some((u) => u.side === "player" && u.captured)).toBe(true);
      expect(battle.log.some((a) => a.kind === "capture")).toBe(true); // the catch is bound through the interpreter
    }
    flow.startBattle();
    expect(flow.view().phase).toBe("combat");
    expect(battle.phase).toBe("combat");
    expect(battle.log[battle.log.length - 1]).toEqual({ kind: "beginBattle" });
    expect(flow.advance()).toMatchObject({ kind: "refused" });
  });

  it("Start Battle at any point commits an open turn as it stands", () => {
    const { flow, battle, bram } = scenario();
    flow.enterDeploy();
    flow.advance();
    const tile = flow.reach().find((r) => r.path.length === 1)!.tile;
    flow.move(bram, tile);
    flow.startBattle();
    expect(bram.pos).toEqual(tile);
    expect(battle.canUndo()).toBe(false);
    expect(battle.log.map((a) => a.kind)).toEqual(["move", "beginBattle"]);
    expect(flow.view()).toMatchObject({ phase: "combat", actor: null });
  });

  it("hides enemy-target skills while the foe is concealed (pre-combat), like the deploy row", () => {
    const { flow, battle } = scenario();
    flow.enterDeploy();
    flow.advance(); // bram, a soldier, is up
    const view = flow.view();
    expect(view.skills.length).toBeGreaterThan(0);
    expect(view.skills.every((s) => s.target !== "enemy")).toBe(true);
    expect(battle.units.find((u) => u.side === "enemy")!.concealed).toBe(true);
  });
});

describe("RunLoop — the sim goes through deployment (design map, step 3)", () => {
  function roster(): Unit[] {
    return [
      createUnit({ id: "Rook", side: "player", pos: { col: 0, row: 1 }, jobId: "scout", speed: 12, maxHp: 30, attack: 9, defense: 3, moveRange: 4, sightRadius: 5, awareness: 4 }),
      createUnit({ id: "Vale", side: "player", pos: { col: 0, row: 4 }, jobId: "survivalist", speed: 10, maxHp: 24, attack: 11, defense: 2, moveRange: 4, sightRadius: 5, awareness: 2 }),
    ];
  }
  function atFirstCombat(seed: string): RunState {
    const run = createRun(seed, { party: roster(), difficultyId: "normal", gold: 500 });
    run.mapNodeId = run.map.order.map((id) => getNode(run.map, id)).find((n) => n.kind === "combat")!.id;
    return run;
  }

  it("enterDeploy + autoDeploy (commit at once) crosses the logged boundary; beginBattle then seeds the fight", () => {
    const loop = new RunLoop(atFirstCombat("flow-sim"));
    const battle = loop.startEncounter();
    const flow = loop.enterDeploy();
    expect(loop.flow).toBe(flow);
    expect(battle.phase).toBe("deploy");
    expect(loop.autoDeploy().phase).toBe("combat");
    expect(battle.log.map((a) => a.kind)).toEqual(["beginBattle"]);
    loop.beginBattle();
    expect(battle.nextActor()).not.toBeNull(); // the combat clock is live over the whole roster
    expect(loop.autoBattle()).toBeDefined();
  });

  it("autoDeploy with turns runs the net headlessly — deploy turns and the front's steps land before the boundary", () => {
    const loop = new RunLoop(atFirstCombat("flow-sim-turns"));
    const battle = loop.startEncounter();
    loop.enterDeploy();
    const view = loop.autoDeploy({ turns: 6, policy: HOLD_POSITION });
    expect(view.phase).toBe("combat");
    const kinds = battle.log.map((a) => a.kind);
    expect(kinds[kinds.length - 1]).toBe("beginBattle");
    expect(kinds.filter((k) => k === "endTurn").length).toBeGreaterThan(0);
    expect(kinds.indexOf("beginBattle")).toBe(kinds.length - 1);
  });

  it("beginBattle alone commits a staged deploy phase (the scene's route and the headless route meet there)", () => {
    const loop = new RunLoop(atFirstCombat("flow-sim-commit"));
    const battle = loop.startEncounter();
    loop.enterDeploy();
    loop.beginBattle();
    expect(battle.phase).toBe("combat");
    expect(loop.flow!.view().phase).toBe("combat");
  });

  it("playCurrentNode routes through the flow (the log opens with the boundary)", () => {
    const loop = new RunLoop(atFirstCombat("flow-sim-node"));
    loop.playCurrentNode();
    expect(loop.flow).toBeDefined();
    expect(loop.flow!.battle.log[0]).toEqual({ kind: "beginBattle" });
    expect(loop.flow!.battle.phase).toBe("combat");
  });
});
