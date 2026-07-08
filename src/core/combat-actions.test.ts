import { describe, it, expect } from "vitest";
import { Battle, replay } from "./turn";
import { commitsTurn } from "./combat-actions";
import { TileGrid } from "./grid";
import { createUnit, type Side, type Unit } from "./units";
import type { SkillDef } from "./skills";

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

/** Drive a battle to a decision with both sides on the AI, returning the battle. */
function playOut(grid: TileGrid, units: Unit[], maxTurns = 500): Battle {
  const battle = new Battle(grid, units);
  battle.seed();
  let guard = 0;
  while (!battle.outcome().over && guard++ < maxTurns) {
    const actor = battle.nextActor();
    if (!actor) break;
    battle.runEnemyTurn(actor);
  }
  return battle;
}

describe("Battle.apply — the single command interpreter", () => {
  it("routes a move through apply, appends it to the log, and mutates position", () => {
    const grid = new TileGrid(8, 1);
    const mover = at("m", "player", 0, 0);
    const battle = new Battle(grid, [mover]);

    const r = battle.apply({ kind: "move", unit: "m", path: [{ col: 1, row: 0 }, { col: 2, row: 0 }] });
    expect(r.ok).toBe(true);
    expect(mover.pos).toEqual({ col: 2, row: 0 });
    expect(battle.log).toEqual([{ kind: "move", unit: "m", path: [{ col: 1, row: 0 }, { col: 2, row: 0 }] }]);
  });

  it("the public methods are thin wrappers that log one action each", () => {
    const grid = new TileGrid(8, 1);
    const hero = at("hero", "player", 0, 0, { attack: 20 });
    const foe = at("foe", "enemy", 1, 0, { maxHp: 30, hp: 30 });
    const battle = new Battle(grid, [hero, foe]);

    battle.moveUnit(hero, [{ col: 0, row: 0 }]); // a no-op step, still a logged move
    const dmg = battle.attack(hero, foe);
    battle.endTurn(hero, { acted: true });

    expect(dmg).toBeGreaterThan(0);
    expect(battle.log.map((a) => a.kind)).toEqual(["move", "attack", "endTurn"]);
  });

  it("refuses a cooling-down skill without logging it (fixture skill via the injectable lookup)", () => {
    const grid = new TileGrid(8, 1);
    const medic = at("medic", "player", 0, 0);
    const ally = at("ally", "player", 1, 0, { hp: 4, maxHp: 20 });
    const mend: SkillDef = { id: "mend-fixture", name: "Mend", description: "", phase: "battle", target: "ally", range: 1, spend: "act", cost: { cooldown: 200 }, effect: { kind: "heal", amount: 5 } };
    // A raw apply carries only the skill id (R1 #111); the fixture def resolves
    // through the injectable lookup (the D65 pattern) — never the global registry.
    const battle = new Battle(grid, [medic, ally], { skills: (id) => (id === mend.id ? mend : undefined) });

    const first = battle.apply({ kind: "skill", unit: "medic", skill: mend.id, target: "ally", commitTurn: false });
    expect(first.ok).toBe(true);
    const second = battle.apply({ kind: "skill", unit: "medic", skill: mend.id, target: "ally", commitTurn: false });
    expect(second).toEqual({ ok: false, reason: "cooling down" });
    // Only the first (successful) skill is recorded — the refusal is not logged.
    expect(battle.log.filter((a) => a.kind === "skill")).toHaveLength(1);
  });

  it("a forced-move shove logs the skill once, not its internal steps", () => {
    const grid = new TileGrid(8, 1);
    const knight = at("k", "player", 0, 0);
    const foe = at("f", "enemy", 1, 0);
    const battle = new Battle(grid, [knight, foe]);
    const shove: SkillDef = { id: "shove", name: "Shove", description: "", phase: "battle", target: "enemy", range: 1, spend: "act", effect: { kind: "forced-move", tiles: 2 } };

    battle.useSkill(knight, shove, foe, { commitTurn: false });
    expect(foe.pos).toEqual({ col: 3, row: 0 }); // pushed two tiles
    // The shove is one action; its internal (forced) moves are not separately logged.
    expect(battle.log.map((a) => a.kind)).toEqual(["skill"]);
  });

  it("an AI skill turn commits without a trailing endTurn (no double-log)", () => {
    const grid = new TileGrid(8, 1);
    // A snare-carrying enemy in range of a player → the AI uses its debuff ability.
    const enemy = at("e", "enemy", 1, 0, { jobId: "snare-trapper", heldJobs: ["snare-trapper"] });
    const player = at("p", "player", 2, 0);
    const battle = new Battle(grid, [enemy, player]);
    battle.seed();
    enemy.ct = 100;

    const before = battle.log.length;
    battle.runEnemyTurn(enemy);
    const logged = battle.log.slice(before);
    // The enemy used its snare ability — the skill commits the turn itself, so the
    // turn ends with no trailing endTurn action (proving commitSkill doesn't re-log).
    expect(logged.some((a) => a.kind === "skill")).toBe(true);
    expect(logged.some((a) => a.kind === "endTurn")).toBe(false);
  });
});

describe("commitsTurn", () => {
  it("classifies which actions spend the turn's CT", () => {
    expect(commitsTurn({ kind: "move", unit: "u", path: [] })).toBe(false);
    expect(commitsTurn({ kind: "attack", unit: "u", target: "t" })).toBe(false);
    expect(commitsTurn({ kind: "skill", unit: "u", skill: "s", target: "t", commitTurn: false })).toBe(false);
    expect(commitsTurn({ kind: "skill", unit: "u", skill: "s", target: "t" })).toBe(true);
    expect(commitsTurn({ kind: "cleave", unit: "u", skill: "s", dir: { col: 1, row: 0 } })).toBe(true);
    expect(commitsTurn({ kind: "useHeal", unit: "u", skill: "s", target: "t", herbId: "salve", commitTurn: false })).toBe(false);
    expect(commitsTurn({ kind: "useHeal", unit: "u", skill: "s", target: "t", herbId: "salve" })).toBe(true);
    expect(commitsTurn({ kind: "rescue", target: "t", unit: "u" })).toBe(false);
    expect(commitsTurn({ kind: "endTurn", unit: "u", spend: {} })).toBe(true);
  });
});

describe("replay(initial, log) === state — the combat-log invariant", () => {
  it("rebuilds a 1-on-1 skirmish identically from its action log", () => {
    const grid = new TileGrid(8, 1);
    const initial = [
      at("hero", "player", 0, 0, { attack: 20, maxHp: 40, hp: 40 }),
      at("foe", "enemy", 4, 0, { attack: 3, maxHp: 12, hp: 12 }),
    ];
    const battle = playOut(grid, initial.map((u) => structuredClone(u)));
    expect(battle.outcome().over).toBe(true);
    expect(battle.log.length).toBeGreaterThan(0);

    const rebuilt = replay(grid, initial.map((u) => structuredClone(u)), battle.log);
    expect(rebuilt.units).toEqual(battle.units);
    expect(rebuilt.outcome()).toEqual(battle.outcome());
  });

  it("rebuilds the full BattleScene roster (both sides AI) identically", () => {
    const grid = new TileGrid(8, 6, [
      { col: 3, row: 2 },
      { col: 4, row: 2 },
      { col: 4, row: 3 },
    ]);
    const initial = [
      at("Rook", "player", 0, 1, { speed: 12, maxHp: 30, hp: 30, attack: 9, defense: 3 }),
      at("Vale", "player", 0, 4, { speed: 10, maxHp: 24, hp: 24, attack: 11, defense: 2 }),
      at("Grunt", "enemy", 7, 1, { speed: 9, maxHp: 22, hp: 22, attack: 7, defense: 2 }),
      at("Brute", "enemy", 7, 4, { speed: 7, maxHp: 30, hp: 30, attack: 8, defense: 3, moveRange: 3 }),
    ];
    const battle = playOut(grid, initial.map((u) => structuredClone(u)));
    expect(battle.outcome().over).toBe(true);

    const rebuilt = replay(grid, initial.map((u) => structuredClone(u)), battle.log);
    expect(rebuilt.units).toEqual(battle.units);
    expect(rebuilt.outcome()).toEqual(battle.outcome());
  });

  it("replaying a partial log reproduces the mid-battle state (not just the end)", () => {
    const grid = new TileGrid(8, 1);
    const initial = [
      at("hero", "player", 0, 0, { attack: 20, maxHp: 40, hp: 40 }),
      at("foe", "enemy", 4, 0, { attack: 3, maxHp: 12, hp: 12 }),
    ];
    const battle = playOut(grid, initial.map((u) => structuredClone(u)));

    // Truncate the log at a turn boundary (the first committing action) and replay it.
    const cut = battle.log.findIndex((a) => commitsTurn(a)) + 1;
    const partial = battle.log.slice(0, cut);
    const mid = replay(grid, initial.map((u) => structuredClone(u)), partial);
    expect(mid.log).toEqual(partial); // the rebuilt log matches the slice we fed it
  });
});
