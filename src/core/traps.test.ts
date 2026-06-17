import { describe, it, expect } from "vitest";
import { createUnit, type Unit, type Side } from "./units";
import { EventBus } from "./events";
import { EntityRegistry, makeConcealedTrap, makeTrap, isConcealedTrap } from "./entities";
import { recoverMaterials } from "./resolution";
import { createInventory, countOf } from "./inventory";
import { immobilized, isDebuffed } from "./status";
import { Rng } from "./rng";
import {
  spotChance,
  spotRadius,
  revealTrapsNear,
  hiddenTraps,
  canDisarm,
  disarmTrap,
} from "./traps";

function unit(id: string, side: Side, over: Partial<Parameters<typeof createUnit>[0]> = {}): Unit {
  return createUnit({
    id, side, pos: { col: 0, row: 0 },
    speed: 10, maxHp: 30, attack: 6, defense: 0, moveRange: 4, sightRadius: 5,
    ...over,
  });
}

function reg(): EntityRegistry {
  return new EntityRegistry(new EventBus());
}

describe("concealed enemy traps — the trap-field primitive (D12)", () => {
  it("springs on a player entry, not on its enemy owner's", () => {
    const bus = new EventBus();
    const registry = new EntityRegistry(bus);
    const trap = makeConcealedTrap("t", { col: 3, row: 3 }, "enemy", 12, 4);
    registry.register(trap);

    // The enemy owner walks over it safely…
    const foe = unit("f", "enemy", { pos: { col: 3, row: 3 } });
    bus.emit("unitEnterTile", { unit: foe, tile: { col: 3, row: 3 } });
    expect(trap.sprung).toBe(false);

    // …a player springs it for flat damage, once.
    const hero = unit("h", "player", { pos: { col: 3, row: 3 }, maxHp: 30 });
    bus.emit("unitEnterTile", { unit: hero, tile: { col: 3, row: 3 } });
    expect(trap.sprung).toBe(true);
    expect(hero.hp).toBe(18);
  });

  it("is never auto-salvaged on a win (recoverable=false) — disarm is the only harvest", () => {
    const trap = makeConcealedTrap("t", { col: 1, row: 1 }, "enemy", 12, 4);
    expect(isConcealedTrap(trap)).toBe(true);
    const res = recoverMaterials([trap], "player", createInventory(10));
    expect(res.recovered).toEqual([]);
  });
});

describe("spotting — Awareness vs concealment (D11)", () => {
  it("spotChance rises with Awareness and falls with concealment + distance", () => {
    expect(spotChance(5, 0, 1)).toBeGreaterThan(spotChance(0, 0, 1));
    expect(spotChance(3, 0, 1)).toBeGreaterThan(spotChance(3, 6, 1));
    expect(spotChance(3, 2, 5)).toBeLessThan(spotChance(3, 2, 1));
    // Clamped into 0..1.
    expect(spotChance(0, 20, 9)).toBe(0);
    expect(spotChance(9, 0, 0)).toBe(1);
  });

  it("reveals a near, low-concealment trap and misses a hopeless one", () => {
    const r = reg();
    const seen = makeConcealedTrap("seen", { col: 1, row: 0 }, "enemy", 12, 0);
    const hopeless = makeConcealedTrap("hopeless", { col: 2, row: 0 }, "enemy", 12, 20);
    r.register(seen);
    r.register(hopeless);
    // Awareness 5, adjacent, concealment 0 → chance clamps to 1 → certain reveal.
    const scout = unit("s", "player", { pos: { col: 0, row: 0 }, awareness: 5 });
    const found = revealTrapsNear(scout, r, new Rng("seed"));
    expect(found.map((t) => t.id)).toEqual(["seen"]);
    expect(seen.revealed).toBe(true);
    expect(hopeless.revealed).toBe(false); // concealment 20 → chance 0
  });

  it("a trap outside the spot radius is unreachable until a Search extends it", () => {
    const r = reg();
    const far = makeConcealedTrap("far", { col: 6, row: 0 }, "enemy", 12, 0);
    r.register(far);
    const scout = unit("s", "player", { pos: { col: 0, row: 0 }, awareness: 5 });
    expect(spotRadius(scout)).toBe(4); // 2 + floor(5/2)
    // d=6 is beyond the passive radius (4): not revealed.
    expect(revealTrapsNear(scout, r, new Rng("a"))).toEqual([]);
    expect(far.revealed).toBe(false);
    // A deliberate Search widens the radius (+2) and improves the roll: now found.
    const found = revealTrapsNear(scout, r, new Rng("a"), { search: true });
    expect(found.map((t) => t.id)).toEqual(["far"]);
  });

  it("hiddenTraps lists only unrevealed, unsprung concealed traps", () => {
    const r = reg();
    const a = makeConcealedTrap("a", { col: 1, row: 1 }, "enemy", 12, 4);
    const b = makeConcealedTrap("b", { col: 2, row: 2 }, "enemy", 12, 4);
    b.revealed = true;
    r.register(a);
    r.register(b);
    expect(hiddenTraps(r).map((t) => t.id)).toEqual(["a"]);
  });
});

describe("disarming — Survivalist-only, harvests the kit (the lever payoff)", () => {
  it("a trap-trained unit adjacent to a spotted trap pockets the kit and clears it", () => {
    const r = reg();
    const trap = makeConcealedTrap("t", { col: 1, row: 1 }, "enemy", 12, 4);
    trap.revealed = true;
    r.register(trap);
    const surv = unit("v", "player", { pos: { col: 1, row: 2 }, jobId: "scout" }); // the Scout is the trapper now
    const inv = createInventory(10);

    expect(canDisarm(surv)).toBe(true);
    const res = disarmTrap(r, "t", surv, inv);
    expect(res.ok).toBe(true);
    expect(res.harvested).toBe("trap-kit");
    expect(countOf(inv, "trap-kit")).toBe(1);
    expect(r.all()).toHaveLength(0); // removed from the field
  });

  it("refuses a non-Survivalist, an unspotted trap, and a too-far disarmer", () => {
    const r = reg();
    const spotted = makeConcealedTrap("spotted", { col: 1, row: 1 }, "enemy", 12, 4);
    spotted.revealed = true;
    const unseen = makeConcealedTrap("unseen", { col: 5, row: 5 }, "enemy", 12, 4);
    r.register(spotted);
    r.register(unseen);
    const inv = createInventory(10);

    const soldier = unit("s", "player", { pos: { col: 1, row: 2 }, jobId: "soldier" });
    expect(canDisarm(soldier)).toBe(false);
    expect(disarmTrap(r, "spotted", soldier, inv).ok).toBe(false);

    const surv = unit("v", "player", { pos: { col: 1, row: 2 }, jobId: "scout" });
    // Not yet spotted → refused.
    expect(disarmTrap(r, "unseen", surv, inv).ok).toBe(false);
    // Adjacent + spotted + trained → would work; move the trapper away → refused.
    surv.pos = { col: 8, row: 8 };
    expect(disarmTrap(r, "spotted", surv, inv).ok).toBe(false);
    // Nothing harvested across the refusals.
    expect(countOf(inv, "trap-kit")).toBe(0);
    expect(r.all()).toHaveLength(2);
  });
});

describe("trapper↔Hunter synergy — a snare debuffs prey for Deadeye", () => {
  it("the Scout carries the trap skill (Survivalist subsumed), so it can plant + disarm", () => {
    expect(canDisarm(unit("s", "player", { jobId: "scout" }))).toBe(true);
    // A plain soldier still can't.
    expect(canDisarm(unit("g", "player", { jobId: "soldier" }))).toBe(false);
  });

  it("a player snare Immobilizes the enemy it springs on — a debuff that enables Deadeye", () => {
    const bus = new EventBus();
    const r = new EntityRegistry(bus);
    r.register(makeTrap("snare", { col: 2, row: 2 }, "player", 8, { status: immobilized(2) }));
    const foe = unit("f", "enemy", { pos: { col: 2, row: 2 }, maxHp: 20 });

    bus.emit("unitEnterTile", { unit: foe, tile: { col: 2, row: 2 } });
    expect(foe.hp).toBe(12); // 20 - 8 damage
    expect(isDebuffed(foe)).toBe(true); // …and now Deadeye-eligible (the Hunter's +dmg)
  });
});
