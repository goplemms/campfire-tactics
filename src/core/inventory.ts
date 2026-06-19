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
  },
  "rune-reagent": {
    id: "rune-reagent",
    name: "Rune Reagent",
    stackSize: 1,
    slotCost: 1,
    recoverable: false, // consumed on use (rune dust)
    saleValue: 6,
  },
  // The three medical herbs (D40) — the Medic's Heal fuel. Each rider is keyed
  // by id in resolveMedHeal; they stack so a slot carries several.
  salve: { id: "salve", name: "Salve", stackSize: 4, slotCost: 1, recoverable: false, medical: true, saleValue: 4 },
  stimulant: { id: "stimulant", name: "Stimulant", stackSize: 4, slotCost: 1, recoverable: false, medical: true, saleValue: 4 },
  antidote: { id: "antidote", name: "Antidote", stackSize: 4, slotCost: 1, recoverable: false, medical: true, saleValue: 4 },
  // Sell-only loot (D61): pure value, no function. The illiquid half of a reward —
  // hauled in scarce slots until Sold at a market. Never bought/stocked.
  valuables: { id: "valuables", name: "Valuables", stackSize: 4, slotCost: 1, recoverable: false, loot: true, saleValue: 25 },
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
