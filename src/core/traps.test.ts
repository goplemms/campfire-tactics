import { describe, it, expect } from "vitest";
import { createUnit, type Unit, type Side } from "./units";
import { EventBus } from "./events";
import { EntityRegistry, makeConcealedTrap, makeTrap, isConcealedTrap } from "./entities";
import { recoverMaterials } from "./resolution";
import { createInventory, countOf, addItem } from "./inventory";
import { immobilized, isDebuffed } from "./status";
import { Rng } from "./rng";
import type { PlaceTrapEffect } from "./skills";
import {
  spotChance,
  spotRadius,
  revealTrapsNear,
  hiddenTraps,
  canDisarm,
  disarmTrap,
  canPlacePlayerTrap,
  placePlayerTrap,
  spotWhileMoving,
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

describe("spotWhileMoving — the per-step 'sense it just in time' read (D12)", () => {
  // A straight 4-tile route east from the start; an enemy trap sits on the 3rd tile.
  const route = [{ col: 1, row: 0 }, { col: 2, row: 0 }, { col: 3, row: 0 }, { col: 4, row: 0 }];
  const trapTile = { col: 3, row: 0 };
  const always = { chance: () => true } as unknown as Rng;
  const never = { chance: () => false } as unknown as Rng;

  it("walks the whole route untouched when no trap lies on it", () => {
    const r = reg();
    r.register(makeConcealedTrap("off-path", { col: 3, row: 5 }, "enemy", 12, 4));
    const scout = unit("s", "player", { pos: { col: 0, row: 0 }, awareness: 5 });
    const out = spotWhileMoving(scout, route, r, always);
    expect(out.path).toEqual(route);
    expect(out.halted).toBe(false);
    expect(out.spotted).toBeNull();
  });

  it("senses a hidden trap just in time: halts on the prior tile and reveals it", () => {
    const r = reg();
    const trap = makeConcealedTrap("t", trapTile, "enemy", 22, 5);
    r.register(trap);
    const scout = unit("s", "player", { pos: { col: 0, row: 0 }, awareness: 6 });
    const out = spotWhileMoving(scout, route, r, always);
    // Stops one tile short of the trap — never enters it.
    expect(out.path).toEqual([{ col: 1, row: 0 }, { col: 2, row: 0 }]);
    expect(out.spotted?.id).toBe("t");
    expect(trap.revealed).toBe(true);
    expect(out.halted).toBe(true);
  });

  it("blunders in on a failed read: steps onto the trap (which springs) and stops there", () => {
    const r = reg();
    const trap = makeConcealedTrap("t", trapTile, "enemy", 22, 5);
    r.register(trap);
    const oaf = unit("o", "player", { pos: { col: 0, row: 0 }, awareness: 1 });
    const out = spotWhileMoving(oaf, route, r, never);
    // The trap tile IS the last step — entering it is what springs it for the caller.
    expect(out.path).toEqual([{ col: 1, row: 0 }, { col: 2, row: 0 }, { col: 3, row: 0 }]);
    expect(out.spotted).toBeNull(); // not "spotted" — it was felt the hard way
    expect(trap.revealed).toBe(false);
    expect(out.halted).toBe(true);
  });

  it("stops short of an already-revealed trap with no roll at all", () => {
    const r = reg();
    const trap = makeConcealedTrap("t", trapTile, "enemy", 22, 5);
    trap.revealed = true;
    r.register(trap);
    const scout = unit("s", "player", { pos: { col: 0, row: 0 }, awareness: 5 });
    // A throwing rng proves no spot roll is consumed for a trap you can already see.
    const noRoll = { chance: () => { throw new Error("rolled for a known trap"); } } as unknown as Rng;
    const out = spotWhileMoving(scout, route, r, noRoll);
    expect(out.path).toEqual([{ col: 1, row: 0 }, { col: 2, row: 0 }]);
    expect(out.spotted).toBeNull();
    expect(out.halted).toBe(true);
  });

  it("ignores a trap of the unit's own side (you don't balk at your own snares)", () => {
    const r = reg();
    r.register(makeConcealedTrap("mine", trapTile, "player", 22, 5));
    const scout = unit("s", "player", { pos: { col: 0, row: 0 }, awareness: 5 });
    const out = spotWhileMoving(scout, route, r, never);
    expect(out.path).toEqual(route); // walked clean through
    expect(out.halted).toBe(false);
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

describe("player trap placement — the pure Set Trap resolver (D11)", () => {
  // The placement spec the deploy verb now sources from the acting unit's own Set Trap skill.
  const trap: PlaceTrapEffect = { kind: "placeTrap", damage: 3 };

  it("a trapper places a trap: kit spent, entity registered on the field, XP gained", () => {
    const r = reg();
    const inv = createInventory(8, { "trap-kit": 2 });
    const actor = unit("trapper", "player", { jobId: "scout" });
    const xpBefore = actor.xp;
    const res = placePlayerTrap(inv, r, actor, { col: 2, row: 2 }, trap, "pt-0");
    expect(res.ok).toBe(true);
    expect(countOf(inv, "trap-kit")).toBe(1); // one kit consumed
    expect(r.all().some((e) => e.id === "pt-0")).toBe(true); // live on the field
    expect(actor.xp).toBeGreaterThan(xpBefore); // signature-action use-XP
  });

  it("refuses with no kit, and refuses a second trap on the same tile (spending nothing)", () => {
    const r = reg();
    const inv = createInventory(8); // no kits
    const actor = unit("trapper2", "player", { jobId: "scout" });
    expect(canPlacePlayerTrap(inv, r, { col: 1, row: 1 }).ok).toBe(false);
    expect(placePlayerTrap(inv, r, actor, { col: 1, row: 1 }, trap, "a").ok).toBe(false);

    addItem(inv, "trap-kit", 2);
    expect(placePlayerTrap(inv, r, actor, { col: 1, row: 1 }, trap, "b").ok).toBe(true);
    const dup = placePlayerTrap(inv, r, actor, { col: 1, row: 1 }, trap, "c");
    expect(dup.ok).toBe(false);
    expect(dup.reason).toMatch(/already a trap/i);
    expect(countOf(inv, "trap-kit")).toBe(1); // only the one successful place spent a kit
  });

  it("the placed trap emits trapSprung when an enemy steps on it (no shadow model)", () => {
    const bus = new EventBus();
    const r = new EntityRegistry(bus);
    const inv = createInventory(8, { "trap-kit": 1 });
    const actor = unit("trapper3", "player", { jobId: "scout" });
    placePlayerTrap(inv, r, actor, { col: 4, row: 4 }, trap, "pt");
    let sprungId = "";
    bus.on("trapSprung", ({ id }) => { sprungId = id; });
    const foe = unit("foe", "enemy", { pos: { col: 4, row: 3 } });
    bus.emit("unitEnterTile", { unit: foe, tile: { col: 4, row: 4 } });
    expect(sprungId).toBe("pt"); // the entity announced its own spring
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
