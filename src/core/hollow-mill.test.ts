import { describe, it, expect } from "vitest";
import {
  THE_HOLLOW_MILL,
  E1_SKIRMISH,
  TRAP_FIELD,
  PRISON_WAGON,
  SECURED_WAGON,
  THIEVES_DEN,
  STUB_FINALE,
} from "./hollow-mill";
import { stageEncounter } from "./staging";
import { isConcealedTrap } from "./entities";
import { validateExpedition } from "./expedition";
import { createRunFromExpedition } from "./run";
import { RunLoop } from "./runloop";
import { jobLevelOf } from "./leveling";
import { intelFloor } from "./intel";
import { createUnit } from "./units";
import { freeCaptive } from "./deployment";
import { gearDelta } from "./gear-condition";

function freshLoop(): RunLoop {
  return new RunLoop(createRunFromExpedition(THE_HOLLOW_MILL));
}

/** Force a clean win: every enemy down (drivers too ⇒ any closing-gate is met). */
function forceWin(loop: RunLoop): void {
  for (const u of loop.staged!.battle.units) if (u.side === "enemy") u.alive = false;
}

/**
 * Walk the expedition, always taking the **first** reachable node; `onCombat` decides
 * each fight. Returns the ordered node ids visited.
 */
function drive(loop: RunLoop, onCombat: (loop: RunLoop) => void, pick: (ids: string[]) => string = (ids) => ids[0]): string[] {
  const visited: string[] = [];
  let guard = 0;
  while (!loop.isTerminal() && guard++ < 30) {
    const reachable = loop.reachable();
    if (reachable.length === 0) break;
    const node = loop.choose(pick(reachable.map((n) => n.id)));
    visited.push(node.id);
    if (node.kind === "combat") {
      loop.startEncounter();
      loop.beginBattle();
      onCombat(loop);
      loop.resolve();
    } else {
      loop.playCurrentNode(); // rest / event — no fight
    }
  }
  return visited;
}

describe("The Hollow Mill — the redesigned vertical slice (D52)", () => {
  it("is a valid hand-built expedition (connectivity + authored bindings)", () => {
    expect(validateExpedition(THE_HOLLOW_MILL)).toEqual([]);
  });

  it("authors the locked topology (camp → L5 region → stub finale)", () => {
    const m = THE_HOLLOW_MILL.map;
    expect(m.startId).toBe("start");
    expect(m.finalIds).toEqual(["finale"]);
    // The fork + reconverge: 4A and 4B both reach the Market; the Market fans to the
    // dug-in Wagon + Den; 4B also reaches the Den directly.
    expect(m.nodes.snares.edges).toEqual(["rest4a", "wagon4b"]);
    expect(m.nodes.rest4a.edges).toContain("market");
    expect(m.nodes.wagon4b.edges).toEqual(expect.arrayContaining(["market", "den"]));
    expect(m.nodes.market.edges).toEqual(expect.arrayContaining(["securedWagon", "den"]));
    // Authored bindings resolve.
    expect(m.nodes.e1.authoredId).toBe(E1_SKIRMISH.id);
    expect(m.nodes.snares.authoredId).toBe(TRAP_FIELD.id);
    expect(m.nodes.wagon4b.authoredId).toBe(PRISON_WAGON.id);
    expect(m.nodes.securedWagon.authoredId).toBe(SECURED_WAGON.id);
    expect(m.nodes.den.authoredId).toBe(THIEVES_DEN.id);
    expect(m.nodes.finale.authoredId).toBe(STUB_FINALE.id);
    // The two authored event nodes pin their beats.
    expect(m.nodes.camp2.eventId).toBe("provision-choice");
    expect(m.nodes.market.eventId).toBe("merchant-town");
  });

  it("boots with the starting trio (recruits join via their nodes, not the bundle)", () => {
    const run = createRunFromExpedition(THE_HOLLOW_MILL);
    expect(run.party).toHaveLength(3);
    expect(run.party.map((u) => u.id).sort()).toEqual(["edrin", "rook", "vale"]);
    expect(run.camp.gold).toBe(120);
    expect(run.expeditionId).toBe("hollow-mill");
  });

  it("node 1 stages Pip as a bound on-board captive — NOT in the party yet (D52)", () => {
    const loop = freshLoop();
    loop.choose("e1");
    const battle = loop.startEncounter();
    loop.beginBattle();
    // Pip is a player-side, bound token on the board…
    const pip = battle.units.find((u) => u.id === "pip");
    expect(pip).toBeDefined();
    expect(pip!.side).toBe("player");
    expect(pip!.captured).toBe(true);
    expect(pip!.pos).toEqual({ col: 7, row: 1 }); // beside the corner cutthroat (col 7,row 0)
    // …but he is NOT a party member until freed/won, and not a fielded combatant.
    expect(loop.run.party.some((u) => u.id === "pip")).toBe(false);
    expect(loop.combatants.some((u) => u.id === "pip")).toBe(false);
  });

  it("node 1 recruits the Cook on the win — even if never reached (the captive-recruit guarantee)", () => {
    const loop = freshLoop();
    loop.choose("e1");
    loop.startEncounter();
    loop.beginBattle();
    forceWin(loop); // the captors fall; the player never walked to Pip
    const res = loop.resolve();
    expect(loop.run.party.some((u) => u.id === "pip")).toBe(true); // joined permanently
    expect(loop.run.party.find((u) => u.id === "pip")!.authored).toBe(true);
    expect(res.rescued).toContain("pip"); // surfaced in the resolution (freed by winning)
    // …and every surviving fighter reached primary-job L2 (the 2nd-active unlock) — the
    // freed Cook included: he banks the encounter's completion XP, joining leveled with the
    // party rather than at base, and his level-up surfaces in the resolution readout.
    for (const u of loop.run.party) {
      expect(jobLevelOf(u, u.primaryJob)).toBeGreaterThanOrEqual(2);
    }
    expect(res.levels.pip).toBeDefined();
  });

  it("freeing the captive mid-fight makes Pip controllable, and the win recruits him once (no double-add)", () => {
    const loop = freshLoop();
    loop.choose("e1");
    const battle = loop.startEncounter();
    loop.beginBattle();
    const pip = battle.units.find((u) => u.id === "pip")!;
    // The rescue mechanic: free the captive (what BattleScene.playerRescue calls).
    freeCaptive(pip);
    expect(pip.captured).toBe(false); // no longer bound → on the CT clock, controllable
    // A freed captive is now an active player unit the clock can hand a turn.
    battle.seed();
    const handed: string[] = [];
    for (let i = 0; i < 40 && handed.length < 8; i++) {
      const a = battle.nextActor();
      if (!a) break;
      if (a.side === "player") handed.push(a.id);
      a.ct = 0;
    }
    expect(handed).toContain("pip");
    // Win → recruited, exactly once (idempotent: the mid-fight free didn't pre-add him).
    forceWin(loop);
    loop.resolve();
    expect(loop.run.party.filter((u) => u.id === "pip")).toHaveLength(1);
  });

  it("L1 stays winnable raw without freeing Pip — a bound captive never fails/blocks the node", () => {
    const loop = freshLoop();
    loop.choose("e1");
    const battle = loop.startEncounter();
    loop.beginBattle();
    const pip = battle.units.find((u) => u.id === "pip")!;
    expect(pip.captured).toBe(true);
    // Kill only the enemies; Pip is left bound (the trio "wins raw"). The graded outcome
    // is a clean win — a captive is not an active player the win check counts, and not a
    // required objective, so it can neither downgrade the win nor wedge the encounter.
    for (const u of battle.units) if (u.side === "enemy") u.alive = false;
    const res = loop.resolve();
    expect(res.result).toBe("win");
    expect(loop.run.party.some((u) => u.id === "pip")).toBe(true); // still recruited on the win
  });

  it("the trap-field stages strong concealed snares + one weak enemy", () => {
    const run = createRunFromExpedition(THE_HOLLOW_MILL);
    const staged = stageEncounter(TRAP_FIELD, run.party);
    const traps = staged.battle.entities.all().filter(isConcealedTrap);
    expect(traps).toHaveLength(5);
    expect(traps.every((t) => t.owner === "enemy" && !t.revealed && !t.sprung)).toBe(true);
    // Exactly one enemy body — the strong field is the encounter.
    expect(TRAP_FIELD.enemies).toHaveLength(1);
  });

  it("CLEAR via 4B: frees the Medic, sets the gate, and completes the run", () => {
    const loop = freshLoop();
    // Route: e1 → camp2 → snares → wagon4b (4B) → den → finale (avoids securedWagon).
    const route = ["e1", "camp2", "snares", "wagon4b", "den", "finale"];
    const visited = drive(loop, forceWin, (ids) => ids.find((id) => route.includes(id)) ?? ids[0]);
    expect(visited).toContain("wagon4b");
    expect(loop.run.party.some((u) => u.id === "sela")).toBe(true); // Medic freed at 4B
    expect(loop.run.flags["medic-freed"]).toBe(true);
    expect(loop.run.inventory.counts["relic-hollow-blade"] ?? 0).toBeGreaterThan(0); // relic from the Den
    expect(loop.isComplete()).toBe(true);
  });

  it("CLEAR via 4A: Medic catch-up at the secured Wagon, then finale", () => {
    const loop = freshLoop();
    // Route: e1 → camp2 → snares → rest4a (safe road) → market → securedWagon → finale.
    const route = ["e1", "camp2", "snares", "rest4a", "market", "securedWagon", "finale"];
    drive(loop, forceWin, (ids) => ids.find((id) => route.includes(id)) ?? ids[0]);
    expect(loop.run.party.some((u) => u.id === "mira")).toBe(true); // Merchant at the Market
    expect(loop.run.party.some((u) => u.id === "sela")).toBe(true); // Medic via the catch-up
    expect(loop.isComplete()).toBe(true);
  });

  it("conditional access: the secured Wagon is gated off once the Medic is held", () => {
    const run = createRunFromExpedition(THE_HOLLOW_MILL);
    const loop = new RunLoop(run);
    // Walk node-by-node to the Market via 4B (which frees the Medic), then STOP at the
    // Market (don't drive past it) so we can inspect the offered edges from there.
    for (const next of ["e1", "camp2", "snares", "wagon4b", "market"]) {
      const node = loop.choose(next);
      if (node.kind === "combat") {
        loop.startEncounter();
        loop.beginBattle();
        forceWin(loop);
        loop.resolve();
      } else {
        loop.playCurrentNode();
      }
    }
    expect(run.flags["medic-freed"]).toBe(true);
    // From the Market the dug-in Wagon must NOT be offered (Medic already held).
    const reachable = loop.reachable().map((n) => n.id);
    expect(reachable).not.toContain("securedWagon");
    expect(reachable).toContain("den");
  });

  it("the iron-weapons pick sets the gear flag and a blanket +attack edge", () => {
    const run = createRunFromExpedition(THE_HOLLOW_MILL);
    // No pick yet ⇒ identity delta.
    expect(gearDelta(run)).toEqual({ attack: 0, defensePenalty: 0 });
    run.flags["iron-weapons"] = true;
    expect(gearDelta(run).attack).toBeGreaterThan(0);
    // The edge decays with worn gear.
    run.camp.gearWear = 99;
    expect(gearDelta(run).attack).toBe(0);
    expect(gearDelta(run).defensePenalty).toBeGreaterThan(0);
  });

  it("a pure AI auto-traverse reaches a terminal deterministically (replayable)", () => {
    const a = freshLoop();
    const b = freshLoop();
    a.autoTraverse();
    b.autoTraverse();
    expect(a.isTerminal()).toBe(true);
    expect(b.isTerminal()).toBe(true);
    expect(a.run.path).toEqual(b.run.path);
    expect(a.run.complete).toBe(b.run.complete);
  });

  it("WIPE: losing node 1 ends the run", () => {
    const loop = freshLoop();
    loop.choose("e1");
    loop.startEncounter();
    loop.beginBattle();
    for (const u of loop.combatants) u.alive = false; // the party falls
    const res = loop.resolve();
    expect(res.result).toBe("wipe");
    expect(loop.isOver()).toBe(true);
  });

  it("the party floors intel at tier 2 — the intel teeth are reachable (D10)", () => {
    const party = THE_HOLLOW_MILL.bundle.party.map(createUnit);
    expect(intelFloor(party)).toBeGreaterThanOrEqual(2);
  });

  it("the Den fields thief enemies (the chase-the-thief tension)", () => {
    expect(THIEVES_DEN.enemies.some((e) => e.templateId === "thief")).toBe(true);
    const run = createRunFromExpedition(THE_HOLLOW_MILL);
    const staged = stageEncounter(THIEVES_DEN, run.party);
    expect(staged.battle.units.some((u) => u.side === "enemy" && u.thief)).toBe(true);
  });
});
