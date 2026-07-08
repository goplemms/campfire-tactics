import { describe, it, expect } from "vitest";
import { Battle, replay } from "./turn";
import { planEnemyTurn } from "./ai";
import { TileGrid } from "./grid";
import { createUnit, type Side, type Unit } from "./units";
import { createInventory, countOf } from "./inventory";
import type { SkillDef } from "./skills";

function at(id: string, side: Side, col: number, row: number, overrides: Partial<Unit> = {}): Unit {
  return {
    ...createUnit({ id, side, pos: { col, row }, speed: 10, maxHp: 12, attack: 6, defense: 1, moveRange: 4, sightRadius: 6 }),
    ...overrides,
  };
}

/** A comparable deep snapshot of the roster's mutable state. */
const snap = (battle: Battle) => battle.units.map((u) => structuredClone(u));

describe("Battle undo — turn-scoped take-back on the action log (Phase 2)", () => {
  it("is disarmed by default — no checkpoints, nothing to undo", () => {
    const grid = new TileGrid(8, 1);
    const hero = at("h", "player", 0, 0);
    const battle = new Battle(grid, [hero]);
    battle.moveUnit(hero, [{ col: 1, row: 0 }]);
    expect(battle.canUndo()).toBe(false);
    expect(battle.undo()).toBeNull();
    expect(battle.undoDepth()).toBe(0);
  });

  it("undo restores the exact pre-action state and trims the log (a move)", () => {
    const grid = new TileGrid(8, 1);
    const hero = at("hero", "player", 0, 0);
    const foe = at("foe", "enemy", 7, 0);
    const battle = new Battle(grid, [hero, foe]);
    battle.seed();
    battle.beginUndo();

    const before = snap(battle);
    battle.moveUnit(hero, [{ col: 1, row: 0 }, { col: 2, row: 0 }]);
    expect(hero.pos).toEqual({ col: 2, row: 0 });
    expect(battle.canUndo()).toBe(true);

    const undone = battle.undo();
    expect(undone).toEqual({ kind: "move", unit: "hero", path: [{ col: 1, row: 0 }, { col: 2, row: 0 }] });
    expect(snap(battle)).toEqual(before); // byte-for-byte back to before the move
    expect(battle.log).toEqual([]);
    expect(battle.canUndo()).toBe(false);
  });

  it("undoes a killing blow — the foe's HP and alive flag come back (the take-back)", () => {
    const grid = new TileGrid(8, 1);
    const hero = at("hero", "player", 0, 0, { attack: 50 });
    const foe = at("foe", "enemy", 1, 0, { hp: 10, maxHp: 10 });
    const battle = new Battle(grid, [hero, foe]);
    battle.beginUndo();

    const before = snap(battle);
    const dmg = battle.attack(hero, foe);
    expect(dmg).toBeGreaterThanOrEqual(foe.maxHp);
    expect(foe.alive).toBe(false);

    battle.undo();
    expect(foe.alive).toBe(true);
    expect(foe.hp).toBe(10);
    expect(snap(battle)).toEqual(before);
  });

  it("peels multiple actions back one at a time, then bottoms out at the turn start", () => {
    const grid = new TileGrid(8, 1);
    const hero = at("hero", "player", 0, 0, { attack: 8 });
    const foe = at("foe", "enemy", 3, 0, { hp: 40, maxHp: 40 });
    const battle = new Battle(grid, [hero, foe]);
    battle.beginUndo();
    const start = snap(battle);

    battle.moveUnit(hero, [{ col: 1, row: 0 }, { col: 2, row: 0 }]);
    const afterMove = snap(battle);
    battle.attack(hero, foe);
    expect(battle.undoDepth()).toBe(2);

    expect(battle.undo()?.kind).toBe("attack");
    expect(snap(battle)).toEqual(afterMove); // attack reverted, move stands
    expect(battle.undo()?.kind).toBe("move");
    expect(snap(battle)).toEqual(start); // move reverted too — back to turn start
    expect(battle.undo()).toBeNull();
  });

  it("undoAll returns to the turn start and reports the undone actions newest-first", () => {
    const grid = new TileGrid(8, 1);
    const hero = at("hero", "player", 0, 0, { attack: 8 });
    const foe = at("foe", "enemy", 2, 0, { hp: 40, maxHp: 40 });
    const battle = new Battle(grid, [hero, foe]);
    battle.beginUndo();
    const start = snap(battle);

    battle.moveUnit(hero, [{ col: 1, row: 0 }]);
    battle.attack(hero, foe);
    const undone = battle.undoAll();
    expect(undone.map((a) => a.kind)).toEqual(["attack", "move"]);
    expect(snap(battle)).toEqual(start);
    expect(battle.log).toEqual([]);
  });

  it("a refused action (skill on cooldown) records no checkpoint", () => {
    const grid = new TileGrid(8, 1);
    const medic = at("medic", "player", 0, 0);
    const ally = at("ally", "player", 1, 0, { hp: 4, maxHp: 20 });
    const battle = new Battle(grid, [medic, ally]);
    const mend: SkillDef = { id: "mend", name: "Mend", description: "", phase: "battle", target: "ally", range: 1, spend: "act", cost: { cooldown: 200 }, effect: { kind: "heal", amount: 5 } };
    battle.beginUndo();

    battle.useSkill(medic, mend, ally, { commitTurn: false }); // ok
    expect(battle.undoDepth()).toBe(1);
    battle.useSkill(medic, mend, ally, { commitTurn: false }); // refused (cooling down)
    expect(battle.undoDepth()).toBe(1); // no checkpoint for the refusal
  });

  it("undoing a useHeal refunds the herb and rolls back the heal, cooldown, and CT (#111)", () => {
    const grid = new TileGrid(8, 1);
    const medic = at("medic", "player", 0, 0, { jobId: "medic", primaryJob: "medic" } as Partial<Unit>);
    const ally = at("ally", "player", 1, 0, { hp: 4, maxHp: 20 });
    const battle = new Battle(grid, [medic, ally]);
    medic.ct = 100;
    const inv = createInventory(8, { salve: 1 });
    const heal: SkillDef = { id: "heal", name: "Heal", description: "", phase: "battle", target: "ally", range: 1, spend: "act", cost: { cooldown: 200 }, effect: { kind: "med-heal" } };
    battle.beginUndo();

    const before = snap(battle);
    const out = battle.useHeal(medic, heal, ally, "salve", inv);
    expect(out.healed).toBeGreaterThan(0);
    expect(countOf(inv, "salve")).toBe(0); // consumed
    expect(medic.ct).toBe(0); // the heal committed the turn (Act spend)
    expect(battle.log[battle.log.length - 1]).toMatchObject({ kind: "useHeal", unit: "medic", target: "ally", herbId: "salve" });

    const undone = battle.undo();
    expect(undone?.kind).toBe("useHeal");
    expect(countOf(inv, "salve")).toBe(1); // herb refunded (the checkpoint's stash snapshot)
    expect(medic.ct).toBe(100); // turn commit rolled back
    expect(battle.canUseSkill(medic, heal)).toBe(true); // cooldown disarmed
    expect(snap(battle)).toEqual(before);
    expect(battle.log).toEqual([]);
  });

  it("endUndo drops the history (no take-back across the turn boundary)", () => {
    const grid = new TileGrid(8, 1);
    const hero = at("h", "player", 0, 0);
    const battle = new Battle(grid, [hero]);
    battle.beginUndo();
    battle.moveUnit(hero, [{ col: 1, row: 0 }]);
    expect(battle.canUndo()).toBe(true);
    battle.endUndo();
    expect(battle.canUndo()).toBe(false);
    expect(battle.undo()).toBeNull();
  });
});

describe("undo composes with the in-flight clock and the RNG seam", () => {
  it("undoes an in-flight charge — the scheduled effect is rolled off the timeline", () => {
    const grid = new TileGrid(4, 1);
    const medic = at("m", "player", 0, 0);
    const ally = at("a", "player", 1, 0, { hp: 1, maxHp: 40 });
    const battle = new Battle(grid, [medic, ally]);
    const charged: SkillDef = { id: "mend-slow", name: "Slow Mend", description: "", phase: "battle", target: "ally", range: 1, spend: "act", cost: { charge: 50 }, effect: { kind: "heal", amount: 16 } };
    battle.beginUndo();

    battle.useSkill(medic, charged, ally, { commitTurn: false });
    expect(battle.clock.pendingEffects()).toBe(1);
    expect(battle.clock.isCharging(medic)).toBe(true);

    battle.undo();
    expect(battle.clock.pendingEffects()).toBe(0); // the charge never happened
    expect(battle.clock.isCharging(medic)).toBe(false);
  });

  it("is faithful with damage variance ON — re-doing an undone hit re-rolls identically", () => {
    const grid = new TileGrid(8, 1);
    const hero = at("hero", "player", 0, 0, { attack: 20 });
    const foe = at("foe", "enemy", 1, 0, { defense: 0, hp: 100, maxHp: 100 });
    const battle = new Battle(grid, [hero, foe], { seed: "undo-rng", variance: 0.3 });
    battle.beginUndo();

    const first = battle.attack(hero, foe);
    battle.undo(); // restores foe.hp AND the RNG draw cursor
    const second = battle.attack(hero, foe);
    expect(second).toBe(first); // same draw# ⇒ same roll ⇒ same damage
    expect(foe.hp).toBe(100 - first);
  });
});

describe("undo keeps the log canonical (cross-check against replay)", () => {
  it("replay(log) === state after a battle whose player turns undo mid-turn", () => {
    const grid = new TileGrid(8, 1);
    const initial = [
      at("hero", "player", 0, 0, { attack: 20, maxHp: 40, hp: 40 }),
      at("foe", "enemy", 7, 0, { attack: 3, maxHp: 24, hp: 24 }),
    ];
    const battle = new Battle(grid, initial.map((u) => structuredClone(u)));
    battle.seed();

    let guard = 0;
    while (!battle.outcome().over && guard++ < 200) {
      const actor = battle.nextActor();
      if (!actor) break;
      if (actor.side === "enemy") {
        battle.runEnemyTurn(actor);
        continue;
      }
      // A player turn that dithers: take the planned move + strike, take the strike
      // back, then strike again — the log must end up as if the dithering never was.
      const plan = planEnemyTurn(actor, battle.units, grid);
      const acted = Boolean(plan.target?.alive);
      battle.beginUndo();
      if (plan.path.length > 0) battle.moveUnit(actor, plan.path);
      if (acted) {
        battle.attack(actor, plan.target!);
        battle.undo();
        battle.attack(actor, plan.target!);
      }
      battle.endTurn(actor, { moved: plan.path.length > 0, acted });
      battle.endUndo();
    }

    expect(battle.outcome().over).toBe(true);
    const rebuilt = replay(grid, initial.map((u) => structuredClone(u)), battle.log);
    expect(rebuilt.units).toEqual(battle.units);
  });
});
