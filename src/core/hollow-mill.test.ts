import { describe, it, expect } from "vitest";
import {
  THE_HOLLOW_MILL,
  E1_SKIRMISH,
  TRAP_FIELD,
  PRISON_WAGON,
  THIEVES_DEN,
  OUTER_YARD,
  CUFFED_CELL,
  PRISON_ASSAULT,
} from "./hollow-mill";
import { stageEncounter, encounterOutcome } from "./staging";
import { isConcealedTrap } from "./entities";
import { validateExpedition } from "./expedition";
import { createRunFromExpedition } from "./run";
import { RunLoop } from "./runloop";
import { jobLevelOf, LEVELING } from "./leveling";
import { THIEVES_GUILD_CONTACT } from "./stories";
import { SCOUT_PRESTIGE_FLOOR } from "./jobs-data/scout-line";
import { intelFloor } from "./intel";
import { createUnit } from "./units";
import { freeCaptive, canRelease } from "./deployment";
import { gearDelta } from "./gear-condition";
import { grantItem } from "./inventory";

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

  it("authors the Wave-0 topology (spine → pre-fork Market → two exclusive arms → finale)", () => {
    const m = THE_HOLLOW_MILL.map;
    expect(m.startId).toBe("start");
    expect(m.finalIds).toEqual(["finale"]);
    // Spine → the shared pre-fork Market → the FORK (a single either/or).
    expect(m.nodes.snares.edges).toEqual(["market"]);
    expect(m.nodes.market.edges).toEqual(["guildContact", "wagon"]);
    // Sustain arm: wagon → restCamp → finale.
    expect(m.nodes.wagon.edges).toEqual(["restCamp"]);
    expect(m.nodes.restCamp.edges).toEqual(["finale"]);
    // Infiltration arm: guildContact → den → outerYard → guildRite → cuffedCell → finale.
    expect(m.nodes.guildContact.edges).toEqual(["den"]);
    expect(m.nodes.den.edges).toEqual(["outerYard"]);
    expect(m.nodes.outerYard.edges).toEqual(["guildRite"]);
    expect(m.nodes.guildRite.edges).toEqual(["cuffedCell"]);
    expect(m.nodes.cuffedCell.edges).toEqual(["finale"]);
    // Authored bindings resolve.
    expect(m.nodes.e1.authoredId).toBe(E1_SKIRMISH.id);
    expect(m.nodes.snares.authoredId).toBe(TRAP_FIELD.id);
    expect(m.nodes.wagon.authoredId).toBe(PRISON_WAGON.id);
    expect(m.nodes.den.authoredId).toBe(THIEVES_DEN.id);
    expect(m.nodes.outerYard.authoredId).toBe(OUTER_YARD.id);
    expect(m.nodes.cuffedCell.authoredId).toBe(CUFFED_CELL.id);
    expect(m.nodes.finale.authoredId).toBe(PRISON_ASSAULT.id);
    // The pinned event nodes bind their beats (the pre-fork town + the mentor two-beat).
    expect(m.nodes.camp2.eventId).toBe("provision-choice");
    expect(m.nodes.market.eventId).toBe("merchant-town");
    expect(m.nodes.guildContact.eventId).toBe("guild-contact");
    expect(m.nodes.guildRite.eventId).toBe("guild-rite");
  });

  it("C8: the two arms are topology-exclusive — disjoint but for the terminal finale", () => {
    const m = THE_HOLLOW_MILL.map;
    // Forward (transitive) reachability — the only movement the run allows (chooseNode never
    // backtracks), so this is what "exclusive by topology" means, not an asserted invariant.
    const reach = (from: string): Set<string> => {
      const seen = new Set<string>();
      const stack = [...m.nodes[from].edges];
      while (stack.length) {
        const id = stack.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        stack.push(...m.nodes[id].edges);
      }
      return seen;
    };
    const sustain = reach("wagon");
    const infil = reach("guildContact");
    // Neither arm can reach the other's nodes…
    for (const id of ["guildContact", "den", "outerYard", "guildRite", "cuffedCell"]) expect(sustain.has(id)).toBe(false);
    for (const id of ["wagon", "restCamp"]) expect(infil.has(id)).toBe(false);
    // …and their only shared descendant is the terminal finale (no leak back).
    expect([...sustain].filter((id) => infil.has(id))).toEqual(["finale"]);
    expect(m.nodes.finale.edges).toEqual([]);
  });

  it("C3 pacing: guaranteed objective-XP clears a fielded Scout to the prestige floor by the Guild's Rite", () => {
    // The infiltration arm's pre-rite combats award reward.xp uncontested to every survivor's
    // primary job (routeCombatXp); the guild-contact grant tops it up. With ZERO combat kill/hit
    // tally (the worst case), this floor alone must reach L5 — else the rite silently omits the
    // prestige and the Thief route evaporates (the red-team's silent-dead-end). Vale starts L1.
    const den = THE_HOLLOW_MILL.encounters["thieves-den"];
    const guaranteedObjXp =
      (E1_SKIRMISH.reward.xp ?? 0) + (TRAP_FIELD.reward.xp ?? 0) + (den.reward.xp ?? 0) + (OUTER_YARD.reward.xp ?? 0);
    const contactGrant = THIEVES_GUILD_CONTACT.choices.find((c) => c.outcome.jobXp)!.outcome.jobXp!.amount;
    const floorXp = (SCOUT_PRESTIGE_FLOOR - 1) * LEVELING.xpPerJobLevel; // L1 → L5
    expect(guaranteedObjXp + contactGrant).toBeGreaterThanOrEqual(floorXp);
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

  it("CLEAR via the sustain arm: the Wagon frees the Medic (+ Merchant at the pre-fork Market)", () => {
    const loop = freshLoop();
    // Route: e1 → camp2 → snares → market → wagon → restCamp → finale.
    const route = ["e1", "camp2", "snares", "market", "wagon", "restCamp", "finale"];
    const visited = drive(loop, forceWin, (ids) => ids.find((id) => route.includes(id)) ?? ids[0]);
    expect(visited).toContain("wagon");
    expect(loop.run.party.some((u) => u.id === "sela")).toBe(true); // Medic freed at the Wagon
    expect(loop.run.flags["medic-freed"]).toBe(true);
    expect(loop.run.party.some((u) => u.id === "mira")).toBe(true); // Merchant at the pre-fork Market
    expect(loop.isComplete()).toBe(true);
  });

  it("CLEAR via the infiltration arm: relic at the Den + the cell prisoner joins, and NO Medic (C8)", () => {
    const loop = freshLoop();
    // Route: e1 → camp2 → snares → market → guildContact → den → outerYard → guildRite → cuffedCell → finale.
    const route = ["e1", "camp2", "snares", "market", "guildContact", "den", "outerYard", "guildRite", "cuffedCell", "finale"];
    const visited = drive(loop, forceWin, (ids) => ids.find((id) => route.includes(id)) ?? ids[0]);
    expect(visited).toContain("cuffedCell");
    expect(loop.run.inventory.counts["relic-hollow-blade"] ?? 0).toBeGreaterThan(0); // relic from the Den
    expect(loop.run.party.some((u) => u.id === "cell-prisoner")).toBe(true); // recruit-on-win (D52), even frontally
    expect(loop.run.party.some((u) => u.id === "sela")).toBe(false); // no Medic catch-up on this arm (C8)
    expect(loop.isComplete()).toBe(true);
  });

  it("the iron-weapons pick grants party-gear that confers a blanket +attack edge (D78)", () => {
    const run = createRunFromExpedition(THE_HOLLOW_MILL);
    // Nothing carried ⇒ identity delta.
    expect(gearDelta(run)).toEqual({ stats: {}, passives: {}, defensePenalty: 0 });
    grantItem(run.inventory, "iron-weapons");
    expect(gearDelta(run).stats.attack).toBeGreaterThan(0);
    // The edge decays with worn gear; the blanket −defense penalty appears with wear.
    run.camp.gearWear = 99;
    expect(gearDelta(run).stats.attack ?? 0).toBe(0);
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

describe("The Prison Assault finale (D97) — the dual-OR win", () => {
  /** The starting trio (soldier/hunter/scout — no lockpick), as live units. */
  const finaleParty = () => THE_HOLLOW_MILL.bundle.party.map(createUnit);
  const extractSpan = (staged: ReturnType<typeof stageEncounter>) =>
    staged.objectives.find((o) => o.spec.kind === "extraction")!.spec.span!;

  it("authors two OR'd goals: storm the garrison OR extract the prisoners", () => {
    const goals = PRISON_ASSAULT.objectives ?? [];
    expect(goals.map((o) => o.kind).sort()).toEqual(["eliminate-all", "extraction"]);
    const extraction = goals.find((o) => o.kind === "extraction")!;
    expect(extraction.escort).toEqual({ role: "prisoner" });
    expect((extraction.span ?? []).length).toBeGreaterThan(0);
    // Both cells are lockpick-gated (Thief-only), and there are exactly two prisoners.
    expect(PRISON_ASSAULT.captives).toHaveLength(2);
    expect(PRISON_ASSAULT.captives!.every((c) => c.release?.kind === "lockpick")).toBe(true);
  });

  it("frontal path: clearing the garrison wins even with the prisoners still cuffed", () => {
    const staged = stageEncounter(PRISON_ASSAULT, finaleParty());
    expect(encounterOutcome(staged)).toBeUndefined(); // undecided at the start
    for (const u of staged.battle.units) if (u.side === "enemy") u.alive = false;
    // Prisoners never freed — extraction stays pending — but eliminate-all wins (OR'd, D97).
    expect(staged.battle.units.filter((u) => u.captured).length).toBe(2);
    expect(encounterOutcome(staged)).toBe("win");
  });

  it("extraction path: escort the freed prisoners out — a win with the garrison still standing", () => {
    const staged = stageEncounter(PRISON_ASSAULT, finaleParty());
    const prisoners = staged.battle.units.filter((u) => u.role === "prisoner");
    const exit = extractSpan(staged);
    expect(prisoners).toHaveLength(2);
    prisoners.forEach((p, i) => { freeCaptive(p); p.pos = { ...exit[i] }; });
    // The garrison is untouched — a frontal party would still be mid-fight here.
    expect(staged.battle.units.some((u) => u.side === "enemy" && u.alive)).toBe(true);
    expect(encounterOutcome(staged)).toBe("win");
  });

  it("extraction stays pending until EVERY freed prisoner is at the exit", () => {
    const staged = stageEncounter(PRISON_ASSAULT, finaleParty());
    const prisoners = staged.battle.units.filter((u) => u.role === "prisoner");
    const exit = extractSpan(staged);
    // Free + extract only the first — enemies still up, one prisoner short ⇒ undecided.
    freeCaptive(prisoners[0]); prisoners[0].pos = { ...exit[0] };
    expect(encounterOutcome(staged)).toBeUndefined();
    // A still-cuffed prisoner parked on the exit tile does NOT count.
    prisoners[1].pos = { ...exit[1] };
    expect(encounterOutcome(staged)).toBeUndefined();
    freeCaptive(prisoners[1]);
    expect(encounterOutcome(staged)).toBe("win");
  });

  it("the cells resist the starting trio — no lockpick capability, so it wins frontally (C4)", () => {
    const staged = stageEncounter(PRISON_ASSAULT, finaleParty());
    const prisoners = staged.battle.units.filter((u) => u.role === "prisoner");
    const party = staged.battle.units.filter((u) => u.side === "player" && !u.captured);
    for (const p of prisoners) for (const by of party) expect(canRelease(p, by)).toBe(false);
  });
});
