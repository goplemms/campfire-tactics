import { describe, it, expect } from "vitest";
import { createUnit, type Unit, type UnitSpec } from "./units";
import { EventBus } from "./events";
import type { MapNode } from "./overworld";
import type { AuthoredEncounter } from "./authored";
import { registerExpedition, type AuthoredExpedition } from "./expedition";
import { createRunFromExpedition, chooseNode } from "./run";
import { RunLoop } from "./runloop";
import {
  trackCombatXp,
  commitCombatXp,
  accrueDeployedXp,
  LEVELING,
} from "./leveling";

function unit(id: string, side: "player" | "enemy", over: Partial<UnitSpec> = {}): Unit {
  return createUnit({
    id, side, pos: { col: 0, row: 0 },
    speed: 10, maxHp: 30, attack: 6, defense: 2, moveRange: 3, sightRadius: 5, attackRange: 1, jobId: "soldier", ...over,
  });
}

describe("combat-XP accumulator (D53)", () => {
  it("credits a kill to the attacker and a survived hit to the struck defender", () => {
    const bus = new EventBus();
    const tally = trackCombatXp(bus);
    const hero = unit("hero", "player");
    const foe = unit("foe", "enemy");
    bus.emit("unitDamaged", { unit: hero, amount: 5, source: foe }); // hero survives a hit
    bus.emit("unitDefeated", { unit: foe, source: hero }); // hero lands the kill
    expect(tally.hero).toBe(LEVELING.survivedHitXp + LEVELING.killXp);
    expect(tally.foe ?? 0).toBe(0);
  });

  it("ignores friendly fire and zero-damage events", () => {
    const bus = new EventBus();
    const tally = trackCombatXp(bus);
    const a = unit("a", "player");
    const b = unit("b", "player");
    bus.emit("unitDamaged", { unit: a, amount: 3, source: b }); // same side
    bus.emit("unitDamaged", { unit: a, amount: 0, source: unit("e", "enemy") }); // no damage
    expect(tally.a ?? 0).toBe(0);
  });

  it("commits the tally only to surviving units (downed forfeit it)", () => {
    const hero = unit("hero", "player");
    const tally = { hero: LEVELING.killXp * 5 }; // enough to level
    const levels = commitCombatXp(tally, [hero]);
    expect(hero.xp + hero.level * LEVELING.xpPerLevel).toBeGreaterThan(LEVELING.xpPerLevel); // grew
    expect(levels.hero).toBeDefined();
    // A unit absent from survivors keeps its tally unspent.
    const ghost = unit("ghost", "player");
    commitCombatXp({ ghost: 999 }, []);
    expect(ghost.xp).toBe(0);
  });
});

describe("deployed trickle vs benched (D53)", () => {
  it("trickles deployed units a node-step's worth, benched stays put", () => {
    const deployed = unit("d", "player");
    const benched = unit("b", "player");
    accrueDeployedXp([deployed]); // benched is simply never passed in
    expect(deployed.xp).toBe(LEVELING.deployedTrickle);
    expect(benched.xp).toBe(0);
  });
});

// --- Integration through the run loop ---------------------------------------

function node(id: string, layer: number, kind: MapNode["kind"], edges: string[], authoredId?: string): MapNode {
  return { id, layer, index: 0, kind, edges, authoredId };
}

function enc(): AuthoredEncounter {
  return {
    id: "fight", name: "fight", cols: 8, rows: 6, blocked: [],
    playerSpawns: [{ col: 0, row: 2 }],
    enemies: [{ templateId: "bandit-thug", pos: { col: 6, row: 2 }, id: "drv", role: "sapper" }],
    reward: { gold: 40, materials: [], xp: 60 },
    objectives: [{ id: "gate", kind: "closing-gate", required: true, label: "Hold", speed: 10, span: [], driver: { id: "drv" } }],
  };
}

function exp(): AuthoredExpedition {
  const nodes: Record<string, MapNode> = {
    start: node("start", 0, "rest", ["mid"]),
    mid: node("mid", 1, "combat", ["fin"], "fight"),
    fin: node("fin", 2, "combat", [], "fight"),
  };
  return registerExpedition({
    id: "xp-exp", name: "xp", seed: "xp",
    map: { seed: "xp", layers: 3, nodes, startId: "start", finalIds: ["fin"], order: ["start", "mid", "fin"] },
    encounters: { fight: enc() },
    bundle: {
      party: [{ id: "rook", name: "Rook", side: "player", pos: { col: 0, row: 0 }, jobId: "soldier", speed: 12, maxHp: 30, attack: 9, defense: 3, moveRange: 4, sightRadius: 5, awareness: 4, intelligence: 4 }],
      purse: 100, supplies: {}, storageCap: 8,
    },
  });
}

describe("leveling wired into resolve (D53)", () => {
  it("awards objective reward.xp to survivors on a win", () => {
    const loop = new RunLoop(createRunFromExpedition(exp()));
    chooseNode(loop.run, "mid"); // breakCamp trickles a node-step
    const xpAfterTravel = loop.run.party[0].xp;
    loop.startEncounter();
    loop.beginBattle();
    for (const u of loop.staged!.battle.units) if (u.side === "enemy") u.alive = false; // clean win, no combat
    const res = loop.resolve();
    expect(res.result).toBe("win");
    // The objective XP (60) folded in; reward.xp is the only source here (no combat).
    expect(loop.run.party[0].xp).toBe(xpAfterTravel + 60);
  });

  it("awards NO XP on objective-failure (it's part of the forfeited reward)", () => {
    const loop = new RunLoop(createRunFromExpedition(exp()));
    chooseNode(loop.run, "mid");
    loop.startEncounter();
    loop.beginBattle();
    const xpBefore = loop.run.party[0].xp; // after the travel trickle
    const clock = loop.staged!.battle.clock;
    for (let i = 0; i < 40 && loop.staged!.objectives.some((o) => o.spec.kind === "closing-gate" && o.status() === "pending"); i++) clock.tick();
    const res = loop.resolve();
    expect(res.result).toBe("objective-failure");
    expect(loop.run.party[0].xp).toBe(xpBefore); // no combat XP, no objective XP
    expect(res.levels).toEqual({});
  });
});
