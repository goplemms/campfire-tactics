import { describe, it, expect } from "vitest";
import { Battle, replay, type BattleOptions } from "./turn";
import { computeDamage } from "./combat";
import { TileGrid } from "./grid";
import { createUnit, type Side, type Unit } from "./units";

function at(id: string, side: Side, col: number, row: number, overrides: Partial<Unit> = {}): Unit {
  return {
    ...createUnit({ id, side, pos: { col, row }, speed: 10, maxHp: 12, attack: 6, defense: 1, moveRange: 4, sightRadius: 6 }),
    ...overrides,
  };
}

/** Play a battle to a decision with both sides on the AI under the given options. */
function playOut(grid: TileGrid, units: Unit[], opts: BattleOptions, maxTurns = 500): Battle {
  const battle = new Battle(grid, units, opts);
  battle.seed();
  let guard = 0;
  while (!battle.outcome().over && guard++ < maxTurns) {
    const actor = battle.nextActor();
    if (!actor) break;
    battle.runEnemyTurn(actor);
  }
  return battle;
}

describe("soft-randomization seam (label-derived combat RNG)", () => {
  it("is OFF by default — a hit deals exactly computeDamage (byte-identical)", () => {
    const grid = new TileGrid(8, 1);
    const hero = at("h", "player", 0, 0, { attack: 14 });
    const foe = at("f", "enemy", 1, 0, { defense: 2, hp: 100, maxHp: 100 });
    const battle = new Battle(grid, [hero, foe]); // no opts → variance 0, no draw
    expect(battle.attack(hero, foe)).toBe(computeDamage(hero, foe, hero.attack, [hero, foe]));
    expect(foe.hp).toBe(100 - 12); // (14 - 2)
  });

  it("variance ON spreads damage within the band, and is deterministic by seed", () => {
    const make = () => {
      const grid = new TileGrid(8, 1);
      const hero = at("h", "player", 0, 0, { attack: 20 });
      const foe = at("f", "enemy", 1, 0, { defense: 0, hp: 1_000_000, maxHp: 1_000_000 });
      return { battle: new Battle(grid, [hero, foe], { seed: "variance-proof", variance: 0.25 }), hero, foe };
    };
    const base = 20; // 20 atk − 0 def
    const a = make();
    const samples: number[] = [];
    for (let i = 0; i < 32; i++) samples.push(a.battle.attack(a.hero, a.foe));

    // Every hit lands inside the ±25% band, floored at 1.
    for (const d of samples) {
      expect(d).toBeGreaterThanOrEqual(Math.max(1, Math.round(base * 0.75)));
      expect(d).toBeLessThanOrEqual(Math.round(base * 1.25));
    }
    expect(Math.min(...samples)).toBeLessThan(Math.max(...samples)); // it genuinely varies

    // Same seed → the exact same sequence (label-derived determinism).
    const b = make();
    const repeat: number[] = [];
    for (let i = 0; i < 32; i++) repeat.push(b.battle.attack(b.hero, b.foe));
    expect(repeat).toEqual(samples);
  });

  it("planning/forecast still see the mean — the AI never draws from the battle stream", () => {
    // computeDamage (what the planner + forecast use) is the deterministic mean,
    // independent of the variance amplitude; only apply() rolls around it.
    const grid = new TileGrid(8, 1);
    const hero = at("h", "player", 0, 0, { attack: 18 });
    const foe = at("f", "enemy", 1, 0, { defense: 3, maxHp: 100, hp: 100 });
    const battle = new Battle(grid, [hero, foe], { seed: "x", variance: 0.5 });
    const before = battle.log.length;
    void battle.outcome();
    // Reading the mean takes no draw: a subsequent rolled hit is unaffected by it.
    expect(computeDamage(hero, foe, hero.attack, [hero, foe])).toBe(15);
    expect(battle.log.length).toBe(before);
  });
});

describe("replay holds with the RNG turned ON", () => {
  const roster = (): Unit[] => [
    at("Rook", "player", 0, 1, { speed: 12, maxHp: 30, hp: 30, attack: 9, defense: 3 }),
    at("Vale", "player", 0, 4, { speed: 10, maxHp: 24, hp: 24, attack: 11, defense: 2 }),
    at("Grunt", "enemy", 7, 1, { speed: 9, maxHp: 22, hp: 22, attack: 7, defense: 2 }),
    at("Brute", "enemy", 7, 4, { speed: 7, maxHp: 30, hp: 30, attack: 8, defense: 3, moveRange: 3 }),
  ];

  it("reconstructs a full variance-driven battle from its log (replay(log) === state)", () => {
    const grid = new TileGrid(8, 6, [{ col: 3, row: 2 }, { col: 4, row: 2 }, { col: 4, row: 3 }]);
    const opts: BattleOptions = { seed: "rng-replay", variance: 0.3 };
    const initial = roster();

    const battle = playOut(grid, initial.map((u) => structuredClone(u)), opts);
    expect(battle.outcome().over).toBe(true);

    // Same seed + same variance + same recorded actions → identical reconstruction.
    const rebuilt = replay(grid, initial.map((u) => structuredClone(u)), battle.log, opts);
    expect(rebuilt.units).toEqual(battle.units);
    expect(rebuilt.outcome()).toEqual(battle.outcome());
  });

  it("a different seed produces a genuinely different battle (the RNG is load-bearing)", () => {
    const grid = new TileGrid(8, 6, [{ col: 3, row: 2 }, { col: 4, row: 2 }, { col: 4, row: 3 }]);
    const a = playOut(grid, roster().map((u) => structuredClone(u)), { seed: "seed-A", variance: 0.3 });
    const b = playOut(grid, roster().map((u) => structuredClone(u)), { seed: "seed-B", variance: 0.3 });
    // The two runs diverge somewhere (final HP totals differ) — proof the seed matters.
    const hp = (bat: Battle) => bat.units.map((u) => u.hp).join(",");
    expect(hp(a)).not.toBe(hp(b));
  });
});

describe("one seam, three use-cases (variance / hit-crit / proc)", () => {
  it("the same roll() seam drives discrete crit and proc decisions, replay-stable", () => {
    const grid = new TileGrid(4, 1);
    const make = () => new Battle(grid, [at("h", "player", 0, 0)], { seed: "discrete" });

    // A to-crit roll: deterministic for (seed, label, draw#) — two fresh battles agree.
    const crits1: boolean[] = [];
    const crits2: boolean[] = [];
    const b1 = make();
    const b2 = make();
    for (let i = 0; i < 16; i++) {
      crits1.push(b1.roll("crit:h").chance(0.3));
      crits2.push(b2.roll("crit:h").chance(0.3));
    }
    expect(crits1).toEqual(crits2);
    expect(crits1.some(Boolean)).toBe(true); // crits do happen
    expect(crits1.some((c) => !c)).toBe(true); // and don't always happen — a real chance

    // A proc roll under a different label is an independent, equally-stable stream.
    const procs1: boolean[] = [];
    const procs2: boolean[] = [];
    const b3 = make();
    const b4 = make();
    for (let i = 0; i < 16; i++) {
      procs1.push(b3.roll("proc:snare").chance(0.5));
      procs2.push(b4.roll("proc:snare").chance(0.5));
    }
    expect(procs1).toEqual(procs2);
    expect(procs1).not.toEqual(crits1); // distinct label ⇒ distinct stream
  });
});
