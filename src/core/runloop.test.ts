import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import { createRun, currentNode, reachableNodes, chooseNode, type RunState } from "./run";
import { RunLoop } from "./runloop";
import { REST } from "./recovery";
import { getNode } from "./overworld";
import { cooldownRemaining } from "./overworld-state";
import { SURVEY } from "./jobs";
import { computeUpkeep, RECOVERY } from "./upkeep";
import { FATIGUE, FATIGUE_TIER_FLOORS } from "./fatigue";
import { bypassXp } from "./early-events";
import { isConcealedTrap } from "./entities";
import { traverseRoute } from "./expedition-sim";
import { THE_HOLLOW_MILL } from "./hollow-mill";
import { AI, type BattlePolicy } from "./ai";
import { manhattan } from "./combat";

function roster(): Unit[] {
  return [
    // Rook is a Scout so it can perform the job-gated Survey ability (jobIds: ["scout"]).
    createUnit({ id: "Rook", side: "player", pos: { col: 0, row: 1 }, jobId: "scout", speed: 12, maxHp: 30, attack: 9, defense: 3, moveRange: 4, sightRadius: 5, awareness: 4, intelligence: 4 }),
    createUnit({ id: "Vale", side: "player", pos: { col: 0, row: 4 }, jobId: "survivalist", speed: 10, maxHp: 24, attack: 11, defense: 2, moveRange: 4, sightRadius: 5, awareness: 2 }),
    // A Cook banks Rest Points (so a rest node has RP to triage with).
    createUnit({ id: "Pip", side: "player", pos: { col: -1, row: -1 }, jobId: "cook", speed: 8, maxHp: 18, attack: 3, defense: 1, moveRange: 3, sightRadius: 4 }),
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

  it("bypassEncounter skips the fight — keeps EXP, forgoes loot, records the night (D80)", () => {
    const run = newRun("bypass");
    const node = run.map.order
      .map((id) => getNode(run.map, id))
      .find((n) => n.kind === "combat" && n.layer > 0 && n.layer < run.map.layers - 1)!;
    expect(node).toBeDefined();
    run.mapNodeId = node.id;
    run.path.push(node.id);
    const loop = new RunLoop(run);

    const goldBefore = run.camp.gold;
    const nightBefore = run.night;
    const xpBefore = run.party.map((u) => u.xp);

    const res = loop.bypassEncounter();

    // No fight was staged; each combatant kept the flat bypass EXP.
    expect(loop.battle).toBeUndefined();
    expect(res.xpEach).toBe(bypassXp(node));
    run.party.forEach((u, i) => expect(u.xp).toBeGreaterThan(xpBefore[i]));
    // The loot is forgone — bypassEncounter grants no purse gold…
    expect(run.camp.gold).toBe(goldBefore);
    // …and the night advanced + recorded with no gold earned.
    expect(run.night).toBe(nightBefore + 1);
    expect(last(run.history)).toMatchObject({ nodeId: node.id, kind: "combat", goldEarned: 0 });
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

  it("in-place rest heals the whole wounded party, worst-first (D80)", () => {
    const run = newRun("inplace-party");
    run.rp = 1000; // ample banked RP so the spread reaches every wounded unit in one night
    const loop = new RunLoop(run);
    const rook = run.party.find((u) => u.id === "Rook")!;
    const vale = run.party.find((u) => u.id === "Vale")!;
    rook.hp = 4;
    vale.hp = 6;

    const res = loop.inPlaceRest();
    expect(res.applied).toBe(true);
    expect(rook.hp).toBeGreaterThan(4);
    expect(vale.hp).toBeGreaterThan(6); // not just the single most-wounded — the whole party
    expect(res.healed.map((h) => h.unitId).sort()).toEqual(["Rook", "Vale"]);
  });

  it("consecutive in-place rests build a streak; moving on resets it (D80)", () => {
    const run = newRun("inplace-streak");
    run.rp = 100;
    const loop = new RunLoop(run);
    const rook = run.party.find((u) => u.id === "Rook")!;
    expect(run.overworld.restStreak).toBe(0);

    rook.hp = 4;
    const a = loop.inPlaceRest();
    rook.hp = 4; // re-wound so the second rest isn't refused at full health
    const b = loop.inPlaceRest();
    expect(a.streak).toBe(1);
    expect(b.streak).toBe(2);
    expect(run.overworld.restStreak).toBe(2);

    // The caravan moves on — the stay (and its streak) ends.
    chooseNode(run, reachableNodes(run)[0].id);
    expect(run.overworld.restStreak).toBe(0);
  });

  it("a maxInPlaceStreak cap refuses past the limit (D80)", () => {
    const run = newRun("inplace-cap");
    run.rp = 100;
    const loop = new RunLoop(run);
    const rook = run.party.find((u) => u.id === "Rook")!;
    const knob = RECOVERY as { maxInPlaceStreak: number | null };
    const saved = knob.maxInPlaceStreak;
    knob.maxInPlaceStreak = 2;
    try {
      rook.hp = 4;
      expect(loop.inPlaceRest().applied).toBe(true); // night 1
      rook.hp = 4;
      expect(loop.inPlaceRest().applied).toBe(true); // night 2
      rook.hp = 4;
      const capped = loop.inPlaceRest(); // past the cap
      expect(capped.applied).toBe(false);
      expect(capped.reason).toMatch(/move on/);
    } finally {
      knob.maxInPlaceStreak = saved;
    }
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
    run.overworld.cooldowns["survey"] = 3;
    const nightBefore = run.night;

    loop.inPlaceRest();
    expect(cooldownRemaining(run.overworld, "survey")).toBe(2); // the spine ticked
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

  it("the rest node is the premium tier: big heal (Tier 0) + Deep Rest wipe + debt clear (D47/D80)", () => {
    const run = newRun("rest-premium");
    onRestNode(run);
    const loop = new RunLoop(run);
    // Accrue worn-gear debt; wound a Tier-0 fighter (so it cashes the big heal); leave a
    // teammate Exhausted to prove the Deep Rest wipes *everyone*, not just the healed.
    run.camp.gearWear = 3;
    run.camp.skippedUpkeep = ["repairs"];
    const rook = run.party.find((u) => u.id === "Rook")!;
    rook.hp = 4;
    rook.fatigue = 0; // Tier 0 at rest-time → eligible for the big heal
    run.party.find((u) => u.id === "Vale")!.fatigue = FATIGUE.exhausted;

    const res = loop.restNode();
    expect(res.debtCleared).toBe(3);
    expect(run.camp.gearWear).toBe(0); // cleared in one swipe
    expect(run.camp.skippedUpkeep).toEqual([]); // the skip selection resets too
    expect(res.fatigueRestored).toContain("Vale"); // the Deep Rest wiped the Exhausted teammate
    for (const u of run.party) expect(u.fatigue).toBe(0); // no opt-out — everyone Deep Rests
    // Rook took the *big* heal (RP-pool, not the +2 chip), so it lands in `healed`, not `chipHealed`.
    expect(res.healed.map((h) => h.unitId)).toContain("Rook");
    expect(res.chipHealed.map((h) => h.unitId)).not.toContain("Rook");
    expect(rook.hp).toBeGreaterThan(4 + RECOVERY.nightlyChipHp); // more than a mere chip
  });

  it("the big heal is gated on Tier 0 at rest-time — the too-worn get only the chip (D80)", () => {
    const run = newRun("rest-gate");
    onRestNode(run);
    const loop = new RunLoop(run);
    const rook = run.party.find((u) => u.id === "Rook")!; // arrives fresh → big heal
    const vale = run.party.find((u) => u.id === "Vale")!; // arrives worn → chip only
    rook.hp = 4;
    rook.fatigue = 0; // Tier 0
    vale.hp = 4;
    vale.fatigue = FATIGUE_TIER_FLOORS[2]; // Weary — out of Tier 0 at rest-time

    const res = loop.restNode();

    // Rook cashes the big heal; Vale is too worn and gets only the free nightly chip.
    expect(res.healed.map((h) => h.unitId)).toEqual(["Rook"]);
    expect(res.chipHealed.map((h) => h.unitId)).toEqual(["Vale"]);
    expect(vale.hp).toBe(4 + RECOVERY.nightlyChipHp); // exactly the chip — rested off fatigue, not the wound
    expect(rook.hp - 4).toBeGreaterThan(RECOVERY.nightlyChipHp); // strictly more than the chip
    // Both still Deep Rest — the wipe is unconditional even when the heal isn't.
    expect(rook.fatigue).toBe(0);
    expect(vale.fatigue).toBe(0);
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
      const res = loop.useOverworldSkill(actor, SURVEY, { targetNodeId: ahead.id });
      expect(res.applied).toBe(true);
      expect(actor.fatigue).toBe(SURVEY.overworldCost!.fatigue);
      expect(cooldownRemaining(run.overworld, "survey")).toBe(SURVEY.overworldCost!.cooldown);
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
      expect(cooldownRemaining(run.overworld, "survey")).toBe(SURVEY.overworldCost!.cooldown);
      // …and Break Camp (choosing the next edge) is what ticks it down.
      const next = reachableNodes(run)[0];
      if (next) {
        chooseNode(run, next.id);
        expect(cooldownRemaining(run.overworld, "survey")).toBe(SURVEY.overworldCost!.cooldown! - 1);
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
    const res = loop.useOverworldSkill(actor, SURVEY, { targetNodeId: ahead.id });
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
    run.overworld.cooldowns["survey"] = 99;
    const route = loop.autoTraverse();
    expect(loop.isTerminal()).toBe(true);
    expect(route.length).toBeGreaterThan(1);
    // The spine ticks once per node-step, and a node-step is now a *departure*
    // (breakCamp, fired from chooseNode) — D46. So the tick count is the number of
    // edges walked = path length minus the start node (which is never departed-from
    // by a prior step, but every other visited node was arrived at by a choose).
    const steps = run.path.length - 1;
    expect(cooldownRemaining(run.overworld, "survey")).toBe(99 - steps);
  });
});

describe("runloop — enemy-trap engagement telemetry (the Node-3 lever readout)", () => {
  const SNARES_ROUTE = ["start", "e1", "camp2", "snares"];

  /** Arrive at the Snares node with the encounter staged, ready to inspect. */
  function stagedSnares() {
    const { loop } = traverseRoute(THE_HOLLOW_MILL, SNARES_ROUTE);
    const battle = loop.startEncounter();
    const traps = battle.entities.all().filter(isConcealedTrap);
    return { loop, battle, traps };
  }

  /** Fell every active enemy so the field is won (the graded outcome = win). */
  function winField(battle: { units: Unit[] }): void {
    for (const u of battle.units) {
      if (u.side === "enemy") {
        u.hp = 0;
        u.alive = false;
      }
    }
  }

  it("stages the Sapper's Snares with its five concealed enemy traps", () => {
    const { traps } = stagedSnares();
    expect(traps).toHaveLength(5);
    expect(traps.every((t) => t.owner === "enemy" && !t.revealed && !t.sprung)).toBe(true);
  });

  it("resolve() reports spotted / sprung / disarmed against the staged total", () => {
    const { loop, battle, traps } = stagedSnares();
    traps[0].revealed = true; // an Awareness read found one…
    traps[1].sprung = true; // …one went off on a body…
    battle.entities.remove(traps[2].id); // …and one was disarmed (spotted, then removed)
    winField(battle);
    const res = loop.resolve();
    // spotted counts the disarmed trap too — a disarm requires the spot first. The
    // 3 unsprung, un-disarmed snares sweep on the win (D82 — Vale stands, trap-trained).
    expect(res.traps).toEqual({ staged: 5, spotted: 2, sprung: 1, disarmed: 1, salvaged: 3 });
  });

  it("a field never touched resolves as staged-but-unfelt — and fully swept (D82)", () => {
    const { loop, battle } = stagedSnares();
    winField(battle);
    const res = loop.resolve();
    expect(res.traps).toEqual({ staged: 5, spotted: 0, sprung: 0, disarmed: 0, salvaged: 5 });
  });

  it("no standing trap-trained survivor → the win sweeps nothing (the D82 gate)", () => {
    const { loop, battle } = stagedSnares();
    // Down the party's only trap-trained member before the field is won.
    const vale = battle.units.find((u) => u.id === "vale")!;
    vale.alive = false;
    winField(battle);
    const res = loop.resolve();
    expect(res.traps.salvaged).toBe(0);
  });

  it("a trap-less encounter reports zeroes (and the next node doesn't inherit counts)", () => {
    const { loop } = traverseRoute(THE_HOLLOW_MILL, ["start", "e1"]);
    const battle = loop.startEncounter(); // the L1 skirmish — no traps authored
    winField(battle);
    const res = loop.resolve();
    expect(res.traps).toEqual({ staged: 0, spotted: 0, sprung: 0, disarmed: 0, salvaged: 0 });
  });
});

describe("runloop — the lone straggler holds his field (D81, the Node-3 beat)", () => {
  const POST = { col: 8, row: 2 }; // his authored placement — the far side of the snares

  it("parked players are never charged — the crossing can't be waited out", () => {
    const { loop } = traverseRoute(THE_HOLLOW_MILL, ["start", "e1", "camp2", "snares"]);
    const battle = loop.startEncounter();
    loop.beginBattle();
    const passive: BattlePolicy = {
      name: "passive",
      plan: (u) => ({ unit: u, path: [], destination: u.pos, target: null }),
    };
    const winner = loop.autoBattle({ maxTurns: 60, player: passive });
    const thug = battle.units.find((u) => u.id === "lone-straggler")!;
    // He held: still alive, still within his leash of the post after 60 turns…
    expect(thug.alive).toBe(true);
    expect(manhattan(thug.pos, POST)).toBeLessThanOrEqual(AI.holdLeash);
    // …and a party that never crosses the field decides nothing.
    expect(winner).toBeUndefined();
  });

  it("the charging bot still wins the node — the hold makes the field mandatory, not the fight unwinnable", () => {
    const { loop } = traverseRoute(THE_HOLLOW_MILL, ["start", "e1", "camp2", "snares"]);
    loop.startEncounter();
    loop.beginBattle();
    const winner = loop.autoBattle();
    expect(winner).toBe("player");
  });
});

describe("runloop — the tier-3 trap read at the real node (D83)", () => {
  it("a scouted arrival stages the careless snare pre-revealed; spotted + the sweep both move", () => {
    const { loop } = traverseRoute(THE_HOLLOW_MILL, ["start", "e1", "camp2", "snares"]);
    // Vale's Intelligence-7 floor reads tier 2; one Survey bump reaches the mark tier.
    loop.run.overworld.scouted["snares"] = 1;
    const battle = loop.startEncounter();
    const revealed = battle.entities.all().filter(isConcealedTrap).filter((t) => t.revealed);
    expect(revealed).toHaveLength(1); // the concealment-4 dig — never the field (the ceiling)
    for (const u of battle.units) {
      if (u.side === "enemy") {
        u.hp = 0;
        u.alive = false;
      }
    }
    const res = loop.resolve();
    expect(res.traps).toEqual({ staged: 5, spotted: 1, sprung: 0, disarmed: 0, salvaged: 5 });
  });

  it("an unscouted arrival still stages the field fully concealed", () => {
    const { loop } = traverseRoute(THE_HOLLOW_MILL, ["start", "e1", "camp2", "snares"]);
    const battle = loop.startEncounter();
    expect(battle.entities.all().filter(isConcealedTrap).every((t) => !t.revealed)).toBe(true);
  });
});

describe("runloop — the skittish straggler bolts off-map (D84, the Node-3 beat completed)", () => {
  it("one melee blow breaks him; his exit ends the fight as a player win and the field still sweeps", () => {
    const { loop } = traverseRoute(THE_HOLLOW_MILL, ["start", "e1", "camp2", "snares"]);
    const battle = loop.startEncounter();
    loop.beginBattle();
    const thug = battle.units.find((u) => u.id === "lone-straggler")!;
    const edrin = battle.units.find((u) => u.id === "edrin")!;
    expect(thug.standingOrder).toBe("hold-skittish");

    // Edrin crosses the field and lands the blow that breaks him.
    edrin.pos = { col: 7, row: 2 };
    battle.attack(edrin, thug);
    expect(thug.standingOrder).toBe("flee");
    expect(thug.alive).toBe(true);

    // Park the party — his own turn takes the deserter off his edge-post and out
    // of the world; the exit alone decides the field.
    const passive: BattlePolicy = {
      name: "passive",
      plan: (u) => ({ unit: u, path: [], destination: u.pos, target: null }),
    };
    const winner = loop.autoBattle({ maxTurns: 20, player: passive });
    expect(thug.escaped).toBe(true);
    expect(thug.alive).toBe(true); // gone, not dead — no kill credit
    expect(winner).toBe("player");

    const res = loop.resolve();
    expect(res.result).toBe("win");
    // Vale is standing, so the abandoned field sweeps in full (D82) — no snare
    // sprang in this run.
    expect(res.traps.salvaged).toBe(5);
  });
});
