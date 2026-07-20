import { describe, it, expect } from "vitest";
import type { UnitSpec } from "./units";
import type { OverworldMap, MapNode } from "./overworld";
import type { AuthoredEncounter } from "./authored";
import { registerExpedition, type AuthoredExpedition } from "./expedition";
import { createRunFromExpedition, chooseNode, reachableNodes, isRunOver, type RunState } from "./run";
import { RunLoop } from "./runloop";

function node(id: string, layer: number, kind: MapNode["kind"], edges: string[], authoredId?: string): MapNode {
  return { id, layer, index: 0, kind, edges, authoredId };
}

/** start(rest) → mid(authored combat) → fin(authored combat, final). */
function map(): OverworldMap {
  const nodes: Record<string, MapNode> = {
    start: node("start", 0, "rest", ["mid"]),
    mid: node("mid", 1, "combat", ["fin"], "mid"),
    fin: node("fin", 2, "combat", [], "fin"),
  };
  return { seed: "graded", layers: 3, nodes, startId: "start", finalIds: ["fin"], order: ["start", "mid", "fin"] };
}

/** A closing-gate encounter with an **empty** span, so failing it downs nobody. */
function gateEncounter(id: string): AuthoredEncounter {
  return {
    id, name: id, cols: 8, rows: 6, blocked: [],
    playerSpawns: [{ col: 0, row: 2 }, { col: 0, row: 3 }],
    enemies: [{ templateId: "sapper", pos: { col: 7, row: 0 }, role: "sapper", id: "drv" }],
    reward: { gold: 80, materials: [], xp: 50 },
    objectives: [{ id: "gate", kind: "closing-gate", required: true, label: "Hold", speed: 10, span: [], driver: { id: "drv" } }],
  };
}

function party(): UnitSpec[] {
  const mk = (id: string): UnitSpec => ({
    id, name: id, side: "player", pos: { col: 0, row: 0 }, jobId: "soldier",
    speed: 12, maxHp: 30, attack: 9, defense: 3, moveRange: 4, sightRadius: 5, awareness: 4, intelligence: 4,
  });
  return [mk("rook"), mk("vale")];
}

function expedition(): AuthoredExpedition {
  return registerExpedition({
    id: "graded-exp",
    name: "Graded",
    seed: "graded",
    map: map(),
    encounters: { mid: gateEncounter("mid"), fin: gateEncounter("fin") },
    bundle: { party: party(), purse: 100, supplies: {}, storageCap: 8 },
  });
}

/** Stage the current node, fail its closing-gate by running the clock out. */
function failGate(loop: RunLoop): void {
  loop.startEncounter();
  loop.beginBattle();
  const clock = loop.staged!.battle.clock;
  for (let i = 0; i < 40 && loop.staged!.objectives.some((o) => o.spec.kind === "closing-gate" && o.status() === "pending"); i++) {
    clock.tick();
  }
}

function atFinal(run: RunState): void {
  run.mapNodeId = "fin";
  run.path = ["start", "fin"];
}

describe("graded failure in the run loop (D51)", () => {
  it("interior objective-failure: forfeits the reward, party survives, the run continues", () => {
    const loop = new RunLoop(createRunFromExpedition(expedition()));
    chooseNode(loop.run, "mid");
    const goldBefore = loop.run.camp.purse;
    failGate(loop);
    const res = loop.resolve();

    expect(res.result).toBe("objective-failure");
    expect(loop.run.camp.purse).toBe(goldBefore); // reward forfeited (no gold)
    expect(res.goldEarned).toBe(0);
    expect(loop.run.party.every((u) => u.alive)).toBe(true); // retreats alive
    expect(loop.isTerminal()).toBe(false); // interior node — the run goes on
    expect(reachableNodes(loop.run).map((n) => n.id)).toContain("fin");
    // The node is recorded as played, graded.
    const rec = loop.run.history[loop.run.history.length - 1];
    expect(rec.nodeId).toBe("mid");
    expect(rec.result).toBe("objective-failure");
  });

  it("final objective-failure: the caravan returns alive WITHOUT the prize (not complete, not a wipe)", () => {
    const loop = new RunLoop(createRunFromExpedition(expedition()));
    atFinal(loop.run);
    failGate(loop);
    const res = loop.resolve();

    expect(res.result).toBe("objective-failure");
    expect(loop.isComplete()).toBe(false); // no prize
    expect(isRunOver(loop.run)).toBe(false); // the party is alive (not a wipe)
    expect(loop.isTerminal()).toBe(true); // but the final node ended the run
  });

  it("final win: clearing the gate-met field = complete (the prize)", () => {
    const loop = new RunLoop(createRunFromExpedition(expedition()));
    atFinal(loop.run);
    loop.startEncounter();
    loop.beginBattle();
    // Win: clear the field (the driver dies → the gate is met, the field is clear).
    for (const u of loop.staged!.battle.units) if (u.side === "enemy") u.alive = false;
    const res = loop.resolve();

    expect(res.result).toBe("win");
    expect(loop.isComplete()).toBe(true);
    expect(loop.run.camp.purse).toBeGreaterThan(100); // the prize landed
  });

  it("wipe: the whole party down ends the run", () => {
    const loop = new RunLoop(createRunFromExpedition(expedition()));
    chooseNode(loop.run, "mid");
    loop.startEncounter();
    loop.beginBattle();
    for (const u of loop.combatants) u.alive = false;
    const res = loop.resolve();

    expect(res.result).toBe("wipe");
    expect(loop.isOver()).toBe(true);
    expect(isRunOver(loop.run)).toBe(true);
  });
});
