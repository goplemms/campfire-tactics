import { describe, it, expect } from "vitest";
import { createUnit, type Side, type Unit } from "./units";
import { canSeeUnit } from "./vision";
import { planEnemyTurn } from "./ai";
import { TileGrid } from "./grid";
import { applyStatus, stealth } from "./status";

function u(id: string, side: Side, col: number, row: number, over: Partial<Parameters<typeof createUnit>[0]> = {}): Unit {
  return createUnit({
    id, side, pos: { col, row },
    speed: 10, maxHp: 20, attack: 8, defense: 2, moveRange: 4, sightRadius: 6, attackRange: 1,
    ...over,
  });
}

describe("Stealth — Hidden Passage (D68)", () => {
  it("a non-stealthed unit within sight is seen", () => {
    const scout = u("s", "player", 5, 5);
    const enemy = u("e", "enemy", 0, 0);
    expect(canSeeUnit([scout, enemy], "enemy", scout)).toBe(true);
  });

  it("a stealthed unit is unseen by a distant enemy (slips the army)", () => {
    const scout = u("s", "player", 5, 5);
    applyStatus(scout, stealth());
    const enemy = u("e", "enemy", 0, 0); // within sight radius, not adjacent
    expect(canSeeUnit([scout, enemy], "enemy", scout)).toBe(false);
  });

  it("but a directly-adjacent enemy still spots it", () => {
    const scout = u("s", "player", 5, 5);
    applyStatus(scout, stealth());
    const enemy = u("e", "enemy", 5, 4); // orthogonally adjacent
    expect(canSeeUnit([scout, enemy], "enemy", scout)).toBe(true);
  });

  it("a diagonal enemy does NOT spot it (spotting is orthogonal, like combat adjacency)", () => {
    const scout = u("s", "player", 5, 5);
    applyStatus(scout, stealth());
    const enemy = u("e", "enemy", 4, 4); // diagonal — manhattan 2
    expect(canSeeUnit([scout, enemy], "enemy", scout)).toBe(false);
  });

  it("the enemy AI won't target a stealthed foe it can't reach adjacency on", () => {
    const grid = new TileGrid(12, 3);
    const archer = u("a", "enemy", 0, 1, { attackRange: 6, moveRange: 0 }); // rooted ranged
    const scout = u("s", "player", 4, 1);
    applyStatus(scout, stealth());
    const plan = planEnemyTurn(archer, [archer, scout], grid);
    expect(plan.target).toBeNull(); // unseen → no shot, even though in range
  });

  it("the same archer DOES target the scout once it drops Stealth", () => {
    const grid = new TileGrid(12, 3);
    const archer = u("a", "enemy", 0, 1, { attackRange: 6, moveRange: 0 });
    const scout = u("s", "player", 4, 1); // no Stealth
    const plan = planEnemyTurn(archer, [archer, scout], grid);
    expect(plan.target?.id).toBe("s");
  });
});
