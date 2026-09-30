/**
 * BattleFlow, the combat slice (design map, step 3) — the free-move turn (D60) driven headlessly:
 * **intents in, view state out**. What BattleScene's turn machine used to decide with loose
 * fields (`waitingFor` / `acted` / `actCharged` / `movedThisTurn` / `turnLocked` / the budget)
 * now lives in the one object the render and the sim's policies both drive — so the clock the
 * scene steps and the clock the sim steps are the same clock (a hidden ambusher passes in both).
 *
 * Pure logic: no Phaser, no DOM.
 */
import { describe, it, expect } from "vitest";
import { BattleFlow } from "./battle-flow";
import { Battle } from "./turn";
import { TileGrid } from "./grid";
import { createUnit, type Side, type Unit } from "./units";
import type { JobId } from "./jobs";
import { moveBudget } from "./combat";
import { makeConcealedTrap } from "./entities";
import { RunLoop } from "./runloop";
import { createRun, type RunState } from "./run";
import { getNode } from "./overworld";

function unit(id: string, side: Side, pos: { col: number; row: number }, speed: number, jobId?: JobId): Unit {
  return createUnit({ id, side, pos, jobId, awareness: 2, speed, maxHp: 20, attack: 5, defense: 1, moveRange: 3, sightRadius: 4 });
}

/** A fight already joined (no staging): three players, a goblin in reach, an ogre at the far edge. */
function fight(seed = 7, opts: { decided?: () => boolean } = {}) {
  const grid = new TileGrid(8, 5);
  const bram = unit("bram", "player", { col: 4, row: 2 }, 12, "soldier"); // fastest — first up
  const vale = unit("vale", "player", { col: 3, row: 2 }, 8);
  const cob = unit("cob", "player", { col: 2, row: 2 }, 6);
  const goblin = unit("goblin", "enemy", { col: 5, row: 2 }, 5);
  const ogre = unit("ogre", "enemy", { col: 7, row: 2 }, 10);
  const battle = new Battle(grid, [bram, vale, cob, goblin, ogre], { seed });
  battle.seed(); // the fight's initiative — the flow opens straight into combat
  const flow = new BattleFlow(battle, opts);
  return { flow, battle, bram, vale, cob, goblin, ogre };
}

/** Step the flow's clock until it yields `kind` (or give up). */
function advanceUntil(flow: BattleFlow, kind: string, max = 12) {
  for (let i = 0; i < max; i++) {
    const step = flow.advanceClock();
    if (step.kind === kind) return step;
    if (step.kind === "turn") flow.endTurn(step.actor);
    else if (step.kind === "enemyTurn") flow.policyTurn(step.actor);
    else if (step.kind === "finish" || step.kind === "refused") break;
  }
  throw new Error(`never reached ${kind}`);
}

describe("BattleFlow — the combat turn, headless", () => {
  it("advanceClock opens the fastest player's free-move turn (undo armed, budget seeded); refused while it is open", () => {
    const { flow, battle, bram } = fight();
    expect(flow.combatView()).toMatchObject({ phase: "combat", actor: null, canAct: false, moveBudget: 0 });
    const step = flow.advanceClock();
    expect(step).toMatchObject({ kind: "turn", actor: bram, spotted: [] });
    expect(flow.combatView()).toMatchObject({ actor: bram, moved: false, acted: false, locked: false, moveBudget: moveBudget(bram), canAct: true, exhausted: false });
    expect(flow.view().actor).toBeNull(); // the deploy view stays quiet in combat
    expect(battle.canUndo()).toBe(false); // armed, but nothing on the stack yet
    expect(flow.advanceClock()).toMatchObject({ kind: "refused" });
  });

  it("a move spends the weighted budget through the logged verb; the strike is the Act; both spent = exhausted; End Turn logs the spend", () => {
    const { flow, battle, bram, goblin } = fight();
    flow.advanceClock();
    const step = flow.reach().find((r) => r.path.length === 1 && r.tile.row !== 2)!; // a sidestep — still adjacent to the goblin
    expect(flow.move(bram, step.tile)).toMatchObject({ ok: true, cost: step.cost });
    expect(flow.combatView()).toMatchObject({ moved: true, moveBudget: moveBudget(bram) - step.cost, canUndo: true });
    // The strike is the Battle's verb; the flow spends the Act.
    const hp = goblin.hp;
    battle.attack(bram, goblin);
    expect(goblin.hp).toBeLessThan(hp);
    expect(flow.spendAct(bram)).toBe(true);
    expect(flow.spendAct(bram)).toBe(false); // one Act per turn
    expect(flow.combatView()).toMatchObject({ acted: true, actCharged: true, canAct: false });
    // Spend the rest of the movement — then the turn is exhausted (the auto-end gate).
    for (let guard = 0; flow.canMoveFurther() && guard < 6; guard++) flow.move(bram, flow.reach().find((r) => r.path.length === 1)!.tile);
    expect(flow.combatView().exhausted).toBe(true);
    expect(flow.endTurn(bram)).toBe(true);
    expect(battle.log[battle.log.length - 1]).toEqual({ kind: "endTurn", unit: "bram", spend: { moved: true, acted: true } });
    expect(flow.combatView()).toMatchObject({ actor: null, canAct: false });
    expect(battle.canUndo()).toBe(false); // the take-back window closed with the turn
  });

  it("a move-spend skill bills as a move (charged: false) — End Turn spends the cheap cost", () => {
    const { flow, battle, bram } = fight();
    flow.advanceClock();
    expect(flow.spendAct(bram, { charged: false })).toBe(true);
    expect(flow.combatView()).toMatchObject({ acted: true, actCharged: false });
    flow.endTurn(bram);
    expect(battle.log[battle.log.length - 1]).toEqual({ kind: "endTurn", unit: "bram", spend: { moved: false, acted: false } });
  });

  it("undo rolls the whole turn back — position, the foe's HP, the log, the budget", () => {
    const { flow, battle, bram, goblin } = fight();
    flow.advanceClock();
    const home = { ...bram.pos };
    const hp = goblin.hp;
    flow.move(bram, flow.reach().find((r) => r.path.length === 1)!.tile);
    battle.attack(bram, goblin);
    flow.spendAct(bram);
    expect(battle.log.map((a) => a.kind)).toEqual(["move", "attack"]);
    expect(flow.undo(bram)).toBe(true);
    expect(bram.pos).toEqual(home);
    expect(goblin.hp).toBe(hp);
    expect(battle.log).toHaveLength(0);
    expect(flow.combatView()).toMatchObject({ moved: false, acted: false, moveBudget: moveBudget(bram), canUndo: false });
  });

  it("a sprung trap locks the turn: the move stands, no take-back (D60)", () => {
    const { flow, battle, bram } = fight();
    // A trap the unit will never sense (concealment far above its Awareness) on the tile it steps to.
    battle.entities.register(makeConcealedTrap("pit", { col: 4, row: 1 }, "enemy", 6, 99));
    flow.advanceClock();
    const hp = bram.hp;
    expect(flow.move(bram, { col: 4, row: 1 })).toMatchObject({ ok: true, spotted: null }); // blundered onto it (the walk halts there)
    expect(bram.hp).toBeLessThan(hp);
    expect(flow.combatView()).toMatchObject({ locked: true, canUndo: false });
    expect(flow.undo(bram)).toBe(false);
    expect(bram.pos).toEqual({ col: 4, row: 1 });
  });

  it("an enemy's turn is handed back and run by policy — planned, logged, ended", () => {
    const { flow, battle } = fight();
    const step = advanceUntil(flow, "enemyTurn");
    if (step.kind !== "enemyTurn") return;
    const before = battle.log.length;
    const plan = flow.policyTurn(step.actor);
    expect(plan.unit).toBe(step.actor);
    expect(battle.log.length).toBeGreaterThan(before);
    const last = battle.log[battle.log.length - 1];
    expect("unit" in last && last.unit).toBe(step.actor.id);
    expect(flow.combatView().actor).toBeNull();
    expect(flow.advanceClock().kind).not.toBe("refused"); // the clock is free again
  });

  it("a hidden ambusher passes its turn on the log — the same clock for the scene and the sim (D42/D44)", () => {
    const { flow, battle, goblin, ogre } = fight();
    goblin.hidden = true;
    ogre.hidden = true;
    const step = advanceUntil(flow, "ambushPass");
    expect(step.kind).toBe("ambushPass");
    if (step.kind !== "ambushPass") return;
    expect(step.actor.side).toBe("enemy");
    expect(battle.log[battle.log.length - 1]).toEqual({ kind: "endTurn", unit: step.actor.id, spend: {} });
  });

  it("a bot may play a player's open turn: policyTurn closes the take-back window and commits it", () => {
    const { flow, battle, bram } = fight();
    const step = flow.advanceClock();
    expect(step).toMatchObject({ kind: "turn", actor: bram });
    const plan = flow.policyTurn(bram);
    expect(plan.unit).toBe(bram);
    expect(flow.combatView().actor).toBeNull();
    expect(battle.canUndo()).toBe(false);
    expect(battle.log.some((a) => a.kind === "endTurn" && a.unit === "bram")).toBe(true);
  });

  it("the graded terminal ends the clock: the run layer's predicate, or the last foe falling", () => {
    expect(fight(7, { decided: () => true }).flow.advanceClock()).toEqual({ kind: "finish" });
    const { flow, goblin, ogre } = fight();
    goblin.alive = false;
    ogre.alive = false;
    expect(flow.advanceClock()).toEqual({ kind: "finish" });
  });
});

describe("RunLoop — the sim's fight runs through the flow (design map, step 3)", () => {
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

  it("autoBattle without a staged deploy phase opens a flow straight into combat", () => {
    const loop = new RunLoop(atFirstCombat("flow-fight"));
    const battle = loop.startEncounter();
    loop.beginBattle();
    expect(loop.flow).toBeUndefined();
    const winner = loop.autoBattle();
    expect(winner).toBeDefined();
    expect(loop.flow).toBeDefined();
    expect(loop.flow!.battle).toBe(battle);
    expect(loop.flow!.combatView()).toMatchObject({ phase: "combat", actor: null });
    expect(loop.flow!.decided()).toBe(true); // the graded terminal the run layer reads
  });

  it("the deploy flow carries on into the fight — one game master per encounter", () => {
    const loop = new RunLoop(atFirstCombat("flow-fight-2"));
    loop.startEncounter();
    const flow = loop.enterDeploy();
    loop.autoDeploy();
    loop.beginBattle();
    loop.autoBattle();
    expect(loop.flow).toBe(flow);
    expect(flow.battle.log[0]).toEqual({ kind: "beginBattle" });
    expect(flow.battle.log.filter((a) => a.kind === "endTurn").length).toBeGreaterThan(0);
  });
});
