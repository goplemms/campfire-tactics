/**
 * Per-unit equipment (D76) — the **Arms** half of the gear/item system.
 *
 * The gear model is two orthogonal axes:
 *   - **Condition** (blanket, D15/D52): the party-wide `gearWear` maintenance axis,
 *     paid down by Repairs. It is the *only* durability axis — there is **no
 *     per-weapon meter** (logistics.md L86–88).
 *   - **Arms** (this module): discrete worn gear you *acquire and equip*. Two scopes
 *     share the model — **per-unit** slots (weapon/armor/accessory, the home of
 *     build-defining uniques like the relic) and the blanket **party set** (the
 *     iron-weapons edge, which still lives in {@link "./gear-condition".gearDelta}).
 *
 * Equipment **grants** stat deltas (and optional keyworded passives); Condition
 * **degrades** the *maintained* ones (worn gear dulls a blade) — so the two axes
 * meet without a private meter: the degradation reads the shared `gearWear`, never a
 * per-item number. A `maintained: false` item (a relic) shrugs off wear ("legendary
 * doesn't rust").
 *
 * Combat reads equipment for free: {@link "./gear-condition".applyGearCondition}
 * folds the per-unit {@link equipDelta} into the same revertible stamp the blanket
 * condition uses, so the unit's plain `attack`/`defense`/… carry it and no `run`
 * import threads into combat. An **un-equipped** unit contributes the empty delta —
 * an identity — so an un-upgraded run stays byte-identical.
 *
 * Pure logic: no Phaser, no DOM, no `Math.random`.
 */

import type { Unit, UnitStats, StatDelta, EquipSlot } from "./units";
import type { Inventory } from "./inventory";
import { addItem, canAdd, countOf, removeItem } from "./inventory";

/** The numeric {@link UnitStats} keys a gear delta may touch (the stamp's domain). */
export const STAT_KEYS = [
  "speed",
  "maxHp",
  "attack",
  "defense",
  "moveRange",
  "sightRadius",
  "attackRange",
] as const satisfies readonly (keyof UnitStats)[];

/**
 * Worn gear dulls maintained equipment: each point of `gearWear` shaves this much
 * off a maintained item's **positive** attack/defense bonus (floored at 0 — a bonus
 * erodes to nothing but never flips into a penalty). Mirrors the iron-weapons decay
 * rate in {@link "./gear-condition".GEAR_CONDITION} (kept local to avoid an import
 * cycle). The blanket worn-gear −defense (the negative side) rides the condition axis.
 */
export const EQUIP_DECAY_PER_WEAR = 1;

/** Stats degradation touches (positive bonuses only) — a worn bow still shoots as far. */
const DEGRADABLE_STATS = ["attack", "defense"] as const satisfies readonly (keyof UnitStats)[];

/**
 * An equippable item (D76) — pure data, registered in {@link EQUIPMENT}. An item id
 * that *also* exists in {@link "./inventory".MATERIALS} can sit in the shared stash
 * (for storage accounting) and be moved onto a unit by {@link equip}; the relic is
 * the first such dual id (its `EquipmentDef` is deferred until its effect is designed).
 */
export interface EquipmentDef {
  id: string;
  name: string;
  /** Which per-unit slot it fills (one item per slot). */
  slot: EquipSlot;
  /** Stat deltas granted while equipped (signed; e.g. `{ attack: 3 }`). */
  mods?: StatDelta;
  /**
   * A keyworded passive granted while worn (reuses the unit `passives` bag, keyed by
   * {@link "./combat".PASSIVE}). Combat reads it like a job passive. Effect TBD per item.
   */
  passive?: { key: string; value: number };
  /**
   * Whether the blanket condition axis degrades this item (default **true**). Mundane
   * gear dulls with `gearWear`; a unique/relic sets `false` ("legendary doesn't rust").
   */
  maintained?: boolean;
  /**
   * Build-defining unique (D25 "can't field one good sword twice") — {@link equip}
   * refuses to seat it on a second unit. Defaults to false.
   */
  unique?: boolean;
  /** Gold value (buy/sell), optional — mirrors {@link "./inventory".MaterialDef.saleValue}. */
  saleValue?: number;
}

/**
 * The equipment registry — the single source equippable items load from (sibling of
 * {@link "./inventory".MATERIALS}). **Empty for now**: the per-unit substrate ships
 * ahead of its content — the relic (`relic-hollow-blade`) stays an inert stash
 * material until its effect is designed, and the party set (iron-weapons) lives in
 * {@link "./gear-condition"}. Authored/test content registers entries by id.
 */
export const EQUIPMENT: Record<string, EquipmentDef> = {};

/** Look up an equipment definition by id. */
export function getEquipment(id: string): EquipmentDef | undefined {
  return EQUIPMENT[id];
}

/** A lookup for an equipment def by id — injectable so tests/content can override. */
export type EquipLookup = (id: string) => EquipmentDef | undefined;

/** Add `src` into `dst` key-by-key (summing), in place. Returns `dst`. */
function addDelta(dst: StatDelta, src: StatDelta | undefined): StatDelta {
  if (!src) return dst;
  for (const k of STAT_KEYS) {
    const v = src[k];
    if (v) dst[k] = (dst[k] ?? 0) + v;
  }
  return dst;
}

/** The mods one equipped item contributes, after `wear` degradation if maintained. */
function itemDelta(def: EquipmentDef, wear: number): StatDelta {
  const out: StatDelta = { ...def.mods };
  if (def.maintained === false || wear <= 0) return out;
  for (const k of DEGRADABLE_STATS) {
    const v = out[k];
    if (v && v > 0) out[k] = Math.max(0, v - wear * EQUIP_DECAY_PER_WEAR);
  }
  return out;
}

/**
 * The aggregate stat delta + passives a unit's **equipped** gear grants, given the
 * blanket `wear` (degrades maintained gear). An empty loadout returns the identity
 * (`{ stats: {}, passives: {} }`). Pure; does not mutate the unit.
 */
export function equipDelta(
  unit: Pick<Unit, "equipment">,
  wear = 0,
  lookup: EquipLookup = getEquipment,
): { stats: StatDelta; passives: Record<string, number> } {
  const stats: StatDelta = {};
  const passives: Record<string, number> = {};
  for (const slot of Object.keys(unit.equipment) as EquipSlot[]) {
    const id = unit.equipment[slot];
    if (!id) continue;
    const def = lookup(id);
    if (!def) continue;
    addDelta(stats, itemDelta(def, Math.max(0, wear)));
    if (def.passive) passives[def.passive.key] = (passives[def.passive.key] ?? 0) + def.passive.value;
  }
  return { stats, passives };
}

/**
 * Apply a signed {@link StatDelta} to a unit's stats, clamping each result at ≥ 0,
 * and return the **actual** per-key delta applied (post-clamp) so {@link revertStatDelta}
 * is exact. A `maxHp` change clamps `hp` down if it now exceeds the new cap (a
 * +maxHp leaves current hp as headroom, the RPG-standard behaviour). Mutates `unit`.
 */
export function applyStatDelta(unit: Unit, delta: StatDelta): StatDelta {
  const applied: StatDelta = {};
  for (const k of STAT_KEYS) {
    const d = delta[k];
    if (!d) continue;
    const before = unit[k] ?? 0;
    const after = Math.max(0, before + d);
    if (after !== before) {
      unit[k] = after;
      applied[k] = after - before;
    }
  }
  if (applied.maxHp && unit.hp > unit.maxHp) unit.hp = unit.maxHp;
  return applied;
}

/** Undo an {@link applyStatDelta} (subtracts the recorded deltas), clamping hp. Mutates `unit`. */
export function revertStatDelta(unit: Unit, applied: StatDelta): void {
  for (const k of STAT_KEYS) {
    const d = applied[k];
    if (d) unit[k] = Math.max(0, (unit[k] ?? 0) - d);
  }
  if (applied.maxHp && unit.hp > unit.maxHp) unit.hp = unit.maxHp;
}

/**
 * Equip a carried item onto a unit's matching slot (D76) — the stash → slot move, a
 * Camp/Pre-deployment verb. Fails (returns false) if the id isn't a known
 * `EquipmentDef`, isn't carried in the stash, would field a `unique` already worn by
 * another party member (D25), or — when the slot is occupied — the displaced item
 * can't fit back into the stash. On success the new item leaves the stash, any prior
 * item in that slot returns to it, and the slot is set. Pure (mutates `inv` + `unit`).
 */
export function equip(
  inv: Inventory,
  unit: Unit,
  itemId: string,
  opts: { party?: readonly Unit[]; lookup?: EquipLookup } = {},
): boolean {
  const lookup = opts.lookup ?? getEquipment;
  const def = lookup(itemId);
  if (!def) return false;
  if (countOf(inv, itemId) < 1) return false;
  if (def.unique && (opts.party ?? []).some((u) => u !== unit && equippedIds(u).includes(itemId))) {
    return false; // can't field one good sword twice (D25)
  }
  const prior = unit.equipment[def.slot];
  // A swap must be able to stow the displaced item before we commit (count the
  // freed slot from removing the incoming item, which we do first).
  removeItem(inv, itemId);
  if (prior) {
    if (!canAdd(inv, prior)) {
      addItem(inv, itemId); // roll back the removal
      return false;
    }
    addItem(inv, prior);
  }
  unit.equipment[def.slot] = itemId;
  return true;
}

/**
 * Unequip a unit's slot back into the stash (D76) — the slot → stash move. Fails if
 * the slot is empty or the stash has no room for the returned item. Mutates `inv` + `unit`.
 */
export function unequip(inv: Inventory, unit: Unit, slot: EquipSlot): boolean {
  const id = unit.equipment[slot];
  if (!id) return false;
  if (!canAdd(inv, id)) return false;
  addItem(inv, id);
  delete unit.equipment[slot];
  return true;
}

/** The equipment ids a unit currently wears (D76), in slot order; empty if bare. */
export function equippedIds(unit: Pick<Unit, "equipment">): string[] {
  const out: string[] = [];
  for (const slot of ["weapon", "armor", "accessory"] as EquipSlot[]) {
    const id = unit.equipment[slot];
    if (id) out.push(id);
  }
  return out;
}
