import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import { createRun, currentNode, reachableNodes, chooseNode, type RunState } from "./run";
import { RunLoop, REST } from "./runloop";
import { getNode } from "./overworld";
import { cooldownRemaining, SCOUT } from "./overworld-actions";
import { computeUpkeep } from "./upkeep";
import { FATIGUE } from "./fatigue";

function roster(): Unit[] {
  return [
    createUnit({ id: "Rook", side: "player", pos: { col: 0, row: 1 }, jobId: "soldier", speed: 12, maxHp: 30, attack: 9, defense: 3, moveRange: 4, sightRadius: 5, awareness: 4, intelligence: 4 }),
    createUnit({ id: "Vale", side: "player", pos: { col: 0, row: 4 }, jobId: "survivalist", speed: 10, maxHp: 24, attack: 11, defense: 2, moveRange: 4, sightRadius: 5, awareness: 2 }),
    // A Chef banks Rest Points (so a rest node has RP to triage with).
    createUnit({ id: "Pip", side: "player", pos: { col: -1, row: -1 }, jobId: "chef", speed: 8, maxHp: 18, attack: 3, defense: 1, moveRange: 3, sightRadius: 4 }),
  ];
}

function newRun(seed: string): RunState {
  return createRun(seed, { party: roster(), difficultyId: "normal", gold: 500 });
}

/** Last element of an array (ES2020-friendly, no Array.prototype.at). */
function last<T>(arr: readonly T[]): T | undefined {
  return arr[arr.length - 1];
}

describe("runloop — rest node recovery (D23)", () => {
  it("a rest node recovers without a battle", () => {
    const run = newRun("rest-recover");
    // Find a rest node anywhere on the map and position the run on it directly.
    const restNode = run.map.order.map((id) => getNode(run.map, id)).find((n) => n.kind === "rest" && n.layer > 0)!;
    expect(restNode).toBeDefined();
    run.mapNodeId = restNode.id;
    run.path.push(restNode.id);

    // Wound a fighter so triage has something to heal.
    const rook = run.party.find((u) => u.id === "Rook")!;
    rook.hp = 4;

    const loop = new RunLoop(run);
    expect(loop.battle).toBeUndefined();
    const before = run.night;
    const res = loop.restNode();

    // No battle was staged…
    expect(loop.battle).toBeUndefined();
    // …a night passed, RP banked (incl. the rest bonus), morale rose, Rook healed.
    expect(run.night).toBe(before + 1);
    expect(res.rpAdded).toBeGreaterThan(0);
    expect(res.moraleGained).toBe(REST.moraleGain);
    expect(res.healed.some((h) => h.unitId === "Rook" && h.hp > 0)).toBe(true);
    expect(rook.hp).toBeGreaterThan(4);
    // The night is recorded as a rest node.
    expect(last(run.history)).toMatchObject({ nodeId: restNode.id, kind: "rest", goldEarned: 0 });
  });

  it("a rest node never stages or resolves a fight", () => {
    const run = newRun("rest-nofight");
    const restNode = run.map.order.map((id) => getNode(run.map, id)).find((n) => n.kind === "rest" && n.layer > 0)!;
    run.mapNodeId = restNode.id;
    run.path.push(restNode.id);
    const loop = new RunLoop(run);
    loop.playCurrentNode();
    expect(currentNode(run).kind).toBe("rest");
    expect(last(run.history)?.winner).toBeUndefined();
  });
});

describe("runloop — the two-tier recovery economy (D47)", () => {
  /** Position a run on the first non-start rest node found. */
  function onRestNode(run: RunState): void {
    const rest = run.map.order.map((id) => getNode(run.map, id)).find((n) => n.kind === "rest" && n.layer > 0)!;
    run.mapNodeId = rest.id;
    run.path.push(rest.id);
  }

  it("in-place rest heals a wounded party (≥1) and costs a night's rations", () => {
    const run = newRun("inplace-heal");
    const loop = new RunLoop(run);
    const rook = run.party.find((u) => u.id === "Rook")!;
    rook.hp = 4;
    const goldBefore = run.camp.gold;

    const res = loop.inPlaceRest();
    expect(res.applied).toBe(true);
    expect(res.hpHealed).toBeGreaterThanOrEqual(1); // the floor (D47)
    expect(rook.hp).toBeGreaterThan(4);
    expect(res.goldSpent).toBeGreaterThan(0);
    expect(run.camp.gold).toBeLessThan(goldBefore); // a night's rations paid
  });

  it("in-place rest refuses at full health — no empty drain (D47)", () => {
    const run = newRun("inplace-full");
    const loop = new RunLoop(run);
    for (const u of run.party) u.hp = u.maxHp; // already topped up
    const goldBefore = run.camp.gold;

    const res = loop.inPlaceRest();
    expect(res.applied).toBe(false);
    expect(res.goldSpent).toBe(0);
    expect(run.camp.gold).toBe(goldBefore); // nothing spent
  });

  it("in-place rest is a full node-step — it ticks ability cooldowns (D47)", () => {
    const run = newRun("inplace-tick");
    const loop = new RunLoop(run);
    run.party.find((u) => u.id === "Rook")!.hp = 4;
    run.overworld.cooldowns["scout"] = 3;
    const nightBefore = run.night;

    loop.inPlaceRest();
    expect(cooldownRemaining(run.overworld, "scout")).toBe(2); // the spine ticked
    expect(run.night).toBe(nightBefore + 1); // a night passed
  });

  it("repeated in-place rests drain the purse and stop when broke (D47)", () => {
    const run = newRun("inplace-drain");
    const loop = new RunLoop(run);
    const rook = run.party.find((u) => u.id === "Rook")!;
    // Keep someone wounded so "full health" never short-circuits the refusal.
    let rests = 0;
    for (let i = 0; i < 200; i++) {
      rook.hp = 1; // re-wound each loop so only gold can stop us
      const res = loop.inPlaceRest();
      if (!res.applied) break;
      rests++;
    }
    expect(rests).toBeGreaterThan(0);
    // It stopped because the purse can't cover another night's rations.
    expect(run.camp.gold).toBeLessThan(computeUpkeep(run.party).total);
  });

  it("the rest node is the premium tier: large heal + fatigue restore + debt clear (D47)", () => {
    const run = newRun("rest-premium");
    onRestNode(run);
    const loop = new RunLoop(run);
    // Accrue worn-gear debt + fatigue, wound a fighter.
    run.camp.gearWear = 3;
    run.camp.skippedUpkeep = ["repairs"];
    const rook = run.party.find((u) => u.id === "Rook")!;
    rook.hp = 4;
    for (const u of run.party) u.fatigue = FATIGUE.exhausted;

    const res = loop.restNode();
    expect(res.debtCleared).toBe(3);
    expect(run.camp.gearWear).toBe(0); // cleared in one swipe
    expect(run.camp.skippedUpkeep).toEqual([]); // the skip selection resets too
    expect(res.fatigueRestored.length).toBeGreaterThan(0);
    for (const u of run.party) expect(u.fatigue).toBe(0);
    expect(rook.hp).toBeGreaterThan(4);
  });
});

describe("runloop — autoTraverse determinism (D22)", () => {
  it("same seed + same choices ⇒ identical history and route", () => {
    function play(seed: string) {
      const run = newRun(seed);
      const loop = new RunLoop(run);
      const route = loop.autoTraverse();
      return { route, history: run.history, complete: run.complete, over: run.over, night: run.night };
    }
    const a = play("auto-det");
    const b = play("auto-det");
    expect(a).toEqual(b);
  });

  it("plays to a terminal state and the route is a valid forward walk", () => {
    const run = newRun("auto-walk");
    const loop = new RunLoop(run);
    const route = loop.autoTraverse();
    expect(loop.isTerminal()).toBe(true);
    expect(route[0]).toBe(run.map.startId);
    for (let i = 2; i < route.length; i++) {
      expect(getNode(run.map, route[i - 1]).edges).toContain(route[i]);
    }
    // A clear ends on the final node; a wipe ends wherever the party fell.
    if (loop.isComplete()) expect(run.map.finalIds).toContain(last(route));
  });
});

/** Walk to the first node of a given kind, taking an overworld action en route. */
function toFirstKind(run: RunState, kind: "combat" | "rest"): void {
  while (true) {
    const next = reachableNodes(run);
    const pick = next.find((n) => n.kind === kind) ?? next[0];
    chooseNode(run, pick.id);
    if (currentNode(run).kind === kind) return;
  }
}

describe("runloop — the unified camp at every node (D35)", () => {
  it("an overworld action opens (works) at a combat node, then commit runs the encounter", () => {
    const run = newRun("camp-combat");
    const loop = new RunLoop(run);
    toFirstKind(run, "combat");
    expect(currentNode(run).kind).toBe("combat");

    // The camp surface: fire an overworld action before committing to the fight.
    const actor = run.party[0];
    const ahead = reachableNodes(run)[0];
    if (ahead) {
      const res = loop.overworldAction(actor, "scout", { targetNodeId: ahead.id });
      expect(res.applied).toBe(true);
      expect(actor.fatigue).toBe(SCOUT.cost.fatigue);
      expect(cooldownRemaining(run.overworld, "scout")).toBe(SCOUT.cost.cooldown);
    }

    // Commit: the existing camp → encounter → resolution still runs.
    const before = run.history.length;
    loop.camp();
    loop.startEncounter();
    loop.beginBattle();
    loop.autoBattle();
    loop.resolve();
    expect(run.history.length).toBe(before + 1);
    // Resolving the fight does NOT tick the spine — the node-step fires at
    // *departure* now (D46), so the scout's cooldown is still full here…
    if (ahead) {
      expect(cooldownRemaining(run.overworld, "scout")).toBe(SCOUT.cost.cooldown);
      // …and Break Camp (choosing the next edge) is what ticks it down.
      const next = reachableNodes(run)[0];
      if (next) {
        chooseNode(run, next.id);
        expect(cooldownRemaining(run.overworld, "scout")).toBe(SCOUT.cost.cooldown! - 1);
      }
    }
  });

  it("an overworld action works at a rest node, and committing restores fatigue", () => {
    const run = newRun("camp-rest");
    const loop = new RunLoop(run);
    toFirstKind(run, "rest");
    expect(currentNode(run).kind).toBe("rest");

    // The camp surface is the same at a rest node — fire an action, spend fatigue.
    const actor = run.party[0];
    const ahead = reachableNodes(run)[0]!;
    const res = loop.overworldAction(actor, "scout", { targetNodeId: ahead.id });
    expect(res.applied).toBe(true);
    expect(actor.fatigue).toBeGreaterThan(0);

    // Over-extend another member, then commit the rest → everyone is restored.
    const other = run.party.find((u) => u.id !== actor.id)!;
    other.fatigue = FATIGUE.exhausted;
    const rest = loop.restNode();
    expect(rest.fatigueRestored).toContain(actor.id);
    expect(rest.fatigueRestored).toContain(other.id);
    for (const u of run.party) expect(u.fatigue).toBe(0);
  });

  it("autoTraverse walks the whole map with the economy ticking, to a terminal", () => {
    const run = newRun("camp-traverse");
    const loop = new RunLoop(run);
    // Arm a cooldown up front, then let the traversal tick it down node by node.
    run.overworld.cooldowns["scout"] = 99;
    const route = loop.autoTraverse();
    expect(loop.isTerminal()).toBe(true);
    expect(route.length).toBeGreaterThan(1);
    // The spine ticks once per node-step, and a node-step is now a *departure*
    // (breakCamp, fired from chooseNode) — D46. So the tick count is the number of
    // edges walked = path length minus the start node (which is never departed-from
    // by a prior step, but every other visited node was arrived at by a choose).
    const steps = run.path.length - 1;
    expect(cooldownRemaining(run.overworld, "scout")).toBe(99 - steps);
  });
});
