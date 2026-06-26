/**
 * D67 — one skill verb across both phases (was: the drained `deploySkill` verb).
 *
 * Casting a skill pre-combat and casting it in combat now go through the **same** `useSkill`
 * verb; the interpreter detects the Battle's `phase` and only the *commit* differs. In
 * **combat** a skill commits the turn (spends CT, arms its cooldown); in **pre-combat** it
 * resolves its effect off the deploy clock with **no** commit — so a heal / buff / Dash is
 * castable in staging without ending a turn or arming a cooldown. The effect resolution is
 * identical; this pins that split.
 */
import { describe, it, expect } from "vitest";
import { Battle } from "./turn";
import { effectiveMove } from "./combat";
import { onSkillCooldown, TURN_THRESHOLD } from "./clock";
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

const PLAIN_HEAL: SkillDef = { id: "mend", name: "Mend", description: "", phase: "battle", target: "ally", range: 2, spend: "act", effect: { kind: "heal", amount: 10 } };

/** A skill with a cooldown + an Act spend — to observe the combat commit (CT + cooldown). */
const GUARD_BREAK: SkillDef = {
  id: "guard-break", name: "Guard Break", description: "", phase: "battle", target: "enemy", range: 1, spend: "act",
  cost: { cooldown: 200 }, effect: { kind: "damage", bonusAttack: 3 },
};

function pawn(id: string, col: number, side: Side = "player"): Unit {
  return createUnit({ id, side, pos: { col, row: 0 }, awareness: 2, speed: 10, maxHp: 20, attack: 5, defense: 1, moveRange: 3, sightRadius: 4 });
}

describe("D67 — one skill verb, phase-aware commit", () => {
  it("resolves a self-buff in pre-combat (Dash → Swift extends effectiveMove), off the deploy clock", () => {
    const battle = new Battle(new TileGrid(8, 1), [pawn("scout", 0)]);
    battle.enterDeploy();
    const scout = battle.units[0];
    expect(effectiveMove(scout)).toBe(3);
    battle.useSkill(scout, DASH, scout);
    expect(effectiveMove(scout)).toBe(6); // 3 + Swift 3
    expect(battle.log[battle.log.length - 1]).toMatchObject({ kind: "skill", unit: "scout" });
  });

  it("resolves an ally-target heal cast pre-combat (support is dual-context)", () => {
    const battle = new Battle(new TileGrid(8, 1), [pawn("medic", 0), pawn("hurt", 1)]);
    battle.enterDeploy();
    const [medic, hurt] = battle.units;
    hurt.hp = 5;
    battle.useSkill(medic, PLAIN_HEAL, hurt);
    expect(hurt.hp).toBeGreaterThan(5); // healed, off the deploy clock
  });

  it("pre-combat resolves WITHOUT committing — no CT spent, no cooldown armed", () => {
    const battle = new Battle(new TileGrid(8, 1), [pawn("a", 0), pawn("foe", 1, "enemy")]);
    battle.enterDeploy();
    const [a, foe] = battle.units;
    a.ct = TURN_THRESHOLD; // a warm unit
    battle.useSkill(a, GUARD_BREAK, foe);
    expect(foe.hp).toBeLessThan(20); // the effect landed
    expect(a.ct).toBe(TURN_THRESHOLD); // ...but no turn was committed (no CT spent)
    expect(onSkillCooldown(a, GUARD_BREAK.id)).toBe(false); // ...and no cooldown armed
  });

  it("combat DOES commit the same cast — spends CT and arms the cooldown", () => {
    const battle = new Battle(new TileGrid(8, 1), [pawn("a", 0), pawn("foe", 1, "enemy")]);
    // default phase is combat
    const [a, foe] = battle.units;
    a.ct = TURN_THRESHOLD;
    battle.useSkill(a, GUARD_BREAK, foe); // commitTurn defaults true
    expect(foe.hp).toBeLessThan(20);
    expect(a.ct).toBeLessThan(TURN_THRESHOLD); // CT spent (the turn committed)
    expect(onSkillCooldown(a, GUARD_BREAK.id)).toBe(true); // cooldown armed
  });
});
