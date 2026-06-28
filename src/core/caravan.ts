/**
 * Caravans (M9, D25) — the expedition vessel + the lock ledger, pure.
 *
 * A **caravan** is one expedition's vessel: a **typed, upgradeable** wagon that
 * bundles the four committed scarcities the guild tier manufactures —
 *
 * 1. **Party slots** — who you bring. **Slots are UNIFORM** (D25): any character
 *    fits any slot, capped at the vessel's `capacity`, so bringing the Cook
 *    genuinely costs a fighter. Caravan *size* is the only dial.
 * 2. **Storage** — the D14 shared-stack cap, now a **per-caravan** property.
 * 3. **Locked equipment** — gear committed here is **unavailable to other
 *    caravans** until this one returns (you can't field one good sword twice).
 * 4. **The purse** — run gold loaded from the treasury at dispatch (D34).
 *
 * The **lock** is the portfolio cost of model C (D26): the same person/gear can't
 * be committed to two caravans at once. This module is the headless ledger that
 * proves it; {@link "./guild"} orchestrates dispatch/return around it.
 *
 * **Data-driven (D4):** a {@link VesselType} is data (capacity/storage/speed/cost);
 * a new wagon is a new record, not a new branch.
 *
 * Pure logic: no Phaser, no DOM, no `Math.random`.
 */

import type { Unit } from "./units";
import { nonNegInt } from "./num";

/** A vessel type — the authored tradeoff axis (D25). Pure data. */
export interface VesselType {
  id: string;
  label: string;
  /** Party slots (uniform — any character fits). */
  capacity: number;
  /** Per-caravan storage cap (the D14 shared-stack cap). */
  storageCap: number;
  /** Travel speed flavour (scout cart ↔ supply train); cosmetic in M9. */
  speed: number;
  /** Treasury cost to field (a guild-economy hook for M10; recorded now). */
  cost: number;
}

/** The vessel roster (D25) — data; new wagons are new records. */
export const VESSELS: Record<string, VesselType> = {
  "scout-cart": {
    id: "scout-cart",
    label: "Scout Cart",
    capacity: 2,
    storageCap: 4,
    speed: 3,
    cost: 20,
  },
  "supply-train": {
    id: "supply-train",
    label: "Supply Train",
    capacity: 5,
    storageCap: 10,
    speed: 1,
    cost: 80,
  },
} as const;

/** Look up a vessel type by id (throws on an unknown id — vessels are data). */
export function getVessel(id: string): VesselType {
  const v = VESSELS[id];
  if (!v) throw new Error(`caravan: unknown vessel type "${id}"`);
  return v;
}

/**
 * A caravan — the live expedition bundle. Before dispatch it's assembled at the
 * guild hall; at dispatch its party/gear/purse are **locked** and a deterministic
 * run is built from it ({@link "./guild".dispatch}). While in flight `dispatched`
 * is true and the bundle stays intact so the lock holds for the other caravans.
 */
export interface Caravan {
  id: string;
  vesselId: string;
  /** Assigned party (uniform slots, capped at the vessel capacity). */
  party: Unit[];
  /** Per-caravan storage cap (from the vessel; the Merchant upgrades it later). */
  storageCap: number;
  /** Loaded supplies — provisioned inventory counts (material id → count). */
  supplies: Record<string, number>;
  /** Locked equipment — gear ids committed to this caravan (the lock). */
  gear: string[];
  /** The run purse — treasury gold loaded for this trip (D34). */
  purse: number;
  /** True once dispatched (a run is in flight); the bundle stays locked. */
  dispatched: boolean;
}

/** Create a fresh, empty caravan on a given vessel (storage from the vessel). */
export function createCaravan(id: string, vesselId: string): Caravan {
  const vessel = getVessel(vesselId);
  return {
    id,
    vesselId,
    party: [],
    storageCap: vessel.storageCap,
    supplies: {},
    gear: [],
    purse: 0,
    dispatched: false,
  };
}

/** The caravan's party-slot capacity (its vessel's, uniform — D25). */
export function caravanCapacity(caravan: Caravan): number {
  return getVessel(caravan.vesselId).capacity;
}

/** Free party slots remaining on the caravan. */
export function slotsRemaining(caravan: Caravan): number {
  return caravanCapacity(caravan) - caravan.party.length;
}

/** True if a unit is assigned to this caravan. */
export function hasMember(caravan: Caravan, unit: Unit): boolean {
  return caravan.party.some((u) => u.id === unit.id);
}

/** True if a gear id is locked to this caravan. */
export function hasGear(caravan: Caravan, gearId: string): boolean {
  return caravan.gear.includes(gearId);
}

/** The set of unit ids committed across the given caravans (the member lock). */
export function committedMemberIds(caravans: readonly Caravan[]): Set<string> {
  const ids = new Set<string>();
  for (const c of caravans) for (const u of c.party) ids.add(u.id);
  return ids;
}

/** The set of gear ids committed across the given caravans (the gear lock). */
export function committedGearIds(caravans: readonly Caravan[]): Set<string> {
  const ids = new Set<string>();
  for (const c of caravans) for (const g of c.gear) ids.add(g);
  return ids;
}

/**
 * Why a unit can't be assigned to `caravan` right now — capacity, already aboard,
 * or **already committed to another caravan** (the lock) — or `null` if it can.
 * `others` is the rest of the stable; pass it to enforce the cross-caravan lock.
 */
export function memberRefusal(
  caravan: Caravan,
  unit: Unit,
  others: readonly Caravan[] = [],
): string | null {
  if (caravan.dispatched) return "Caravan already dispatched.";
  if (hasMember(caravan, unit)) return `${unit.name} is already aboard.`;
  if (slotsRemaining(caravan) <= 0) return "No free slots on this vessel.";
  if (committedMemberIds(others).has(unit.id)) return `${unit.name} is committed to another caravan.`;
  return null;
}

/** Assign a unit to a caravan (uniform slot). Throws on a refusal. */
export function assignMember(caravan: Caravan, unit: Unit, others: readonly Caravan[] = []): void {
  const refusal = memberRefusal(caravan, unit, others);
  if (refusal) throw new Error(`caravan: ${refusal}`);
  caravan.party.push(unit);
}

/** Remove a unit from a caravan's party. Returns true if it was aboard. */
export function unassignMember(caravan: Caravan, unit: Unit): boolean {
  const i = caravan.party.findIndex((u) => u.id === unit.id);
  if (i < 0) return false;
  caravan.party.splice(i, 1);
  return true;
}

/**
 * Why a gear id can't be locked to `caravan` — already aboard, or **committed to
 * another caravan** (the lock) — or `null` if it can.
 */
export function gearRefusal(
  caravan: Caravan,
  gearId: string,
  others: readonly Caravan[] = [],
): string | null {
  if (caravan.dispatched) return "Caravan already dispatched.";
  if (hasGear(caravan, gearId)) return `${gearId} is already loaded.`;
  if (committedGearIds(others).has(gearId)) return `${gearId} is locked to another caravan.`;
  return null;
}

/** Lock a gear id to a caravan. Throws on a refusal (can't field one sword twice). */
export function lockGear(caravan: Caravan, gearId: string, others: readonly Caravan[] = []): void {
  const refusal = gearRefusal(caravan, gearId, others);
  if (refusal) throw new Error(`caravan: ${refusal}`);
  caravan.gear.push(gearId);
}

/** Unlock a gear id from a caravan. Returns true if it was loaded. */
export function unlockGear(caravan: Caravan, gearId: string): boolean {
  const i = caravan.gear.indexOf(gearId);
  if (i < 0) return false;
  caravan.gear.splice(i, 1);
  return true;
}

/** Load supplies into the caravan (respecting nothing here — the run enforces the cap). */
export function loadSupply(caravan: Caravan, materialId: string, n = 1): void {
  caravan.supplies[materialId] = (caravan.supplies[materialId] ?? 0) + n;
}

/** Set the caravan's purse (the treasury→purse load at dispatch, D34). */
export function loadPurse(caravan: Caravan, amount: number): void {
  caravan.purse = nonNegInt(amount);
}

/** Clear a caravan back to empty/assembling (after a return or a wipe). */
export function resetCaravan(caravan: Caravan): void {
  caravan.party = [];
  caravan.supplies = {};
  caravan.gear = [];
  caravan.purse = 0;
  caravan.dispatched = false;
}
