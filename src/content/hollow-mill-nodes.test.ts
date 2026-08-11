import { describe, it, expect, beforeEach } from "vitest";
import {
  THE_HOLLOW_MILL,
  traverseRoute,
  isConcealedTrap,
  clearInjectedNodes,
  AI,
  manhattan,
  type BattlePolicy,
  type Unit,
} from "../core";
import { injectContentNodes } from "./authored-nodes";

/**
 * **Core tests that PLAY the arc's nodes, moved across the layer boundary (D122).**
 *
 * The Hollow Mill's encounter bodies are migrating to `content/levels/*.json`, and
 * {@link "../core".runEncounter} **throws** on an `authoredId` it cannot resolve rather than
 * silently fabricating a procedural fight. So any walk of the arc — even one aimed at a node
 * whose own body is still a TS const — needs the content catalog injected the moment *any*
 * node it crosses is JSON. `core/` may never import `content/`, so those walks live here.
 *
 * Everything below moved **verbatim** (helpers included, no assertion changed) from:
 * - `core/expedition-sim.test.ts` — the `traverseRoute` block (its routes start at `e1`);
 * - `core/runloop.test.ts` — the Node-3 beats (D81/D82/D83/D84), which reach `snares` via `e1`.
 *
 * The *mechanisms* those files test (path enumeration, rest/upkeep/fatigue, battle seeds) stay
 * in core on procedural fixtures; only the arc-fixture cases came across.
 */
beforeEach(() => {
  clearInjectedNodes();
  injectContentNodes();
});

describe("traverseRoute (Phase 1) — over the authored arc", () => {
  // The infiltration arm to the Den (the only way there); the Den does NOT free the Medic (C8).
  const DEN_ROUTE = ["start", "e1", "camp2", "snares", "market", "guildContact", "den"];
  // The sustain arm through the Wagon (which frees the Medic), landing at the rest before finale.
  const WAGON_ROUTE = ["start", "e1", "camp2", "snares", "market", "wagon", "restCamp"];

  it("lands positioned AT the target, pre-resolution", () => {
    const { run, targetId } = traverseRoute(THE_HOLLOW_MILL, DEN_ROUTE);
    expect(targetId).toBe("den");
    expect(run.mapNodeId).toBe("den");
    expect(run.path).toEqual(DEN_ROUTE); // the full route is the path taken
    // The target has NOT been resolved — no history record yet for `den`.
    expect(run.history.some((h) => h.nodeId === "den")).toBe(false);
    // Its predecessors WERE played (e.g. the node-1 skirmish recorded).
    expect(run.history.some((h) => h.nodeId === "e1")).toBe(true);
  });

  it("never resolves the START node — only the predecessors between start and target", () => {
    const { run } = traverseRoute(THE_HOLLOW_MILL, DEN_ROUTE);
    // The starting camp is departed, not played — it must not appear in history.
    expect(run.history.some((h) => h.nodeId === "start")).toBe(false);
    // Exactly the predecessors (route minus start minus target) were resolved, in order.
    const predecessors = DEN_ROUTE.slice(1, -1); // e1, camp2, snares, market, guildContact
    expect(run.history.map((h) => h.nodeId)).toEqual(predecessors);
    // One night per played predecessor — no spurious start-node recovery night.
    expect(run.history).toHaveLength(predecessors.length);
    expect(run.night).toBe(predecessors.length);
  });

  it("the arrival's loop is ready to play the (unresolved) target", () => {
    const { loop } = traverseRoute(THE_HOLLOW_MILL, DEN_ROUTE);
    expect(loop.isTerminal()).toBe(false);
    expect(loop.run.mapNodeId).toBe("den");
  });

  it("the sustain route via the Wagon frees the Medic (flag + Sela in party)", () => {
    const { run } = traverseRoute(THE_HOLLOW_MILL, WAGON_ROUTE);
    expect(run.flags["medic-freed"]).toBe(true);
    expect(run.party.some((u) => u.id === "sela")).toBe(true);
  });

  it("the infiltration route (no Wagon) does NOT free the Medic (C8 exclusivity)", () => {
    const { run } = traverseRoute(THE_HOLLOW_MILL, DEN_ROUTE);
    expect(run.flags["medic-freed"]).toBeFalsy();
    expect(run.party.some((u) => u.id === "sela")).toBe(false);
  });

  it("is deterministic — identical args reproduce party/gold/flags exactly", () => {
    const a = traverseRoute(THE_HOLLOW_MILL, DEN_ROUTE).run;
    const b = traverseRoute(THE_HOLLOW_MILL, DEN_ROUTE).run;
    expect(a.party.map((u) => u.id)).toEqual(b.party.map((u) => u.id));
    expect(a.party.map((u) => u.hp)).toEqual(b.party.map((u) => u.hp));
    expect(a.camp.purse).toBe(b.camp.purse);
    expect(a.flags).toEqual(b.flags);
  });

  it("seedSalt changes combat variance but not map/route/recruits/flags", () => {
    const s1 = traverseRoute(THE_HOLLOW_MILL, WAGON_ROUTE, { seedSalt: 1 });
    const s2 = traverseRoute(THE_HOLLOW_MILL, WAGON_ROUTE, { seedSalt: 2 });
    // The authored map/route/outcomes are fixed across salts.
    expect(s1.run.path).toEqual(s2.run.path);
    expect(s1.run.mapNodeId).toBe(s2.run.mapNodeId);
    expect(s1.run.flags["medic-freed"]).toBe(true);
    expect(s2.run.flags["medic-freed"]).toBe(true);
    expect(s1.run.party.some((u) => u.id === "sela")).toBe(true);
    expect(s2.run.party.some((u) => u.id === "sela")).toBe(true);
    expect(s1.run.party.map((u) => u.id)).toEqual(s2.run.party.map((u) => u.id));
  });

  it("throws on a route that does not start at the start node", () => {
    expect(() => traverseRoute(THE_HOLLOW_MILL, ["e1", "camp2"])).toThrow(/start/);
  });

  it("throws on a non-edge hop", () => {
    // start→snares skips e1/camp2 — not a real forward edge.
    expect(() => traverseRoute(THE_HOLLOW_MILL, ["start", "snares"])).toThrow();
  });

  it("throws on an empty route", () => {
    expect(() => traverseRoute(THE_HOLLOW_MILL, [])).toThrow();
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
