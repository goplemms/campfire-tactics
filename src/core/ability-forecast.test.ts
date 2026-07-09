import { describe, it, expect } from "vitest";
import {
  abilityFootprint,
  forecastSkill,
  cleaveArc,
  shoveLanding,
  aimInRange,
  type AbilityForecast,
} from "./ability-forecast";
import { Battle } from "./turn";
import { TileGrid } from "./grid";
import { createUnit, type Side, type Unit } from "./units";
import type { SkillDef } from "./skills";
import { resolveMedHeal, resolveSkill } from "./skills";
import { computeDamage, PASSIVE } from "./combat";
import { exposed, applyStatus, isDebuffed, markPrey } from "./status";
import { createInventory } from "./inventory";
import { placePlayerTrap } from "./traps";
import { EntityRegistry } from "./entities";
import { EventBus } from "./event-bus";
import { HEAVY_KNIGHT_JOB, HUNTER_JOB, MEDIC_JOB } from "./jobs-data/combat";

function at(id: string, side: Side, col: number, row: number, o: Partial<Unit> = {}): Unit {
  return {
    ...createUnit({
      id,
      side,
      pos: { col, row },
      speed: 10,
      maxHp: 30,
      attack: 10,
      defense: 2,
      moveRange: 4,
      sightRadius: 6,
    }),
    ...o,
  };
}

/** A structural clone of a unit so a resolver can mutate it without touching the original. */
function clone(u: Unit): Unit {
  return JSON.parse(JSON.stringify(u)) as Unit;
}

const cleaveSkill = HEAVY_KNIGHT_JOB.skills.find((s) => s.id === "cleave")!;
const shoveSkill = HEAVY_KNIGHT_JOB.skills.find((s) => s.id === "shove")!;
const markSkill = HUNTER_JOB.skills.find((s) => s.id === "mark-prey")!;
const healSkill = MEDIC_JOB.skills.find((s) => s.id === "heal")!;

const powerStrike: SkillDef = {
  id: "power-strike", name: "Power Strike", description: "", phase: "battle",
  target: "enemy", range: 1, spend: "act", effect: { kind: "damage", bonusAttack: 6 },
};
const setTrap: SkillDef = {
  id: "set-trap", name: "Set Trap", description: "", phase: "deployment",
  target: "camp", range: 0, spend: "act", effect: { kind: "placeTrap", damage: 12 },
};

// ===========================================================================
// The headline invariant (D64): forecast == what resolution actually applies.
// ===========================================================================

describe("forecast == resolution (the D64 invariant)", () => {
  it("damage: predicted figure equals the HP a Power Strike actually removes", () => {
    const hero = at("h", "player", 0, 0, { attack: 10 });
    const foe = at("f", "enemy", 1, 0, { defense: 2, hp: 30, maxHp: 30 });

    const fc = forecastSkill(powerStrike, hero, { target: foe, units: [hero, foe] }) as Extract<AbilityForecast, { kind: "immediate" }>;
    expect(fc.kind).toBe("immediate");

    const before = foe.hp;
    resolveSkill(powerStrike, hero, foe, undefined, [hero, foe]);
    expect(before - foe.hp).toBe(fc.value);
  });

  it("damage vs a debuffed foe exercises Deadeye — forecast +N matches resolution", () => {
    const hunter = at("hn", "player", 0, 0, { attack: 10, passives: { [PASSIVE.deadeye]: 4 } });
    const clean = at("c", "enemy", 1, 0, { defense: 2, hp: 40, maxHp: 40 });

    // Clean target: Deadeye is dormant → a conditional forecast advertising "+4".
    const cond = forecastSkill(powerStrike, hunter, { target: clean, units: [hunter, clean] });
    expect(cond.kind).toBe("conditional");
    if (cond.kind === "conditional") {
      expect(cond.bonus).toBe(4);
      expect(cond.condition).toBe("vs debuffed");
    }

    // Debuffed target: the +4 is now baked into the immediate figure. Forecast it,
    // then resolve on the same unit and confirm the dealt damage matches.
    const debuffed = at("d", "enemy", 1, 0, { defense: 2, hp: 40, maxHp: 40 });
    applyStatus(debuffed, exposed(2));
    expect(isDebuffed(debuffed)).toBe(true);
    const fc = forecastSkill(powerStrike, hunter, { target: debuffed, units: [hunter, debuffed] });
    expect(fc.kind).toBe("immediate");
    const before = debuffed.hp;
    resolveSkill(powerStrike, hunter, debuffed, undefined, [hunter, debuffed]);
    if (fc.kind === "immediate") expect(before - debuffed.hp).toBe(fc.value);
  });

  it("Medic Heal: each herb row's forecast equals the HP that herb actually restores", () => {
    const medic = at("m", "player", 0, 0, { jobId: "medic", primaryJob: "medic", passives: { [PASSIVE.triage]: 0.5 } });
    const ally = at("a", "player", 1, 0, { hp: 10, maxHp: 40 });
    const inv = createInventory(6, { salve: 2, stimulant: 2, antidote: 2 });

    const fc = forecastSkill(healSkill, medic, { target: ally, units: [medic, ally], inventory: inv });
    expect(fc.kind).toBe("branching");
    if (fc.kind !== "branching") return;

    for (const row of fc.rows) {
      // Resolve the real heal on a clone of the ally (and a clone stash) so each
      // herb is measured independently against its forecast row.
      const target = clone(ally);
      const stash = createInventory(6, { [row.id]: 1 });
      const missing = target.maxHp - target.hp;
      const before = target.hp;
      const out = resolveMedHeal(clone(medic), target, row.id, stash);
      const realisedHeal = target.hp - before;
      // The forecast row is the *requested* heal (best-case, pre-cap, D64); the
      // resolver clamps it to the target's missing HP. So the realised heal is the
      // forecast figure capped — and uncapped they're identical.
      expect(out.healed).toBe(realisedHeal);
      expect(realisedHeal).toBe(Math.min(row.value, missing));
      expect(row.available).toBe(true);
    }
  });

  it("Triage heal (Mend) is computed live from caster level + Triage + missing HP", () => {
    const medic = at("m", "player", 0, 0, { passives: { [PASSIVE.triage]: 0.5 } });
    const ally = at("a", "player", 1, 0, { hp: 10, maxHp: 50 }); // 40 missing
    const triageHeal: SkillDef = {
      ...healSkill, id: "triage", effect: { kind: "triage-heal", amount: 8 },
    };
    const fc = forecastSkill(triageHeal, medic, { target: ally });
    expect(fc.kind).toBe("computed");
    // 8 base + 0 level-scale + floor(0.5 * 40) = 28.
    if (fc.kind === "computed") expect(fc.value).toBe(28);

    const before = ally.hp;
    resolveSkill(triageHeal, medic, ally);
    if (fc.kind === "computed") expect(ally.hp - before).toBe(fc.value);
  });

  it("HK Cleave: footprint arc + per-foe damage match what cleave() resolves", () => {
    const grid = new TileGrid(8, 8);
    const hk = at("hk", "player", 1, 1, { attack: 12, jobId: "heavy-knight" });
    const foeA = at("a", "enemy", 2, 1, { defense: 2, hp: 30, maxHp: 30 });
    const foeB = at("b", "enemy", 2, 2, { defense: 2, hp: 30, maxHp: 30 }); // diagonal of the arc
    const units = [hk, foeA, foeB];

    const aim = { col: 2, row: 1 }; // point right → arc covers (2,1),(2,0),(2,2)
    const fp = abilityFootprint(cleaveSkill, hk, aim, grid, units);
    expect(fp.kind).toBe("arc");
    if (fp.kind !== "arc") return;
    expect(fp.tiles).toEqual([{ col: 2, row: 1 }, { col: 2, row: 0 }, { col: 2, row: 2 }]);
    expect(new Set(fp.units.map((u) => u.id))).toEqual(new Set(["a", "b"]));

    // Forecast the aimed foe's damage, then resolve the real cleave and confirm
    // the total dealt == sum of computeDamage over the caught foes.
    const fc = forecastSkill(cleaveSkill, hk, { target: foeA, units });
    expect(fc.kind).toBe("immediate");
    if (fc.kind === "immediate") expect(fc.value).toBe(computeDamage(hk, foeA, hk.attack, units));

    const battle = new Battle(grid, units);
    const expected = computeDamage(hk, foeA, hk.attack, units) + computeDamage(hk, foeB, hk.attack, units);
    const res = battle.cleave(hk, cleaveSkill, { col: 1, row: 0 });
    expect(res.hits).toBe(2);
    expect(res.damage).toBe(expected);
  });

  it("Shove: footprint landing + blocked flag match resolveShove's actual move", () => {
    const grid = new TileGrid(6, 1);
    const hk = at("hk", "player", 0, 0);
    const foe = at("f", "enemy", 1, 0, { hp: 30, maxHp: 30 });
    const units = [hk, foe];

    const fp = abilityFootprint(shoveSkill, hk, foe.pos, grid, units);
    expect(fp.kind).toBe("push");
    if (fp.kind !== "push") return;
    expect(fp.landing).toEqual({ col: 2, row: 0 }); // pushed 1 tile right
    expect(fp.blocked).toBe(false);

    const battle = new Battle(grid, units);
    battle.resolveShove(hk, foe, 1);
    expect(foe.pos).toEqual(fp.landing);
  });

  it("Shove into a wall stops short — footprint flags blocked and the foe doesn't move", () => {
    const grid = new TileGrid(6, 1);
    const hk = at("hk", "player", 4, 0);
    const foe = at("f", "enemy", 5, 0, { hp: 30, maxHp: 30 }); // at the edge — wall behind
    const units = [hk, foe];

    const fp = abilityFootprint(shoveSkill, hk, foe.pos, grid, units);
    if (fp.kind !== "push") throw new Error("expected push");
    expect(fp.landing).toEqual({ col: 5, row: 0 }); // can't budge off the grid
    expect(fp.blocked).toBe(true);

    const battle = new Battle(grid, units);
    battle.resolveShove(hk, foe, 1);
    expect(foe.pos).toEqual(fp.landing);
  });

  it("trap placement: footprint tile + conditional forecast match the placed entity", () => {
    const bus = new EventBus();
    const entities = new EntityRegistry(bus);
    const grid = new TileGrid(6, 6);
    const trapper = at("t", "player", 0, 0, { jobId: "survivalist" });
    const inv = createInventory(6, { "trap-kit": 1 });
    const tile = { col: 3, row: 3 };

    const fp = abilityFootprint(setTrap, trapper, tile, grid, []);
    expect(fp).toEqual({ kind: "placement", tile });

    const fc = forecastSkill(setTrap, trapper);
    expect(fc.kind).toBe("conditional");
    if (fc.kind === "conditional") {
      expect(fc.bonus).toBe(12);
      expect(fc.value).toBe(0); // nothing now — only "if a foe enters"
    }

    const res = placePlayerTrap(inv, entities, trapper, tile, setTrap.effect as never, "trap-1");
    expect(res.ok).toBe(true);

    // Springing the placed trap deals exactly the forecast's `bonus` damage — the
    // "if a foe enters: N" conditional resolved (D64 forecast == resolution).
    const victim = at("v", "enemy", 3, 4, { hp: 30, maxHp: 30 });
    const before = victim.hp;
    bus.emit("unitEnterTile", { unit: victim, tile, forced: false });
    if (fc.kind === "conditional") expect(before - victim.hp).toBe(fc.bonus);
  });
});

// ===========================================================================
// Tagged-outcome shapes (D64) — the forecast is a kind, not a number.
// ===========================================================================

describe("AbilityForecast tagged shapes", () => {
  it("Mark Prey is deferred: 0 now → +perStack/hit up to a cap", () => {
    const hunter = at("hn", "player", 0, 0);
    const fc = forecastSkill(markSkill, hunter);
    expect(fc.kind).toBe("deferred");
    if (fc.kind === "deferred") {
      expect(fc.now).toBe(0);
      expect(fc.perHit).toBe(2); // CHANNEL_TUNING.markPerStack
      expect(fc.cap).toBe(8); // perStack * markCap (2 * 4)
    }
  });

  it("Mark Prey reads a live, already-open channel's cap", () => {
    const hunter = at("hn", "player", 0, 0);
    markPrey(hunter, "victim", 3, 5); // custom perStack 3, cap 5
    const fc = forecastSkill(markSkill, hunter);
    if (fc.kind !== "deferred") throw new Error("expected deferred");
    expect(fc.perHit).toBe(3);
    expect(fc.cap).toBe(15);
  });

  it("Chef morale is banked + tiered: Neutral → High plus the bundle and banked HP", () => {
    const chef = at("chef", "player", 0, 0);
    const stew: SkillDef = {
      id: "cook-stew", name: "Cook Stew", description: "", phase: "meta",
      target: "party", range: 0, spend: "act", effect: { kind: "morale", morale: 1, partyHeal: 8 },
    };
    const fc = forecastSkill(stew, chef, { morale: 0 });
    expect(fc.kind).toBe("tiered");
    if (fc.kind === "tiered") {
      expect(fc.from).toBe("Neutral");
      expect(fc.to).toBe("High");
      expect(fc.banked).toBe(8);
      expect(fc.modifiers.initiativeBonus).toBe(6); // the High bundle (D8)
    }
  });

  it("Medic Heal rows grey out unaffordable / out-of-stock herbs (D64 availability)", () => {
    const medic = at("m", "player", 0, 0, { passives: { [PASSIVE.triage]: 0.5 } });
    const ally = at("a", "player", 1, 0, { hp: 10, maxHp: 40 });
    const inv = createInventory(6, { salve: 1 }); // only salve carried
    const fc = forecastSkill(healSkill, medic, { target: ally, inventory: inv });
    if (fc.kind !== "branching") throw new Error("expected branching");
    const byId = Object.fromEntries(fc.rows.map((r) => [r.id, r]));
    expect(byId.salve.available).toBe(true);
    expect(byId.stimulant.available).toBe(false); // out of stock — greyed, not hidden
    expect(byId.antidote.available).toBe(false);
    expect(byId.antidote.rider).toBe("& cleanse");
    expect(byId.stimulant.rider).toBe("& Hastened");
  });
});

// ===========================================================================
// Footprint geometry (D64).
// ===========================================================================

describe("abilityFootprint geometry", () => {
  it("a single-target skill footprints the aimed tile + the unit on it", () => {
    const grid = new TileGrid(6, 6);
    const hero = at("h", "player", 0, 0);
    const foe = at("f", "enemy", 1, 0);
    const fp = abilityFootprint(powerStrike, hero, foe.pos, grid, [hero, foe]);
    expect(fp.kind).toBe("single");
    if (fp.kind === "single") {
      expect(fp.tile).toEqual({ col: 1, row: 0 });
      expect(fp.units.map((u) => u.id)).toEqual(["f"]);
    }
  });

  it("a self skill footprints the caster's own tile", () => {
    const grid = new TileGrid(6, 6);
    const scout = at("s", "player", 2, 2);
    const dash: SkillDef = {
      id: "dash", name: "Dash", description: "", phase: "battle",
      target: "self", range: 0, spend: "move", effect: { kind: "status", status: { id: "swift", name: "Swift", duration: 1 } },
    };
    const fp = abilityFootprint(dash, scout, scout.pos, grid, [scout]);
    expect(fp).toEqual({ kind: "self", tile: { col: 2, row: 2 } });
  });

  it("a party/camp meta skill has no board footprint", () => {
    const grid = new TileGrid(6, 6);
    const chef = at("chef", "player", 0, 0);
    const stew: SkillDef = {
      id: "cook-stew", name: "Cook Stew", description: "", phase: "meta",
      target: "party", range: 0, spend: "act", effect: { kind: "morale", morale: 1, partyHeal: 8 },
    };
    expect(abilityFootprint(stew, chef, { col: 0, row: 0 }, grid, [chef])).toEqual({ kind: "none" });
  });

  it("cleaveArc points along the dominant axis (orthogonal + two diagonals)", () => {
    expect(cleaveArc({ col: 1, row: 1 }, { col: 1, row: 0 })).toEqual([
      { col: 2, row: 1 }, { col: 2, row: 0 }, { col: 2, row: 2 },
    ]);
    expect(cleaveArc({ col: 1, row: 1 }, { col: 0, row: -1 })).toEqual([
      { col: 1, row: 0 }, { col: 0, row: 0 }, { col: 2, row: 0 },
    ]);
  });

  it("shoveLanding stops at a body and flags the collision", () => {
    const walls = new Set<string>();
    const occupiedTiles = new Set(["3,0"]);
    const land = shoveLanding(
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      3,
      (c) => !walls.has(`${c.col},${c.row}`),
      (c) => occupiedTiles.has(`${c.col},${c.row}`),
    );
    // From (1,0) pushing right: (2,0) free, (3,0) occupied → stops at (2,0), moved 1.
    expect(land.landing).toEqual({ col: 2, row: 0 });
    expect(land.moved).toBe(1);
    expect(land.blocked).toBe(true);
  });

  it("aimInRange honours the skill's range and frees self/meta skills", () => {
    const hero = at("h", "player", 0, 0);
    expect(aimInRange(powerStrike, hero, { col: 1, row: 0 })).toBe(true);
    expect(aimInRange(powerStrike, hero, { col: 3, row: 0 })).toBe(false); // range 1
    expect(aimInRange(setTrap, hero, { col: 9, row: 9 })).toBe(true); // camp target — anchor-free
  });
});
