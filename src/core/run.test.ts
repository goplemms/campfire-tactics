import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import {
  createRun,
  currentNode,
  currentEncounter,
  reachableNodes,
  chooseNode,
  isFinalRunNode,
  isRunComplete,
  activeParty,
  removeFromRoster,
  isRunOver,
  recordNight,
  snapshotRun,
  type RunState,
} from "./run";
import { generateOverworld, getNode } from "./overworld";
import { isAuthoredEncounter } from "./staging";
import { RunLoop } from "./runloop";
import { useOverworldSkill } from "./overworld-actions";
import { cooldownRemaining } from "./overworld-state";
import { RECOVERY } from "./upkeep";
import { SURVEY } from "./jobs-data/scout-line";

/** A small fightable roster (Soldiers so they have battle skills too). */
function roster(): Unit[] {
  return [
    // Rook is a Scout so it can perform the job-gated Survey ability (jobIds: ["scout"]).
    createUnit({ id: "Rook", side: "player", pos: { col: 0, row: 1 }, jobId: "scout", speed: 12, maxHp: 30, attack: 9, defense: 3, moveRange: 4, sightRadius: 5, awareness: 4, intelligence: 4 }),
    createUnit({ id: "Vale", side: "player", pos: { col: 0, row: 4 }, jobId: "survivalist", speed: 10, maxHp: 24, attack: 11, defense: 2, moveRange: 4, sightRadius: 5, awareness: 2 }),
  ];
}

function newRun(seed: string): RunState {
  return createRun(seed, { party: roster(), difficultyId: "normal", gold: 200 });
}

/** Walk the run to the first reachable **combat** node (so a battle can stage). */
function toFirstCombat(run: RunState): void {
  while (true) {
    const next = reachableNodes(run);
    const combat = next.find((n) => n.kind === "combat") ?? next[0];
    chooseNode(run, combat.id);
    if (currentNode(run).kind === "combat") return;
  }
}

describe("run — map position (D22)", () => {
  it("a fresh run starts at the map's start node", () => {
    const run = newRun("start");
    expect(run.mapNodeId).toBe(run.map.startId);
    expect(run.path).toEqual([run.map.startId]);
    expect(currentNode(run).layer).toBe(0);
  });

  it("reachableNodes returns only forward-connected nodes", () => {
    const run = newRun("reach");
    const here = currentNode(run);
    for (const n of reachableNodes(run)) {
      expect(here.edges).toContain(n.id);
      expect(n.layer).toBe(here.layer + 1);
    }
  });

  it("chooseNode advances map position and extends the path", () => {
    const run = newRun("choose");
    const target = reachableNodes(run)[0];
    chooseNode(run, target.id);
    expect(run.mapNodeId).toBe(target.id);
    expect(run.path[run.path.length - 1]).toBe(target.id);
  });

  it("chooseNode rejects an unreachable node", () => {
    const run = newRun("reject");
    // The final node is never reachable in a single step from the start.
    expect(() => chooseNode(run, run.map.finalIds[0])).toThrow();
  });

  it("currentEncounter follows the chosen node (deterministic by id + layer)", () => {
    const run = newRun("follow");
    toFirstCombat(run);
    const enc = currentEncounter(run);
    if (isAuthoredEncounter(enc)) throw new Error("expected a procedural encounter");
    expect(enc.index).toBe(currentNode(run).layer);
    // Same node ⇒ identical encounter on a fresh run with the same seed.
    const run2 = newRun("follow");
    while (run2.mapNodeId !== run.mapNodeId) {
      const step = run.path[run2.path.length];
      chooseNode(run2, step);
    }
    expect(currentEncounter(run2)).toEqual(enc);
  });
});

describe("run — state & permadeath", () => {
  it("active roster excludes captured/fallen; permadeath removes a unit", () => {
    const run = newRun("perma");
    expect(activeParty(run).length).toBe(2);

    const vale = run.party.find((u) => u.id === "Vale")!;
    vale.alive = false; // fell in combat
    expect(activeParty(run).length).toBe(1);

    removeFromRoster(run, vale);
    expect(run.party.length).toBe(1);
  });

  it("isRunOver fires only on a full wipe", () => {
    const run = newRun("wipe");
    expect(isRunOver(run)).toBe(false);
    for (const u of run.party) u.alive = false;
    expect(isRunOver(run)).toBe(true);
  });

  it("starts with no outstanding rescue follow-ups (D9/D21)", () => {
    expect(newRun("fresh").rescueQuests).toEqual([]);
  });
});

describe("run — terminals: complete vs wipe (D23)", () => {
  it("clearing the final node flags run-complete", () => {
    const run = newRun("complete");
    // Jump position straight to the final node (test scaffolding) and record a win.
    run.mapNodeId = run.map.finalIds[0];
    run.path.push(run.mapNodeId);
    expect(isFinalRunNode(run)).toBe(true);
    const terminal = recordNight(run, { nodeId: run.mapNodeId, layer: currentNode(run).layer, kind: "combat", winner: "player", goldEarned: 50, fallen: [] });
    expect(terminal).toBe(true);
    expect(isRunComplete(run)).toBe(true);
    expect(run.over).toBe(false);
  });

  it("a wipe ends the run even on a final node", () => {
    const run = newRun("final-wipe");
    for (const u of run.party) u.alive = false;
    run.mapNodeId = run.map.finalIds[0];
    recordNight(run, { nodeId: run.mapNodeId, layer: 6, kind: "combat", winner: "player", goldEarned: 0, fallen: [] });
    expect(run.over).toBe(true);
    expect(run.complete).toBe(false);
  });
});

describe("run — the full map plays to a terminal (integration)", () => {
  it("autoTraverse plays seeded nodes to a wipe or a clear, deterministically", () => {
    const run = newRun("traverse");
    const loop = new RunLoop(run);
    const route = loop.autoTraverse();
    expect(loop.isTerminal()).toBe(true);
    expect(route.length).toBeGreaterThan(1);
    expect(run.history.length).toBeGreaterThan(0);
    // The route is a real forward walk: each step is an edge of the previous node.
    for (let i = 2; i < route.length; i++) {
      expect(getNode(run.map, route[i - 1]).edges).toContain(route[i]);
    }
  });

  it("permadeath through the map: a downed unit is removed (Hardest)", () => {
    const run = createRun("hardest-perma", { party: roster(), difficultyId: "hardest", gold: 200 });
    const loop = new RunLoop(run);
    toFirstCombat(run);
    loop.startEncounter();
    const victim = loop.combatants[0];
    victim.alive = false;
    victim.hp = 0;
    for (const u of loop.battle!.units) if (u.side === "enemy") u.alive = false;
    const res = loop.resolve();
    expect(res.permadeaths).toContain(victim.id);
    expect(run.party.find((u) => u.id === victim.id)).toBeUndefined();
  });

  it("a wipe still ends the run mid-map", () => {
    const run = newRun("midwipe");
    const loop = new RunLoop(run);
    toFirstCombat(run);
    loop.camp();
    loop.startEncounter();
    // Knock the whole player side down → a lost battle ends the run.
    for (const u of loop.battle!.units) if (u.side === "player") u.alive = false;
    const res = loop.resolve();
    expect(res.winner).toBe("enemy");
    expect(loop.isOver()).toBe(true);
  });
});

describe("run — replay reproduces the run (same seed + same choices)", () => {
  it("two runs with the same seed + pick-first reproduce an identical history", () => {
    function play(seed: string) {
      const run = createRun(seed, { party: roster(), difficultyId: "normal", gold: 200 });
      const loop = new RunLoop(run);
      loop.autoTraverse();
      return { history: run.history, path: run.path, complete: run.complete, over: run.over };
    }
    const a = play("replay-seed");
    const b = play("replay-seed");
    expect(a).toEqual(b);
    expect(a.path.length).toBeGreaterThan(1);
  });

  it("the same map regenerates from the seed; a snapshot captures the route", () => {
    const run = newRun("snap");
    toFirstCombat(run);
    const snap = snapshotRun(run);
    expect(snap.mapNodeId).toBe(run.mapNodeId);
    expect(snap.path).toEqual(run.path);

    // A run rebuilt from the seed has the identical map…
    const rebuilt = generateOverworld(snap.seed);
    expect(rebuilt).toEqual(run.map);
    // …and replaying the recorded path lands on the same node + encounter.
    const restored = createRun(snap.seed, { party: roster() });
    for (const id of snap.path.slice(1)) chooseNode(restored, id);
    expect(restored.mapNodeId).toBe(run.mapNodeId);
    expect(currentEncounter(restored)).toEqual(currentEncounter(run));
  });
});

describe("run — the overworld economy round-trips & replays deterministically (D35)", () => {
  it("snapshotRun captures the overworld cooldown/scout state (a deep copy)", () => {
    const run = newRun("eco-snap");
    const target = reachableNodes(run)[0];
    useOverworldSkill(run, run.party[0], SURVEY, { targetNodeId: target.id });
    expect(cooldownRemaining(run.overworld, "survey")).toBe(SURVEY.overworldCost!.cooldown);

    const snap = snapshotRun(run);
    expect(snap.overworld).toEqual(run.overworld);
    // It's a copy, not the live reference — mutating the run doesn't touch the snap.
    run.overworld.cooldowns["survey"] = 0;
    expect(snap.overworld.cooldowns["survey"]).toBe(SURVEY.overworldCost!.cooldown);
  });

  it("same seed + same choices + same actions ⇒ identical cooldown/fatigue trace", () => {
    // A fully scripted run: at every node, scout the first node ahead (when able),
    // then play. The economy outcome must be byte-identical across two runs.
    function play(seed: string) {
      const run = createRun(seed, { party: roster(), difficultyId: "normal", gold: 200 });
      const loop = new RunLoop(run);
      let guard = 0;
      while (!loop.isTerminal() && guard++ < 100) {
        const next = loop.reachable();
        if (next.length === 0) break;
        loop.choose(next[0].id);
        const ahead = loop.reachable()[0];
        if (ahead) loop.useOverworldSkill(run.party[0], SURVEY, { targetNodeId: ahead.id });
        loop.playCurrentNode();
      }
      return {
        cooldowns: run.overworld.cooldowns,
        scouted: run.overworld.scouted,
        fatigue: run.party.map((u) => ({ id: u.id, fatigue: u.fatigue })),
      };
    }
    const a = play("eco-replay");
    const b = play("eco-replay");
    expect(a).toEqual(b);
  });
});

describe("run — the free nightly chip heal (D80 night-after-arrival)", () => {
  const CHIP = RECOVERY.nightlyChipHp;

  /** A reachable **non-rest** node one hop from the current position (the arrival that chips). */
  const reachableNonRest = (run: RunState) => reachableNodes(run).find((n) => n.kind !== "rest")!;

  /** Walk forward until a **rest** node is one hop away; returns it (or null if the seed has none). */
  function adjacentRest(run: RunState) {
    for (let guard = 0; guard < 30; guard++) {
      const rest = reachableNodes(run).find((n) => n.kind === "rest");
      if (rest) return rest;
      const next = reachableNodes(run);
      if (!next.length) return null;
      chooseNode(run, next[0].id);
    }
    return null;
  }

  it("chips alive wounded units on arrival at an ordinary (non-rest) node, capped at max HP", () => {
    const run = newRun("chip-ordinary");
    const [rook, vale] = run.party;
    const target = reachableNonRest(run);
    rook.hp = 10; // wounded (maxHp 30) — set just before the hop so only this arrival chips
    vale.hp = vale.maxHp - 1; // one below the cap → the chip must not overheal
    chooseNode(run, target.id); // arrival applies the nightly rest (D80)
    expect(rook.hp).toBe(10 + CHIP);
    expect(vale.hp).toBe(vale.maxHp); // capped, never above max
  });

  it("does not chip on arrival at a rest node — the Clearing owns its own recovery", () => {
    const run = newRun("chip-rest");
    const rest = adjacentRest(run);
    expect(rest).not.toBeNull(); // this seed has a forward Clearing
    const rook = run.party[0];
    rook.hp = 10; // set just before hopping onto the Clearing
    chooseNode(run, rest!.id);
    expect(rook.hp).toBe(10); // untouched — restNode's Deep Rest reads how worn you arrived
  });

  it("never revives a downed unit on arrival", () => {
    const run = newRun("chip-downed");
    const [rook] = run.party;
    const target = reachableNonRest(run);
    rook.hp = 0;
    rook.alive = false;
    chooseNode(run, target.id);
    expect(rook.hp).toBe(0);
    expect(rook.alive).toBe(false);
  });
});
