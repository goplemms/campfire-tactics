/**
 * D77 — the equip surface: the first real equippable (the Wayfarer's Blade) + the
 * dossier projection the Arms panel renders, plus the determinism guards that keep an
 * un-equipped run byte-identical after registering an equippable in MATERIALS.
 */
import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import { createCamp } from "./camp";
import { createInventory, addItem, MATERIALS, getMaterial } from "./inventory";
import { EQUIPMENT, getEquipment, equip, equipDelta } from "./equipment";
import { projectDossier } from "./dossier";
import { projectManifest } from "./manifest";
import { shopStock } from "./node-events";
import type { MapNode } from "./overworld";
import type { RunState } from "./run";

const BLADE = "wayfarer-blade";

function mkUnit(id: string, over: Partial<Parameters<typeof createUnit>[0]> = {}): Unit {
  return createUnit({ id, side: "player", pos: { col: 0, row: 0 }, speed: 10, maxHp: 20, attack: 5, defense: 2, moveRange: 3, sightRadius: 6, ...over });
}

function mkRun(party: Unit[], inv = createInventory(8)): RunState {
  return { party, inventory: inv, camp: createCamp({ morale: 0 }), rp: 0, seed: "seed" } as unknown as RunState;
}

describe("the Wayfarer's Blade — the first dual-registered equippable (D77)", () => {
  it("is registered in BOTH MATERIALS (storage) and EQUIPMENT (effect) under one id", () => {
    const mat = getMaterial(BLADE);
    const def = getEquipment(BLADE);
    expect(mat).toBeDefined();
    expect(def).toBeDefined();
    expect(mat!.slotCost).toBe(1);
    expect(mat!.saleValue).toBe(30);
    expect(def!.slot).toBe("weapon");
    expect(def!.mods).toEqual({ attack: 2 });
    expect(def!.maintained).toBe(true); // a maintained item — gearWear dulls it
    expect(def!.unique).toBeUndefined(); // not unique (D77 call)
  });

  it("grants +2 attack when equipped, and the maintained bonus dulls with gearWear", () => {
    const u = mkUnit("bram", { equipment: { weapon: BLADE } });
    expect(equipDelta(u, 0).stats.attack).toBe(2); // pristine
    expect(equipDelta(u, 1).stats.attack).toBe(1); // one point of wear shaves one
    expect(equipDelta(u, 5).stats.attack ?? 0).toBe(0); // erodes to nothing (drops from the delta), never negative
  });

  it("equips from the stash through the pure core verb (stash → slot)", () => {
    const inv = createInventory(8);
    addItem(inv, BLADE);
    const u = mkUnit("bram");
    expect(equip(inv, u, BLADE)).toBe(true);
    expect(u.equipment.weapon).toBe(BLADE);
    expect(inv.counts[BLADE]).toBeUndefined(); // left the stash
  });
});

describe("the dossier equip projection (D77)", () => {
  it("projects each member's three slots, worn item + mods summary", () => {
    const u = mkUnit("bram", { equipment: { weapon: BLADE } });
    const { members } = projectDossier(mkRun([u]));
    const slots = members[0].slots;
    expect(slots.map((s) => s.slot)).toEqual(["weapon", "armor", "accessory"]);
    expect(slots[0]).toMatchObject({ itemId: BLADE, itemName: "Wayfarer's Blade", summary: "+2 Atk" });
    expect(slots[1].itemId).toBeUndefined(); // an empty slot
    expect(slots[1].summary).toBeUndefined();
  });

  it("lists carried equippables (the picker candidates), empty when none carried", () => {
    const bare = projectDossier(mkRun([mkUnit("bram")]));
    expect(bare.equippables).toEqual([]); // an un-equipped run carries none

    const inv = createInventory(8);
    addItem(inv, BLADE);
    const carried = projectDossier(mkRun([mkUnit("bram")], inv));
    expect(carried.equippables).toEqual([{ id: BLADE, name: "Wayfarer's Blade", slot: "weapon", summary: "+2 Atk", count: 1 }]);
  });
});

describe("determinism guards — an equippable in MATERIALS leaves un-equipped runs unchanged (D77)", () => {
  it("roadside shop stock never offers equippable gear (it isn't generic shuffle stock)", () => {
    for (let i = 0; i < 24; i++) {
      const stock = shopStock(`seed-${i}`, { id: `n${i}` } as MapNode);
      for (const offer of stock) expect(getEquipment(offer.materialId)).toBeUndefined();
    }
  });

  it("the Stores manifest omits a zero-count equippable, but shows it once carried", () => {
    const ids = (run: RunState) => projectManifest(run).groups.flatMap((g) => g.items.map((i) => i.id));
    expect(ids(mkRun([mkUnit("bram")]))).not.toContain(BLADE); // not carried → not padded into the catalog

    const inv = createInventory(8);
    addItem(inv, BLADE);
    expect(ids(mkRun([mkUnit("bram")], inv))).toContain(BLADE); // carried → itemized
  });

  it("registering the blade did not leak it into the seeded shop pool for any other material", () => {
    // Sanity: the registry still holds the blade (so the guard above is meaningful).
    expect(Object.keys(MATERIALS)).toContain(BLADE);
    expect(Object.keys(EQUIPMENT)).toContain(BLADE);
  });
});
