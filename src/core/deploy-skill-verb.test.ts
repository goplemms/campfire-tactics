/**
 * D67 increment 5 — the drained `deploySkill` verb (the F1 fix).
 *
 * A dual-context ability cast during Deployment must be a DEPLOY_KIND so replay drains it from
 * the leading deploy prelude *before* `battle.seed()` — otherwise it would be re-applied as a
 * post-seed combat action. Without this, "a movement ability functional in both contexts" is
 * either impossible (no cast path) or corrupts replay.
 */
import { describe, it, expect } from "vitest";
import { Battle, replay } from "./turn";
import { isDeployAction } from "./combat-actions";
import { effectiveMove } from "./combat";
import { TileGrid } from "./grid";
import { createUnit, type Side, type Unit } from "./units";
import type { SkillDef } from "./skills";

const DASH: SkillDef = {
  id: "dash",
  name: "Dash",
  description: "",
  phase: "battle",
  target: "self",
  range: 0,
  spend: "move",
  effect: { kind: "status", status: { id: "swift", name: "Swift", duration: 1, kind: "buff", data: { amount: 3 } } },
};

function pawn(id: string, col: number, side: Side = "player"): Unit {
  return createUnit({ id, side, pos: { col, row: 0 }, awareness: 2, speed: 10, maxHp: 20, attack: 5, defense: 1, moveRange: 3, sightRadius: 4 });
}

describe("deploySkill verb (D67 increment 5)", () => {
  it("is a deployment-phase (drained) verb", () => {
    expect(isDeployAction({ kind: "deploySkill", unit: "x", skill: DASH, target: "x" })).toBe(true);
  });

  it("resolves the ability's effect (Dash → Swift extends effectiveMove) and logs the verb", () => {
    const battle = new Battle(new TileGrid(8, 1), [pawn("scout", 0)]);
    const scout = battle.units[0];
    expect(effectiveMove(scout)).toBe(3);
    battle.deploySkill(scout, DASH, scout);
    expect(effectiveMove(scout)).toBe(6); // 3 + Swift 3
    expect(battle.log[battle.log.length - 1]).toMatchObject({ kind: "deploySkill", unit: "scout" });
  });

  it("replays byte-identically with a deploySkill in the deploy prelude (the drain holds)", () => {
    const grid = new TileGrid(8, 1);
    const battle = new Battle(grid, [pawn("a", 0), pawn("b", 6, "enemy")]);
    const [a] = battle.units;
    const initial = battle.units.map((u) => structuredClone(u));
    battle.deployMove(a, [{ col: 1, row: 0 }]); // deploy prelude (drained)
    battle.deploySkill(a, DASH, a);             // drained — applied before seed on replay
    battle.seed();
    const rebuilt = replay(grid, initial.map((u) => structuredClone(u)), battle.log);
    expect(rebuilt.units).toEqual(battle.units);
    expect(rebuilt.outcome()).toEqual(battle.outcome());
  });
});
