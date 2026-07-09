import { describe, it, expect } from "vitest";
import { Battle } from "./turn";
import { TileGrid } from "./grid";
import { createUnit, type Side, type Unit } from "./units";
import { computeDamage, BROTHER } from "./combat";
import { stampPassives } from "./jobs";
import { SOLDIER_JOB } from "./jobs-data/combat";
import { resolveSkill } from "./skills";
import { hasStatus, statusAmount, GUARDED, EXPOSED } from "./status";

function mk(
  id: string,
  side: Side,
  col: number,
  row: number,
  over: Partial<Parameters<typeof createUnit>[0]> = {},
): Unit {
  return createUnit({
    id,
    side,
    pos: { col, row },
    speed: 10,
    maxHp: 30,
    attack: 8,
    defense: 2,
    moveRange: 4,
    sightRadius: 5,
    attackRange: 1,
    ...over,
  });
}

describe("Soldier — the formation kit (D66)", () => {
  it("Brother-in-arms adds +damage per adjacent ally, capped at the max", () => {
    const s = mk("s", "player", 2, 2, { attack: 10, jobId: "soldier" });
    stampPassives(s); // stamps brotherInArms: 1
    const foe = mk("e", "enemy", 8, 8, { defense: 0 }); // far → no flank interferes

    // No ally beside it → no bonus.
    expect(computeDamage(s, foe, s.attack, [s, foe])).toBe(10);

    // Two allies adjacent → +2.
    const a1 = mk("a1", "player", 1, 2);
    const a2 = mk("a2", "player", 3, 2);
    expect(computeDamage(s, foe, s.attack, [s, foe, a1, a2])).toBe(12);

    // All four orthogonal neighbours are allies, but the bonus caps at maxAllies.
    const a3 = mk("a3", "player", 2, 1);
    const a4 = mk("a4", "player", 2, 3);
    expect(computeDamage(s, foe, s.attack, [s, foe, a1, a2, a3, a4])).toBe(10 + BROTHER.maxAllies);
  });

  it("Brother-in-arms only fires for the bearer", () => {
    const plain = mk("p", "player", 2, 2, { attack: 10 }); // no Soldier passive stamped
    const foe = mk("e", "enemy", 8, 8, { defense: 0 });
    const ally = mk("a1", "player", 1, 2);
    expect(computeDamage(plain, foe, plain.attack, [plain, foe, ally])).toBe(10);
  });

  it("Debilitating Strike deals +3 and leaves the foe Exposed", () => {
    const s = mk("s", "player", 0, 0, { attack: 10, jobId: "soldier" });
    const foe = mk("e", "enemy", 0, 1, { defense: 0, maxHp: 40, hp: 40 });
    const skill = SOLDIER_JOB.skills.find((sk) => sk.id === "debilitating-strike")!;

    const out = resolveSkill(skill, s, foe, undefined, [s, foe]);
    expect(out.damage).toBe(13); // 10 base + 3 bonus (no flank: lone attacker)
    expect(hasStatus(foe, EXPOSED)).toBe(true);
    expect(out.status).toBe(EXPOSED);
  });

  it("Turtle Formation braces adjacent allies (AoE Defend) — not foes or distant allies", () => {
    const grid = new TileGrid(10, 10);
    const s = mk("s", "player", 2, 2, { jobId: "soldier" });
    const near = mk("near", "player", 1, 2); // adjacent ally → braced
    const far = mk("far", "player", 5, 5); // distant ally → untouched
    const foe = mk("e", "enemy", 2, 1); // adjacent foe → never braced
    const battle = new Battle(grid, [s, near, far, foe]);

    battle.resolveGuardAllies(s, 2, 1);

    expect(hasStatus(near, GUARDED)).toBe(true);
    expect(statusAmount(near, GUARDED)).toBe(2);
    expect(hasStatus(far, GUARDED)).toBe(false);
    expect(hasStatus(foe, GUARDED)).toBe(false);
  });
});
