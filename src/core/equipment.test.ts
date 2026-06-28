import { describe, it, expect, beforeEach } from "vitest";
import { createUnit, type Unit, type UnitSpec } from "./units";
import {
  EQUIPMENT,
  equip,
  unequip,
  equipDelta,
  equippedIds,
  applyStatDelta,
  revertStatDelta,
  type EquipmentDef,
} from "./equipment";
import { MATERIALS, createInventory, countOf, type MaterialDef } from "./inventory";
import { applyGearCondition, revertGearStamp } from "./gear-condition";
import type { RunState } from "./run";

// --- fixtures ---------------------------------------------------------------
// An equippable stash item is BOTH a MaterialDef (storage accounting) and an
// EquipmentDef (effect), sharing one id — the relic's dual shape (D76). Register
// fixtures in both registries so equip/unequip's stash math works.

const FIXTURE_MATERIAL: Omit<MaterialDef, "id" | "name"> = {
  stackSize: 1,
  slotCost: 1,
  recoverable: false,
};

const FIXTURES: Record<string, EquipmentDef> = {
  "iron-sword": { id: "iron-sword", name: "Iron Sword", slot: "weapon", mods: { attack: 4 } },
  "leather-vest": { id: "leather-vest", name: "Leather Vest", slot: "armor", mods: { defense: 3 } },
  "swift-charm": { id: "swift-charm", name: "Swift Charm", slot: "accessory", mods: { speed: 2 }, maintained: false },
  "relic-blade": {
    id: "relic-blade",
    name: "Relic Blade",
    slot: "weapon",
    mods: { attack: 6 },
    maintained: false,
    unique: true,
    passive: { key: "deadeye", value: 1 },
  },
};

beforeEach(() => {
  for (const id of Object.keys(EQUIPMENT)) delete EQUIPMENT[id];
  for (const [id, def] of Object.entries(FIXTURES)) {
    EQUIPMENT[id] = def;
    MATERIALS[id] = { id, name: def.name, ...FIXTURE_MATERIAL };
  }
});

function mkUnit(over: Partial<UnitSpec> = {}): Unit {
  return createUnit({
    id: "u",
    side: "player",
    pos: { col: 0, row: 0 },
    speed: 10,
    maxHp: 30,
    attack: 8,
    defense: 5,
    moveRange: 4,
    sightRadius: 5,
    ...over,
  });
}

/** A minimal run stub for the gear-condition aggregate (reads camp.gearWear + flags). */
function mkRun(gearWear = 0, flags: Record<string, boolean> = {}): RunState {
  return { camp: { gearWear }, flags } as RunState;
}

// --- equipDelta -------------------------------------------------------------

describe("equipDelta", () => {
  it("a bare unit contributes the identity (empty delta, no passives)", () => {
    const u = mkUnit();
    expect(equipDelta(u)).toEqual({ stats: {}, passives: {} });
  });

  it("sums the mods of every filled slot", () => {
    const u = mkUnit({ equipment: { weapon: "iron-sword", armor: "leather-vest" } });
    expect(equipDelta(u).stats).toEqual({ attack: 4, defense: 3 });
  });

  it("collects keyworded passives from worn gear", () => {
    const u = mkUnit({ equipment: { weapon: "relic-blade" } });
    expect(equipDelta(u).passives).toEqual({ deadeye: 1 });
  });

  it("ignores ids absent from the registry", () => {
    const u = mkUnit({ equipment: { weapon: "ghost-axe" } });
    expect(equipDelta(u)).toEqual({ stats: {}, passives: {} });
  });

  it("condition (gearWear) degrades a maintained item's positive attack/defense, floored at 0", () => {
    const u = mkUnit({ equipment: { weapon: "iron-sword", armor: "leather-vest" } });
    expect(equipDelta(u, 1).stats).toEqual({ attack: 3, defense: 2 }); // 4-1, 3-1
    expect(equipDelta(u, 99).stats).toEqual({}); // eroded to nothing — no contribution, never negative
  });

  it("an unmaintained item (a relic) shrugs off wear", () => {
    const u = mkUnit({ equipment: { weapon: "relic-blade", accessory: "swift-charm" } });
    expect(equipDelta(u, 99).stats).toEqual({ attack: 6, speed: 2 }); // undecayed
  });
});

// --- applyStatDelta / revertStatDelta --------------------------------------

describe("stat delta apply/revert", () => {
  it("applies signed deltas and reports the actual applied change", () => {
    const u = mkUnit();
    const applied = applyStatDelta(u, { attack: 3, defense: -2 });
    expect(u.attack).toBe(11);
    expect(u.defense).toBe(3);
    expect(applied).toEqual({ attack: 3, defense: -2 });
  });

  it("clamps a stat at 0 and records the clamped (exact) delta so revert is lossless", () => {
    const u = mkUnit({ defense: 2 });
    const applied = applyStatDelta(u, { defense: -5 });
    expect(u.defense).toBe(0);
    expect(applied).toEqual({ defense: -2 }); // only 2 came off, not 5
    revertStatDelta(u, applied);
    expect(u.defense).toBe(2); // exact restore (no over-restore)
  });

  it("a round-trip restores every stat exactly", () => {
    const u = mkUnit();
    const before = { attack: u.attack, defense: u.defense, speed: u.speed };
    const applied = applyStatDelta(u, { attack: 4, defense: 3, speed: -1 });
    revertStatDelta(u, applied);
    expect({ attack: u.attack, defense: u.defense, speed: u.speed }).toEqual(before);
  });

  it("+maxHp leaves current hp as headroom; reverting maxHp clamps hp back down", () => {
    const u = mkUnit({ hp: 30, maxHp: 30 });
    const applied = applyStatDelta(u, { maxHp: 10 });
    expect(u.maxHp).toBe(40);
    expect(u.hp).toBe(30); // not auto-healed
    u.hp = 38; // heal into the headroom
    revertStatDelta(u, applied);
    expect(u.maxHp).toBe(30);
    expect(u.hp).toBe(30); // clamped to the restored cap
  });
});

// --- applyGearCondition (the aggregate stamp) -------------------------------

describe("applyGearCondition with equipment", () => {
  it("a bare unit, no iron, no wear → byte-identical (empty stamp, revert is a no-op)", () => {
    const u = mkUnit();
    applyGearCondition(mkRun(), [u]);
    expect(u.attack).toBe(8);
    expect(u.defense).toBe(5);
    expect(u.gearStamp).toEqual({ stats: {}, passives: undefined });
    revertGearStamp(u);
    expect(u.attack).toBe(8);
    expect(u.defense).toBe(5);
  });

  it("stamps the per-unit equipment delta and reverts it cleanly", () => {
    const u = mkUnit({ equipment: { weapon: "iron-sword", armor: "leather-vest" } });
    applyGearCondition(mkRun(), [u]);
    expect(u.attack).toBe(12); // 8 + 4
    expect(u.defense).toBe(8); // 5 + 3
    revertGearStamp(u);
    expect(u.attack).toBe(8);
    expect(u.defense).toBe(5);
  });

  it("combines the blanket party set (iron-weapons) with per-unit gear and shared wear", () => {
    const u = mkUnit({ equipment: { weapon: "iron-sword" } });
    // iron flag (+3 attack, decays 1/wear) + worn-gear (−1 defense/wear) at wear 1,
    // plus the maintained iron-sword (+4 attack, −1 from wear).
    applyGearCondition(mkRun(1, { "iron-weapons": true }), [u]);
    // attack: 8 + (iron 3-1) + (sword 4-1) = 8 + 2 + 3 = 13
    expect(u.attack).toBe(13);
    // defense: 5 − 1 (worn-gear penalty) = 4
    expect(u.defense).toBe(4);
    revertGearStamp(u);
    expect(u.attack).toBe(8);
    expect(u.defense).toBe(5);
  });

  it("stamps and reverts equipment-granted passives", () => {
    const u = mkUnit({ equipment: { weapon: "relic-blade" } });
    applyGearCondition(mkRun(), [u]);
    expect(u.attack).toBe(14); // 8 + 6 (relic undecayed)
    expect(u.passives.deadeye).toBe(1);
    revertGearStamp(u);
    expect(u.passives.deadeye).toBeUndefined(); // removed, not left at 0
  });

  it("re-applying first reverts the prior stamp (idempotent across re-stages)", () => {
    const u = mkUnit({ equipment: { weapon: "iron-sword" } });
    applyGearCondition(mkRun(), [u]);
    applyGearCondition(mkRun(), [u]);
    expect(u.attack).toBe(12); // not double-stamped to 16
  });
});

// --- equip / unequip (stash <-> slot) --------------------------------------

describe("equip / unequip", () => {
  it("moves an item from the stash into its slot, freeing the slot", () => {
    const inv = createInventory(6, { "iron-sword": 1 });
    const u = mkUnit();
    expect(equip(inv, u, "iron-sword")).toBe(true);
    expect(u.equipment.weapon).toBe("iron-sword");
    expect(countOf(inv, "iron-sword")).toBe(0); // left the stash
  });

  it("refuses to equip an item not carried in the stash", () => {
    const inv = createInventory(6);
    const u = mkUnit();
    expect(equip(inv, u, "iron-sword")).toBe(false);
    expect(u.equipment.weapon).toBeUndefined();
  });

  it("refuses an unknown equipment id", () => {
    const inv = createInventory(6, { "ghost-axe": 1 });
    const u = mkUnit();
    expect(equip(inv, u, "ghost-axe")).toBe(false);
  });

  it("swaps: a new item enters the slot and the displaced one returns to the stash", () => {
    const inv = createInventory(6, { "iron-sword": 1, "relic-blade": 1 });
    const u = mkUnit();
    equip(inv, u, "iron-sword");
    expect(equip(inv, u, "relic-blade")).toBe(true);
    expect(u.equipment.weapon).toBe("relic-blade");
    expect(countOf(inv, "iron-sword")).toBe(1); // displaced back to the stash
    expect(countOf(inv, "relic-blade")).toBe(0);
  });

  it("unequip returns the item to the stash and clears the slot", () => {
    const inv = createInventory(6, { "iron-sword": 1 });
    const u = mkUnit();
    equip(inv, u, "iron-sword");
    expect(unequip(inv, u, "weapon")).toBe(true);
    expect(u.equipment.weapon).toBeUndefined();
    expect(countOf(inv, "iron-sword")).toBe(1);
  });

  it("unequip fails on an empty slot", () => {
    const inv = createInventory(6);
    const u = mkUnit();
    expect(unequip(inv, u, "weapon")).toBe(false);
  });

  it("a unique cannot be fielded on a second unit (D25 'one good sword')", () => {
    const inv = createInventory(6, { "relic-blade": 2 }); // two copies carried...
    const a = mkUnit({ id: "a" });
    const b = mkUnit({ id: "b" });
    const party = [a, b];
    expect(equip(inv, a, "relic-blade", { party })).toBe(true);
    expect(equip(inv, b, "relic-blade", { party })).toBe(false); // ...still can't double-field it
    expect(b.equipment.weapon).toBeUndefined();
  });
});

describe("equippedIds", () => {
  it("lists worn ids in slot order; empty when bare", () => {
    expect(equippedIds(mkUnit())).toEqual([]);
    const u = mkUnit({ equipment: { accessory: "swift-charm", weapon: "iron-sword" } });
    expect(equippedIds(u)).toEqual(["iron-sword", "swift-charm"]); // weapon before accessory
  });
});
