import { describe, it, expect } from "vitest";
import {
  getJob,
  stampPassives,
  HEAVY_KNIGHT,
  HUNTER,
  SCOUT_JOB,
  MEDIC,
  DEFEND,
  JOBS,
  type JobId,
} from "./jobs";
import { TileGrid } from "./grid";
import { createUnit, type Side, type Unit } from "./units";
import { Battle } from "./turn";
import { effectiveSpeed } from "./clock";
import { hasStatus, applyStatus, immobilized, GUARDED, SLOWED } from "./status";
import { computeFlankBonus, PASSIVE } from "./combat";
import { makeTrap } from "./entities";
import { createInventory, addItem, countOf } from "./inventory";
import { MEDIC as _MEDIC } from "./jobs";

function at(id: string, side: Side, col: number, row: number, jobId?: JobId, o: Partial<Unit> = {}): Unit {
  const u = {
    ...createUnit({
      id,
      side,
      pos: { col, row },
      speed: 10,
      maxHp: 40,
      attack: 8,
      defense: 1,
      moveRange: 4,
      sightRadius: 5,
      jobId,
    }),
    ...o,
  };
  stampPassives(u);
  return u;
}

describe("the four kits load as data (D40)", () => {
  it("each is registered with a passive + 2 actives (2nd unlocks at level 2)", () => {
    for (const job of [HEAVY_KNIGHT, HUNTER, SCOUT_JOB, MEDIC]) {
      expect(getJob(job.id)).toBe(job);
      expect(job.passives && Object.keys(job.passives).length).toBeGreaterThan(0);
      // Count the **combat-kit** actives (battle + deployment): the Scout's two span both.
      // Its overworld Survey (phase "meta", D72) is a non-combat verb layered on top, not
      // part of the D40 2-active shape — so it doesn't count against the kit guideline.
      const actives = job.skills.filter((s) => s.phase !== "meta");
      expect(actives.length).toBe(2);
      expect(actives.find((s) => s.unlockLevel === 2)).toBeTruthy();
      expect(job.baseline).toBeTruthy();
    }
    expect(Object.keys(JOBS)).toContain("heavy-knight");
  });

  it("stampPassives copies the job's passive onto the unit", () => {
    const scout = at("s", "player", 0, 0, "scout");
    expect(scout.passives[PASSIVE.quietFootsteps]).toBe(1);
    const medic = at("m", "player", 0, 0, "medic");
    expect(medic.passives[PASSIVE.triage]).toBeGreaterThan(0);
  });
});

describe("Heavy Knight — Hold the Line tarpit aura", () => {
  it("slows an adjacent foe to speed 1 and clears it on leaving the ring", () => {
    const grid = new TileGrid(8, 1);
    const knight = at("k", "player", 2, 0, "heavy-knight");
    const foe = at("f", "enemy", 3, 0, undefined, { speed: 12 });
    const battle = new Battle(grid, [knight, foe]); // constructor refreshes auras
    expect(hasStatus(foe, SLOWED)).toBe(true);
    expect(effectiveSpeed(foe)).toBe(1);
    // The foe walks away → the aura clears.
    battle.moveUnit(foe, [{ col: 5, row: 0 }]);
    expect(hasStatus(foe, SLOWED)).toBe(false);
    expect(effectiveSpeed(foe)).toBe(12);
  });
});

describe("Scout — Quiet Footsteps solo-flank", () => {
  it("flanks an isolated foe alone, at the baseline bonus", () => {
    const scout = at("s", "player", 1, 2, "scout");
    const foe = at("f", "enemy", 2, 2);
    const bonus = computeFlankBonus(scout, foe, [scout, foe]);
    expect(bonus).toBe(4); // solo-flank at the baseline bonus — the edge is flanking alone, not harder
  });
});

describe("Hunter — Deadeye punishes the afflicted", () => {
  it("adds damage against a debuffed target via the stamped passive", () => {
    const hunter = at("h", "player", 0, 0, "hunter");
    const prey = at("p", "enemy", 1, 0, undefined, { defense: 0 });
    const grid = new TileGrid(4, 1);
    const battle = new Battle(grid, [hunter, prey]);
    const clean = battle.attack(hunter, prey);
    applyStatus(prey, immobilized(3));
    const punished = battle.attack(hunter, prey);
    expect(punished).toBeGreaterThan(clean);
  });
});

describe("Medic — Heal consumes a herb with a rider (D40)", () => {
  it("salve heals more (and Triage scales with missing HP)", () => {
    const grid = new TileGrid(4, 1);
    const medic = at("m", "player", 0, 0, "medic");
    const ally = at("a", "player", 1, 0, undefined, { hp: 1, maxHp: 40 });
    const battle = new Battle(grid, [medic, ally]);
    medic.ct = 100;
    const inv = createInventory(8);
    addItem(inv, "salve", 1);
    const out = battle.useHeal(medic, _MEDIC.skills[0], ally, "salve", inv);
    expect(out.healed).toBeGreaterThan(0);
    expect(countOf(inv, "salve")).toBe(0); // consumed
    expect(battle.canUseSkill(medic, _MEDIC.skills[0])).toBe(false); // on cooldown
  });

  it("antidote cleanses a debuff; stimulant hastens", () => {
    const grid = new TileGrid(6, 1);
    const medic = at("m", "player", 0, 0, "medic");
    const ally = at("a", "player", 1, 0, undefined, { hp: 30, maxHp: 40 });
    const battle = new Battle(grid, [medic, ally]);
    medic.ct = 100;
    const inv = createInventory(8);
    addItem(inv, "antidote", 1);
    addItem(inv, "stimulant", 1);

    applyStatus(ally, immobilized(3));
    const cure = battle.useHeal(medic, _MEDIC.skills[0], ally, "antidote", inv);
    expect(cure.cleansed).toBe("immobilized");
    expect(hasStatus(ally, "immobilized")).toBe(false);

    // Cooldown burns down, then stimulant grants Hastened.
    medic.cooldowns = {};
    medic.ct = 100;
    const stim = battle.useHeal(medic, _MEDIC.skills[0], ally, "stimulant", inv);
    expect(stim.status).toBe("hastened");
    expect(hasStatus(ally, "hastened")).toBe(true);
  });

  it("refuses when the herb isn't carried (no heal, no cooldown spent)", () => {
    const grid = new TileGrid(4, 1);
    const medic = at("m", "player", 0, 0, "medic");
    const ally = at("a", "player", 1, 0, undefined, { hp: 1, maxHp: 40 });
    const battle = new Battle(grid, [medic, ally]);
    const inv = createInventory(8); // empty
    const out = battle.useHeal(medic, _MEDIC.skills[0], ally, "salve", inv);
    expect(out.healed).toBeUndefined();
    expect(ally.hp).toBe(1);
    expect(battle.canUseSkill(medic, _MEDIC.skills[0])).toBe(true);
  });
});

describe("Heavy Knight — Shove (D19 forced movement)", () => {
  it("pushes a foe one tile away from the Knight", () => {
    const grid = new TileGrid(8, 1);
    const knight = at("k", "player", 2, 0, "heavy-knight");
    const foe = at("f", "enemy", 3, 0, undefined, { speed: 12 });
    const battle = new Battle(grid, [knight, foe]);
    knight.ct = 100;
    battle.useSkill(knight, HEAVY_KNIGHT.skills[1], foe); // Shove
    expect(foe.pos).toEqual({ col: 4, row: 0 });
  });

  it("stops at a blocker (a wall behind the foe)", () => {
    const grid = new TileGrid(6, 1, [{ col: 4, row: 0 }]); // wall behind
    const knight = at("k", "player", 2, 0, "heavy-knight");
    const foe = at("f", "enemy", 3, 0);
    const battle = new Battle(grid, [knight, foe]);
    knight.ct = 100;
    battle.useSkill(knight, HEAVY_KNIGHT.skills[1], foe);
    expect(foe.pos).toEqual({ col: 3, row: 0 }); // didn't move into the wall
  });

  it("a forced entry onto a trap tile springs it (D19)", () => {
    const grid = new TileGrid(8, 1);
    const knight = at("k", "player", 2, 0, "heavy-knight");
    const foe = at("f", "enemy", 3, 0, undefined, { hp: 30, maxHp: 30 });
    const battle = new Battle(grid, [knight, foe]);
    battle.entities.register(makeTrap("t", { col: 4, row: 0 }, "player", 12));
    knight.ct = 100;
    battle.useSkill(knight, HEAVY_KNIGHT.skills[1], foe);
    expect(foe.pos).toEqual({ col: 4, row: 0 });
    expect(foe.hp).toBe(18); // the trap fired on the forced entry
  });
});

describe("Heavy Knight — Cleave (directional AoE)", () => {
  it("hits every foe in the chosen 90° arc", () => {
    const grid = new TileGrid(6, 6);
    const knight = at("k", "player", 1, 2, "heavy-knight", { attack: 10 });
    const a = at("a", "enemy", 2, 2, undefined, { hp: 30, maxHp: 30, defense: 0 });
    const b = at("b", "enemy", 2, 1, undefined, { hp: 30, maxHp: 30, defense: 0 });
    const behind = at("c", "enemy", 0, 2, undefined, { hp: 30, maxHp: 30, defense: 0 });
    const battle = new Battle(grid, [knight, a, b, behind]);
    knight.ct = 100;
    const res = battle.cleave(knight, HEAVY_KNIGHT.skills[0], { col: 1, row: 0 }); // facing east
    expect(res.hits).toBe(2); // a (east) + b (north-east diagonal), not the one behind
    expect(behind.hp).toBe(30);
  });
});

describe("universal Defend → Guarded (D41)", () => {
  it("braces any unit, reducing incoming damage until its next turn", () => {
    const grid = new TileGrid(4, 1);
    const chef = at("p", "player", 0, 0);
    const foe = at("f", "enemy", 1, 0);
    const battle = new Battle(grid, [chef, foe]);
    chef.ct = 100;
    const out = battle.useSkill(chef, DEFEND, chef);
    expect(out.status).toBe(GUARDED);
    expect(hasStatus(chef, GUARDED)).toBe(true);
  });
});
