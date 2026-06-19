import { describe, it, expect } from "vitest";
import { Rng, streamFor } from "./rng";
import {
  generateEncounter,
  buildGrid,
  buildEnemies,
  enemyCount,
  GEN,
  type EncounterDef,
} from "./generation";

function gen(seed: string, index: number): EncounterDef {
  return generateEncounter(streamFor(seed, `enc:${index}`), index);
}

describe("generation — determinism", () => {
  it("same seed + index ⇒ identical encounter (map, roster, rewards)", () => {
    const a = gen("alpha", 0);
    const b = gen("alpha", 0);
    expect(a).toEqual(b);
  });

  it("different seeds diverge", () => {
    const a = gen("alpha", 0);
    const b = gen("omega", 0);
    expect(a).not.toEqual(b);
  });

  it("a fresh Rng with the same seed reproduces the sequence", () => {
    const r1 = new Rng("seq");
    const r2 = new Rng("seq");
    const seqA = [0, 1, 2].map((i) => generateEncounter(r1, i));
    const seqB = [0, 1, 2].map((i) => generateEncounter(r2, i));
    expect(seqA).toEqual(seqB);
  });
});

describe("generation — content", () => {
  it("enemy count ramps with index but is capped", () => {
    expect(enemyCount(0)).toBe(GEN.baseEnemies);
    expect(enemyCount(100)).toBe(GEN.maxEnemies);
    expect(enemyCount(4)).toBeGreaterThan(enemyCount(0));
  });

  it("produces a usable grid and living enemies on the right side", () => {
    const def = gen("content", 2);
    const grid = buildGrid(def);
    expect(grid.cols).toBe(def.cols);
    expect(grid.rows).toBe(def.rows);

    const enemies = buildEnemies(def);
    expect(enemies.length).toBe(enemyCount(2));
    for (const e of enemies) {
      expect(e.side).toBe("enemy");
      expect(e.alive).toBe(true);
      expect(e.pos.col).toBeGreaterThanOrEqual(def.cols - 2);
      expect(grid.inBounds(e.pos)).toBe(true);
    }
  });

  it("scales enemy stats and rewards upward over a run", () => {
    const early = gen("scale", 0);
    const late = gen("scale", 8);
    expect(late.reward.gold).toBeGreaterThan(early.reward.gold);
    // Later encounters are tougher (more or beefier enemies).
    const earlyHp = early.enemies.reduce((s, e) => s + e.maxHp, 0);
    const lateHp = late.enemies.reduce((s, e) => s + e.maxHp, 0);
    expect(lateHp).toBeGreaterThan(earlyHp);
  });

  it("rewards always include at least one material drop", () => {
    for (let i = 0; i < 5; i++) {
      const def = gen("drops", i);
      expect(def.reward.materials.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("splits loot: found gold + a sellable valuables drop (D61)", () => {
    for (let i = 0; i < 5; i++) {
      const def = gen("loot-split", i);
      expect(def.reward.gold).toBeGreaterThan(0); // found gold (the liquid baseline)
      const loot = def.reward.materials.find((m) => m.id === "valuables");
      expect(loot).toBeDefined(); // the illiquid half, sold at a market
      expect(loot!.count).toBeGreaterThan(0);
    }
  });

  it("assigns a valid encounter type", () => {
    const types = new Set<string>();
    for (let i = 0; i < 20; i++) types.add(gen("types", i).type);
    for (const t of types) expect(["open-field", "fortified"]).toContain(t);
  });
});
