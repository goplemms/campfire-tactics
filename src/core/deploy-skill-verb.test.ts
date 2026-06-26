/**
 * D67 — one skill verb across both phases (was: the drained `deploySkill` verb).
 *
 * Casting a skill pre-combat and casting it in combat now go through the **same** `useSkill`
 * verb; the interpreter detects the Battle's `phase` and only the *turn* differs (D67 W5).
 * Both phases **arm the skill's cooldown** — an ability used in staging is genuinely used,
 * cooling toward combat. In **combat** the cast also commits the turn (spends CT); in
 * **pre-combat** the deploy clock owns the turn, so no CT is spent here (the scene commits it
 * at End Turn) — a heal / buff / Dash is still castable in staging without ending a turn. The
 * effect resolution is identical; this pins that split.
 */
import { describe, it, expect } from "vitest";
import { Battle } from "./turn";
import { effectiveMove } from "./combat";
import { onSkillCooldown, TURN_THRESHOLD } from "./clock";
import { TileGrid } from "./grid";
import { createUnit, type Side, type Unit } from "./units";
import { isValidSkillTarget, type SkillDef } from "./skills";

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

/** An attack with a cooldown — combat-only (the engagement invariant refuses it pre-combat). */
const GUARD_BREAK: SkillDef = {
  id: "guard-break", name: "Guard Break", description: "", phase: "battle", target: "enemy", range: 1, spend: "act",
  cost: { cooldown: 200 }, effect: { kind: "damage", bonusAttack: 3 },
};

/** A heal with a cooldown — **dual-context** support: castable in either phase, to observe
 *  the turn split (both arm the cooldown; combat also spends CT, pre-combat doesn't). */
const MENDER: SkillDef = {
  id: "mender", name: "Mender", description: "", phase: "battle", target: "ally", range: 2, spend: "act",
  cost: { cooldown: 200 }, effect: { kind: "heal", amount: 10 },
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

  it("pre-combat arms the cooldown but doesn't spend CT — the deploy clock owns the turn (W5)", () => {
    const battle = new Battle(new TileGrid(8, 1), [pawn("medic", 0), pawn("hurt", 1)]);
    battle.enterDeploy();
    const [medic, hurt] = battle.units;
    hurt.hp = 5;
    medic.ct = TURN_THRESHOLD; // a warm unit
    battle.useSkill(medic, MENDER, hurt);
    expect(hurt.hp).toBeGreaterThan(5); // the heal landed
    expect(medic.ct).toBe(TURN_THRESHOLD); // ...no CT spent here (the scene ends the deploy turn)
    expect(onSkillCooldown(medic, MENDER.id)).toBe(true); // ...but the cooldown IS armed (used is used)
  });

  it("combat ALSO ends the turn on the same dual-context cast — spends CT (and arms the cooldown)", () => {
    const battle = new Battle(new TileGrid(8, 1), [pawn("medic", 0), pawn("hurt", 1)]);
    // default phase is combat
    const [medic, hurt] = battle.units;
    hurt.hp = 5;
    medic.ct = TURN_THRESHOLD;
    battle.useSkill(medic, MENDER, hurt); // commitTurn defaults true
    expect(hurt.hp).toBeGreaterThan(5);
    expect(medic.ct).toBeLessThan(TURN_THRESHOLD); // CT spent (the turn committed)
    expect(onSkillCooldown(medic, MENDER.id)).toBe(true); // cooldown armed (as in deploy)
  });

  it("conceals the enemy roster in pre-combat so it isn't a valid target — revealed when battle opens (W6)", () => {
    const battle = new Battle(new TileGrid(8, 1), [pawn("a", 0), pawn("foe", 1, "enemy")]);
    const [a, foe] = battle.units;
    // Combat (the default phase): the foe is engaged — a valid in-range target.
    expect(foe.concealed).toBeFalsy();
    expect(isValidSkillTarget(GUARD_BREAK, a, foe)).toBe(true);
    // Pre-combat: the enemy roster is concealed — pre-positioned but not yet engageable, so
    // there is simply no one to attack (the engagement invariant as board state, not a ban).
    battle.enterDeploy();
    expect(foe.concealed).toBe(true);
    expect(isValidSkillTarget(GUARD_BREAK, a, foe)).toBe(false);
    // Allies are never concealed — support still finds its target in staging.
    expect(a.concealed).toBeFalsy();
    // The encounter engages: the veil lifts and the foe is a target again.
    battle.beginBattle();
    expect(foe.concealed).toBe(false);
    expect(isValidSkillTarget(GUARD_BREAK, a, foe)).toBe(true);
  });

  it("an attack in pre-combat finds no engageable target (the foe is concealed) — refused, nothing lands (W7)", () => {
    const battle = new Battle(new TileGrid(8, 1), [pawn("a", 0), pawn("foe", 1, "enemy")]);
    battle.enterDeploy(); // conceals the enemy roster
    const [a, foe] = battle.units;
    // No per-phase ban any more (W7): the cast is refused because the foe isn't engageable —
    // the stealth/alarm invariant as board state. (A keep-assault would leave the foe
    // un-concealed, and the same attack would land — that's the point of the substrate.)
    battle.useSkill(a, GUARD_BREAK, foe);
    expect(foe.hp).toBe(20); // the attack never landed in staging (stealth preserved)
    expect(battle.log.length).toBe(0); // a refused action isn't logged
  });

  it("the SAME attack lands once the foe is engageable (the keep-assault path — un-concealed in pre-combat)", () => {
    const battle = new Battle(new TileGrid(8, 1), [pawn("a", 0), pawn("foe", 1, "enemy")]);
    battle.enterDeploy();
    const [a, foe] = battle.units;
    foe.concealed = false; // a scenario stages this defender as a present, targetable foe
    battle.useSkill(a, GUARD_BREAK, foe); // no ban, an engageable target → it resolves pre-combat
    expect(foe.hp).toBeLessThan(20); // the strike landed in staging — combat in pre-combat, by design
    expect(battle.log[battle.log.length - 1]).toMatchObject({ kind: "skill", unit: "a" });
  });
});
