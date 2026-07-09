import { describe, it, expect } from "vitest";
import { Battle, replay } from "./turn";
import { TileGrid } from "./grid";
import { createUnit, type Side, type Unit } from "./units";
import type { FieldEntity } from "./entities";
import { PILOT_POLICY, planEnemyTurn, type BattlePolicy } from "./ai";
import { createInventory, countOf } from "./inventory";
import type { PlaceTrapEffect } from "./skills";

function at(
  id: string,
  side: Side,
  col: number,
  row: number,
  overrides: Partial<Unit> = {},
): Unit {
  return {
    ...createUnit({
      id,
      side,
      pos: { col, row },
      speed: 10,
      maxHp: 12,
      attack: 6,
      defense: 1,
      moveRange: 4,
      sightRadius: 6,
    }),
    ...overrides,
  };
}

describe("Battle orchestrator", () => {
  it("emits onUnitEnterTile/onUnitLeaveTile for each step of a move", () => {
    const grid = new TileGrid(8, 1);
    const mover = at("m", "player", 0, 0);
    const battle = new Battle(grid, [mover]);

    const entered: number[] = [];
    const left: number[] = [];
    battle.bus.on("unitEnterTile", ({ tile }) => entered.push(tile.col));
    battle.bus.on("unitLeaveTile", ({ tile }) => left.push(tile.col));

    battle.moveUnit(mover, [
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ]);
    expect(entered).toEqual([1, 2]);
    expect(left).toEqual([0, 1]);
    expect(mover.pos).toEqual({ col: 2, row: 0 });
  });

  it("fires a registered trap entity when a moving unit enters its tile", () => {
    const grid = new TileGrid(8, 1);
    const mover = at("m", "player", 0, 0);
    const battle = new Battle(grid, [mover]);

    let sprung = false;
    const trap: FieldEntity = {
      id: "trap",
      pos: { col: 2, row: 0 },
      onUnitEnterTile: () => (sprung = true),
    };
    battle.entities.register(trap);

    battle.moveUnit(mover, [
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ]);
    expect(sprung).toBe(true);
  });

  it("rescue frees a bound unit and emits unitRescued with the rescuer (D52)", () => {
    const grid = new TileGrid(8, 1);
    const captive = at("cap", "player", 2, 0, { captured: true });
    const hero = at("hero", "player", 1, 0);
    const battle = new Battle(grid, [hero, captive]);

    const events: { unit: string; by?: string }[] = [];
    battle.bus.on("unitRescued", ({ unit, by }) => events.push({ unit: unit.id, by: by?.id }));

    battle.rescue(captive, hero);
    expect(captive.captured).toBe(false); // freed → back on the clock, controllable
    expect(events).toEqual([{ unit: "cap", by: "hero" }]); // announced once, naming the rescuer
    // The rescue is a logged action now (R1 #111) — replay reconstructs the freeing.
    expect(battle.log[battle.log.length - 1]).toEqual({ kind: "rescue", target: "cap", unit: "hero" });
  });

  it("undo crosses a rescue — the captive's bound state and clock membership come back (#111)", () => {
    const grid = new TileGrid(8, 1);
    const captive = at("cap", "player", 2, 0, { captured: true });
    const hero = at("hero", "player", 1, 0);
    const battle = new Battle(grid, [hero, captive]);
    battle.seed();
    battle.beginUndo();

    battle.rescue(captive, hero);
    expect(captive.captured).toBe(false);
    expect(battle.undoDepth()).toBe(1);

    const undone = battle.undo();
    expect(undone).toEqual({ kind: "rescue", target: "cap", unit: "hero" });
    expect(captive.captured).toBe(true); // bound again — off the clock and the win check
    expect(captive.ct).toBe(0);
    expect(battle.log.length).toBe(0);
  });

  it("plays a tiny skirmish to a decisive outcome on the CT clock", () => {
    const grid = new TileGrid(8, 1);
    // A glass-cannon player vs. a fragile enemy: the player should win.
    const hero = at("hero", "player", 0, 0, { attack: 20, maxHp: 40, hp: 40 });
    const foe = at("foe", "enemy", 4, 0, { attack: 3, maxHp: 12, hp: 12 });
    const battle = new Battle(grid, [hero, foe]);
    battle.seed();

    let guard = 0;
    while (!battle.outcome().over && guard++ < 200) {
      const actor = battle.nextActor();
      if (!actor) break;
      if (actor.side === "enemy") {
        battle.runPolicyTurn(actor);
      } else {
        // Player AI for the test: same logic as the enemy, mirrored.
        battle.runPolicyTurn(actor);
      }
    }

    const outcome = battle.outcome();
    expect(outcome.over).toBe(true);
    expect(outcome.winner).toBe("player");
    expect(foe.alive).toBe(false);
  });

  it("runs the BattleScene roster (both sides AI) to a decisive end, no stalemate", () => {
    // Mirrors the in-browser starting roster + map so the playable gate can't
    // deadlock. Both sides use the enemy AI as a stand-in for the human player.
    const grid = new TileGrid(8, 6, [
      { col: 3, row: 2 },
      { col: 4, row: 2 },
      { col: 4, row: 3 },
    ]);
    const units = [
      at("Rook", "player", 0, 1, { speed: 12, maxHp: 30, hp: 30, attack: 9, defense: 3 }),
      at("Vale", "player", 0, 4, { speed: 10, maxHp: 24, hp: 24, attack: 11, defense: 2 }),
      at("Grunt", "enemy", 7, 1, { speed: 9, maxHp: 22, hp: 22, attack: 7, defense: 2 }),
      at("Brute", "enemy", 7, 4, { speed: 7, maxHp: 30, hp: 30, attack: 8, defense: 3, moveRange: 3 }),
    ];
    const battle = new Battle(grid, units);
    battle.seed();

    let guard = 0;
    while (!battle.outcome().over && guard++ < 500) {
      const actor = battle.nextActor();
      if (!actor) break;
      battle.runPolicyTurn(actor);
    }
    expect(battle.outcome().over).toBe(true);
    expect(guard).toBeLessThan(500);
  });

  it("PILOT_POLICY plans identically to the underlying planner (D56)", () => {
    const grid = new TileGrid(8, 1);
    const enemy = at("e", "enemy", 0, 0);
    const player = at("p", "player", 4, 0);
    const viaPolicy = PILOT_POLICY.plan(enemy, [enemy, player], grid);
    const direct = planEnemyTurn(enemy, [enemy, player], grid);
    expect(viaPolicy.destination).toEqual(direct.destination);
    expect(viaPolicy.target).toBe(direct.target);
    expect(viaPolicy.path).toEqual(direct.path);
  });

  it("the policy seam is load-bearing — a passive side never acts and loses (D56)", () => {
    const grid = new TileGrid(8, 1);
    const hero = at("hero", "player", 0, 0, { attack: 20, maxHp: 40, hp: 40 });
    const foe = at("foe", "enemy", 4, 0, { attack: 3, maxHp: 12, hp: 12 });
    const battle = new Battle(grid, [hero, foe]);
    battle.seed();
    // A do-nothing policy: stand and pass. The pilot player should still win.
    const passive: BattlePolicy = { name: "passive", plan: (u) => ({ unit: u, path: [], destination: u.pos, target: null }) };

    let guard = 0;
    while (!battle.outcome().over && guard++ < 200) {
      const actor = battle.nextActor();
      if (!actor) break;
      battle.runPolicyTurn(actor, actor.side === "enemy" ? passive : PILOT_POLICY);
    }
    expect(battle.outcome().winner).toBe("player");
    expect(foe.alive).toBe(false); // the pilot actually closed and killed the passive foe
  });

  it("resolves a job skill and spends the caster's CT (Act cost)", () => {
    const grid = new TileGrid(8, 1);
    const hero = at("hero", "player", 0, 0, { attack: 8, jobId: "soldier" } as Partial<Unit>);
    const foe = at("foe", "enemy", 1, 0, { defense: 2, hp: 30, maxHp: 30 });
    const battle = new Battle(grid, [hero, foe]);
    hero.ct = 100;

    const powerStrike = { id: "ps", name: "PS", description: "", target: "enemy", range: 1, spend: "act", effect: { kind: "damage", bonusAttack: 6 } } as const;
    const out = battle.useSkill(hero, powerStrike, foe);

    expect(out.damage).toBe(12); // (8+6) - 2
    expect(foe.hp).toBe(18);
    expect(hero.ct).toBe(0); // 100 - ACT_COST
  });

  it("resolves a skill but leaves the turn open under commitTurn:false (D60 free-move)", () => {
    const grid = new TileGrid(8, 1);
    const hero = at("hero", "player", 0, 0, { attack: 8, jobId: "soldier" } as Partial<Unit>);
    const foe = at("foe", "enemy", 1, 0, { defense: 2, hp: 30, maxHp: 30 });
    const battle = new Battle(grid, [hero, foe]);
    hero.ct = 100;

    const powerStrike = { id: "ps", name: "PS", description: "", target: "enemy", range: 1, spend: "act", effect: { kind: "damage", bonusAttack: 6 } } as const;
    const out = battle.useSkill(hero, powerStrike, foe, { commitTurn: false });

    expect(out.damage).toBe(12); // effect still resolves
    expect(foe.hp).toBe(18);
    expect(hero.ct).toBe(100); // CT untouched — the render layer ends the turn itself
  });

  it("arms a skill cooldown under commitTurn:false without ending the turn (D60)", () => {
    const grid = new TileGrid(8, 1);
    const medic = at("medic", "player", 0, 0);
    const ally = at("ally", "player", 1, 0, { hp: 4, maxHp: 12 });
    const battle = new Battle(grid, [medic, ally]);
    medic.ct = 100;

    const mend = { id: "mend", name: "Mend", description: "", target: "ally", range: 1, spend: "act", cost: { cooldown: 200 }, effect: { kind: "heal", amount: 5 } } as const;
    battle.useSkill(medic, mend, ally, { commitTurn: false });

    expect(ally.hp).toBe(9); // healed
    expect(battle.canUseSkill(medic, mend)).toBe(false); // cooldown still armed
    expect(medic.ct).toBe(100); // but the turn is left open
  });
});

// Deployment-phase verbs through the one interpreter (D63 unification): the deploy
// turn shares Battle.apply, its log, and its undo stack with combat.
describe("Battle — deployment verbs (D63)", () => {
  const trapEffect: PlaceTrapEffect = { kind: "placeTrap", damage: 5 };

  it("digIn sets the stance, logs, and undoes cleanly", () => {
    const grid = new TileGrid(6, 1);
    const u = at("u", "player", 0, 0);
    const battle = new Battle(grid, [u]);
    battle.beginUndo();
    battle.digIn(u);
    expect(u.dugIn).toBe(true);
    expect(battle.log[battle.log.length - 1]).toEqual({ kind: "digIn", unit: "u" });
    battle.undo();
    expect(u.dugIn).toBe(false);
    expect(battle.log.length).toBe(0);
  });

  it("a move walks the unit, breaks dig-in, and is undoable (the deploy reposition is now a plain move)", () => {
    const grid = new TileGrid(6, 1);
    const u = at("u", "player", 0, 0, { dugIn: true });
    const battle = new Battle(grid, [u]);
    battle.enterDeploy(); // the deploy reposition uses the same move verb (D67)
    battle.beginUndo();
    battle.moveUnit(u, [{ col: 1, row: 0 }, { col: 2, row: 0 }]);
    expect(u.pos).toEqual({ col: 2, row: 0 });
    expect(u.dugIn).toBe(false); // moving broke the stance
    battle.undo();
    expect(u.pos).toEqual({ col: 0, row: 0 });
    expect(u.dugIn).toBe(true); // restored
  });

  it("placeTrap consumes a kit from the wired stash and registers the entity", () => {
    const grid = new TileGrid(6, 1);
    const trapper = at("t", "player", 0, 0);
    const battle = new Battle(grid, [trapper]);
    const stash = createInventory(6, { "trap-kit": 2 });
    battle.setStash(stash);

    const res = battle.placeTrap(trapper, { col: 0, row: 0 }, trapEffect, "ptrap-0", { id: "trap-kit", count: 1 });
    expect(res.ok && res.trap).toBeTruthy();
    expect(countOf(stash, "trap-kit")).toBe(1); // one kit spent (commit-side, #113)
    expect(battle.entities.all().some((e) => e.id === "ptrap-0")).toBe(true);
    expect(battle.log[battle.log.length - 1]).toMatchObject({ kind: "placeTrap", unit: "t", id: "ptrap-0" });
  });

  it("undoing a placeTrap refunds the kit and removes the entity", () => {
    const grid = new TileGrid(6, 1);
    const trapper = at("t", "player", 0, 0);
    const battle = new Battle(grid, [trapper]);
    const stash = createInventory(6, { "trap-kit": 1 });
    battle.setStash(stash);
    battle.beginUndo();
    battle.placeTrap(trapper, { col: 0, row: 0 }, trapEffect, "ptrap-0", { id: "trap-kit", count: 1 });
    expect(countOf(stash, "trap-kit")).toBe(0);
    battle.undo();
    expect(countOf(stash, "trap-kit")).toBe(1); // kit refunded
    expect(battle.entities.all().some((e) => e.id === "ptrap-0")).toBe(false);
  });

  it("placeTrap refuses with no stash wired and with no kit", () => {
    const grid = new TileGrid(6, 1);
    const trapper = at("t", "player", 0, 0);
    const battle = new Battle(grid, [trapper]);
    expect(battle.placeTrap(trapper, { col: 0, row: 0 }, trapEffect, "x").ok).toBe(false); // no stash
    battle.setStash(createInventory(6, {})); // empty
    expect(battle.placeTrap(trapper, { col: 0, row: 0 }, trapEffect, "x").ok).toBe(false); // no kit
    expect(battle.log.length).toBe(0); // a refused action never logs
  });

  it("capture binds the unit through the interpreter and logs it", () => {
    const grid = new TileGrid(6, 1);
    const caught = at("c", "player", 3, 0, { ct: 80 });
    const battle = new Battle(grid, [caught, at("e", "enemy", 5, 0)]);
    battle.capture(caught);
    expect(caught.captured).toBe(true);
    expect(caught.ct).toBe(0);
    expect(battle.log[battle.log.length - 1]).toEqual({ kind: "capture", unit: "c" });
  });

  it("replay drains the deploy prelude (up to the beginBattle boundary) before the combat turns", () => {
    const grid = new TileGrid(8, 1);
    const mk = () => [at("p", "player", 0, 0, { speed: 20 }), at("e", "enemy", 7, 0, { speed: 5 })];
    const [p, e] = mk();
    const battle = new Battle(grid, [p, e]);
    // A deploy prelude (reposition + dig in) up to the logged boundary, then a combat turn.
    battle.enterDeploy();
    battle.moveUnit(p, [{ col: 1, row: 0 }]);
    battle.digIn(p);
    battle.beginBattle(); // the pre-combat → combat boundary marker
    battle.seed();
    const actor = battle.nextActor()!;
    battle.endTurn(actor, { moved: false });

    const rebuilt = replay(grid, mk(), battle.log);
    const rp = rebuilt.units.find((u) => u.id === "p")!;
    expect(rp.pos).toEqual({ col: 1, row: 0 });
    // dig-in survived into combat (nothing cleared it), proving the prelude replayed.
    expect(rp.dugIn).toBe(true);
  });
});
