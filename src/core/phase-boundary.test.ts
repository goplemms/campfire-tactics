/**
 * D67 — the pre-combat → combat phase boundary (the unified-skill foundation).
 *
 * The Battle tracks its `phase` ("deploy" | "combat"), and a single logged `beginBattle`
 * action marks the transition. `replay()` drains the deploy prelude up to that marker, so
 * the phases are delimited explicitly in the log (rather than inferred from deploy-verb
 * `kind`s). This pins: the phase flips on the marker, and a staged battle that crossed the
 * boundary replays byte-identically through it.
 *
 * Pure logic: no Phaser, no DOM.
 */
import { describe, it, expect } from "vitest";
import { Battle, replay } from "./turn";
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

describe("D67 phase boundary", () => {
  it("a bare battle defaults to the combat phase (so combat-driving tests are unchanged)", () => {
    const battle = new Battle(new TileGrid(8, 1), [pawn("a", 0)]);
    expect(battle.phase).toBe("combat");
  });

  it("enterDeploy → beginBattle flips the phase and logs the boundary", () => {
    const battle = new Battle(new TileGrid(8, 1), [pawn("a", 0), pawn("b", 6, "enemy")]);
    battle.enterDeploy();
    expect(battle.phase).toBe("deploy");
    battle.beginBattle();
    expect(battle.phase).toBe("combat");
    expect(battle.log[battle.log.length - 1]).toEqual({ kind: "beginBattle" });
  });

  it("replays byte-identically across the logged beginBattle boundary", () => {
    const grid = new TileGrid(8, 1);
    const battle = new Battle(grid, [pawn("a", 0), pawn("b", 6, "enemy")]);
    const [a] = battle.units;
    const initial = battle.units.map((u) => structuredClone(u));
    // A deploy prelude, the logged boundary, then a driven combat turn.
    battle.enterDeploy();
    battle.deployMove(a, [{ col: 1, row: 0 }]);
    battle.deploySkill(a, DASH, a);
    battle.beginBattle();
    battle.seed();
    const actor = battle.nextActor();
    if (actor) battle.endTurn(actor, { moved: false, acted: false });

    const rebuilt = replay(grid, initial.map((u) => structuredClone(u)), battle.log);
    expect(rebuilt.units).toEqual(battle.units);
    expect(rebuilt.phase).toBe("combat");
    expect(rebuilt.outcome()).toEqual(battle.outcome());
  });
});
