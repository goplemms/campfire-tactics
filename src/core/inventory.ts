/**
 * Inventory & materials — the logistics pillar's core (D6/D14).
 *
 * Storage is **one party-wide shared stash** of discrete **slots** (no per-unit
 * bags — "wide logistics, micro at the unit"). Items pack as **slotted stacks**:
 * each material defines a `stackSize` (how many fit per stack) and a `slotCost`
 * (slots a stack occupies; bulky items cost more). The **provisioning
 * constraint** is just the cap: you can carry only what storage allows, and
 * later place in Deployment only what you carried.
 *
 * Pure logic: no Phaser, no DOM.
 */

import type { StatDelta } from "./units";
import type { MaterialCost } from "./cost";

/** A material definition — pure data. */
export interface MaterialDef {
  id: string;
  name: string;
  /** How many units fit in one stack (ammo stacks high; a trap kit is 1). */
  stackSize: number;
  /** Slots one stack occupies (most 1; bulky items 2+). */
  slotCost: number;
  /**
   * Whether the material **survives** use and can be recovered on a win (D13).
   * A trap kit survives if unsprung; rune dust is consumed.
   */
  recoverable: boolean;
  /** For buildable entities (a trap): damage it deals. Optional. */
  damage?: number;
  /**
   * Medical consumable (D40 combat↔logistics bridge): the Medic's Heal consumes
   * one of these and applies a **rider keyed by this id** (salve → +healing;
   * stimulant → Hastened; antidote → cleanse a debuff). Provisioning thus has a
   * combat voice — the antidote answer to a snare must be *bought*, not free.
   */
  medical?: boolean;
  /**
   * Sale value (D61): gold a Merchant pays per unit at a full (premium) market;
   * lesser markets pay a fraction (see economy-actions sellPrice). Absent means not
   * sellable. Functional materials carry a modest value (sell surplus gear); the
   * loot class is pure value. Data, a numbers pass later.
   */
  saleValue?: number;
  /**
   * Loot (D61): a sell-only valuables/salvage item, zero function and pure gold
   * value. It drops from encounters as the illiquid half of a reward (found gold is
   * banked; loot must be Sold at a market) and burns a storage slot until then (the
   * haul-vs-gear decision). Never bought/stocked (excluded from shop stock), only sold.
   */
  loot?: boolean;
  /**
   * Party-gear (D78) — a material that confers a **party-wide combat effect simply by
   * being carried**: no equip slot, never moved onto a unit, never leaving the shared
   * stash. While ≥1 is carried the party gets `mods` (a signed {@link StatDelta}) and any
   * `passive`; the shared `gearWear` **dulls** a `maintained` item's positive bonus (the
   * same degradation rule as per-unit equipment — no per-weapon meter, D15/L86–88). Its
   * persistent stash footprint is the point: it competes for storage (the keep-the-buff-or-
   * the-utility discard). Read by {@link "./gear-condition".gearDelta}; the +bonus side is
   * **possession-driven** (the blanket worn-gear −defense stays driven by `gearWear` alone).
   * Possession is **boolean** — carrying ≥1 confers the effect once; copies don't stack
   * (a tuning choice). Distinct from a per-unit {@link "./equipment".EquipmentDef}.
   */
  partyGear?: { mods?: StatDelta; passive?: { key: string; value: number }; maintained?: boolean };
  /**
   * Which shelf the item lists under on the Stores page — a **presentational** grouping
   * only. Combat mechanics still read `medical` / `damage` / `partyGear`, never this, so the
   * two can diverge on purpose: a healing item that isn't a medicinal herb (a rune component
   * for a heal spell) shelves under `"healing"` without a `medical` flag, and a unique weapon
   * shelves under `"equipment"` without an EquipmentDef. Defaults to `"combat"` (the generic
   * functional consumable) when unset. Titles live in the manifest projection.
   */
  category?: "healing" | "combat" | "equipment" | "valuables";
}

/** The carried stash: a storage cap (in slots) and per-material counts. */
export interface Inventory {
  storageCap: number;
  counts: Record<string, number>;
}

/** The materials registry — the single source materials are loaded from. */
export const MATERIALS: Record<string, MaterialDef> = {
  "trap-kit": {
    id: "trap-kit",
    name: "Trap Kit",
    stackSize: 1,
    slotCost: 1,
    recoverable: true,
    damage: 12,
    saleValue: 8, // resell surplus gear (D61) — under the buy price
    category: "combat",
  },
  "rune-reagent": {
    id: "rune-reagent",
    name: "Rune Reagent",
    stackSize: 1,
    slotCost: 1,
    recoverable: false, // consumed on use (rune dust)
    saleValue: 6,
    category: "combat", // casting fuel — a combat consumable, not medicinal
  },
  // The three medical herbs (D40) — the Medic's Heal fuel. Each rider is keyed
  // by id in resolveMedHeal; they stack so a slot carries several.
  salve: { id: "salve", name: "Salve", stackSize: 4, slotCost: 1, recoverable: false, medical: true, saleValue: 4, category: "healing" },
  stimulant: { id: "stimulant", name: "Stimulant", stackSize: 4, slotCost: 1, recoverable: false, medical: true, saleValue: 4, category: "healing" },
  antidote: { id: "antidote", name: "Antidote", stackSize: 4, slotCost: 1, recoverable: false, medical: true, saleValue: 4, category: "healing" },
  // Sell-only loot (D61): pure value, no function. The illiquid half of a reward —
  // hauled in scarce slots until Sold at a market. Never bought/stocked.
  valuables: { id: "valuables", name: "Valuables", stackSize: 4, slotCost: 1, recoverable: false, loot: true, saleValue: 25, category: "valuables" },
  // Foraged provisions (D73) — a cheap, sellable foraged good; the Survivalist's Forage floor.
  "wild-herbs": { id: "wild-herbs", name: "Wild Herbs", stackSize: 6, slotCost: 1, recoverable: false, saleValue: 3, category: "valuables" },
  // A build-defining unique weapon (D52 placeholder) — the Thieves' Den relic. The
  // loadout/item system has no unique-weapon spec yet, so this is a grantable stash
  // item standing in for the relic; its combat effect is TBD with the user.
  "relic-hollow-blade": {
    id: "relic-hollow-blade",
    name: "The Hollow Blade",
    stackSize: 1,
    slotCost: 1,
    recoverable: false,
    saleValue: 80,
    category: "equipment", // a unique weapon — shelves as gear, not a build consumable
  },
  // The first **real equippable** (D77) — a modest, maintained traveler's weapon. It is
  // **dual-registered**: this MaterialDef gives it a storage slot (D14), and an
  // EquipmentDef ({@link "./equipment".EQUIPMENT}) sharing this id gives it its effect
  // (+2 attack, dulled by gearWear). The worked teaching example of the equip surface.
  "wayfarer-blade": {
    id: "wayfarer-blade",
    name: "Wayfarer's Blade",
    stackSize: 1,
    slotCost: 1,
    recoverable: false,
    saleValue: 30,
    category: "equipment",
  },
  // The first **party-gear** (D78) — the Hollow Mill's iron-weapons edge, now a carried
  // material instead of a run flag. It **persistently occupies a stash slot** and confers
  // a party-wide +attack simply by being carried (no equip slot, never moved onto a unit).
  // The shared `gearWear` dulls its bonus (the `maintained` rule, same as per-unit gear);
  // its felt power carries over the old `GEAR_CONDITION.ironAttack` (+3) and decay unchanged.
  "iron-weapons": {
    id: "iron-weapons",
    name: "Iron Weapons",
    stackSize: 1,
    slotCost: 1,
    recoverable: false,
    saleValue: 30,
    partyGear: { mods: { attack: 3 }, maintained: true },
    category: "equipment", // carried party-gear — shelves with the other gear
  },
};

/** Gold a unit of `material` fetches at a full market (0 if not sellable) — read by sell. */
export function saleValueOf(material: MaterialDef): number {
  return material.saleValue ?? 0;
}

/** Look up a material definition by id. */
export function getMaterial(id: string): MaterialDef | undefined {
  return MATERIALS[id];
}

/** A fresh inventory with the given storage cap. */
export function createInventory(storageCap = 6, counts: Record<string, number> = {}): Inventory {
  return { storageCap, counts: { ...counts } };
}

/** Slots a given count of a material occupies (whole stacks round up). */
export function slotsFor(material: MaterialDef, count: number): number {
  if (count <= 0) return 0;
  return Math.ceil(count / material.stackSize) * material.slotCost;
}

/** Total slots an inventory currently uses. */
export function slotsUsed(inv: Inventory): number {
  let used = 0;
  for (const [id, count] of Object.entries(inv.counts)) {
    const mat = getMaterial(id);
    if (mat) used += slotsFor(mat, count);
  }
  return used;
}

/** Slots still free in the stash. */
export function slotsFree(inv: Inventory): number {
  return inv.storageCap - slotsUsed(inv);
}

/** How many of a material are carried. */
export function countOf(inv: Inventory, materialId: string): number {
  return inv.counts[materialId] ?? 0;
}

/**
 * True if a skill's declared **material price** (#113) can be paid from `inv` — the core
 * availability projection behind a greyed-out "0 herbs / 0 kits" button (the render reads this
 * as data, never re-deriving the item id). No material price ⇒ always affordable on this axis.
 * `chosenId` supplies the material for a **runtime-chosen** price (the Medic's herb: the price
 * declares only the count, the caster picks salve/stimulant/antidote); a **fixed** price (the
 * trap kit) ignores it. A runtime-chosen price with nothing chosen is not affordable.
 */
export function canAffordMaterial(price: MaterialCost | undefined, inv: Inventory, chosenId?: string): boolean {
  if (!price) return true;
  const id = price.id ?? chosenId;
  if (id === undefined) return false;
  return countOf(inv, id) >= price.count;
}

/** True if adding `n` of a material would still fit under the storage cap. */
export function canAdd(inv: Inventory, materialId: string, n = 1): boolean {
  const mat = getMaterial(materialId);
  if (!mat || n <= 0) return false;
  const after = slotsFor(mat, countOf(inv, materialId) + n) - slotsFor(mat, countOf(inv, materialId));
  return after <= slotsFree(inv);
}

/**
 * Add `n` of a material if it fits. Returns true on success, false if it would
 * breach the storage cap (the provisioning constraint).
 */
export function addItem(inv: Inventory, materialId: string, n = 1): boolean {
  if (!canAdd(inv, materialId, n)) return false;
  inv.counts[materialId] = countOf(inv, materialId) + n;
  return true;
}

/** Remove `n` of a material (e.g. when placing it in Deployment). */
export function removeItem(inv: Inventory, materialId: string, n = 1): boolean {
  if (countOf(inv, materialId) < n) return false;
  inv.counts[materialId] = countOf(inv, materialId) - n;
  if (inv.counts[materialId] === 0) delete inv.counts[materialId];
  return true;
}

// --- The overflow substrate (D75): grants land, then you discard back to cap ---------
//
// `addItem` is the **cap-enforced** add — used for a player **buy** (you can't buy what
// won't fit). A **grant** (a reward, the relic, a Forage find, a gift) instead uses
// `grantItem`, which **always lands** — even over the cap — so loot never silently vanishes.
// The over-capacity is then resolved by a deliberate **discard**: the interactive camp menu
// (the player picks what to drop) or {@link autoTrim} (the headless default). One honest
// rule across the whole game: *items don't disappear; you choose what to let go.*

/**
 * Grant `n` of a material **unconditionally** — over the storage cap if need be (D75). A grant
 * always lands; the resulting over-capacity (see {@link slotsOver}) is cleared later by a player
 * discard or {@link autoTrim}. Contrast {@link addItem} (cap-enforced, for buys).
 */
export function grantItem(inv: Inventory, materialId: string, n = 1): void {
  if (!getMaterial(materialId) || n <= 0) return;
  inv.counts[materialId] = countOf(inv, materialId) + n;
}

/** Slots the stash is **over** its cap (0 when within) — the overflow a discard must clear (D75). */
export function slotsOver(inv: Inventory): number {
  return Math.max(0, slotsUsed(inv) - inv.storageCap);
}

/**
 * Deterministically discard down to the cap — the **headless default** for an over-capacity
 * stash (D75; the interactive path is the player's discard menu). Sheds the **lowest sale-value**
 * material first (ties broken by id), so high-value loot — the relic — survives. Returns the ids
 * discarded, in order. A no-op when already within cap.
 */
export function autoTrim(inv: Inventory): string[] {
  const discarded: string[] = [];
  while (slotsUsed(inv) > inv.storageCap) {
    const carried = Object.keys(inv.counts).filter((id) => inv.counts[id] > 0);
    if (carried.length === 0) break; // nothing left to shed (shouldn't happen)
    carried.sort((a, b) => (getMaterial(a)?.saleValue ?? 0) - (getMaterial(b)?.saleValue ?? 0) || a.localeCompare(b));
    removeItem(inv, carried[0], 1);
    discarded.push(carried[0]);
  }
  return discarded;
}
