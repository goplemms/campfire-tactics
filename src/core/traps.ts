/**
 * Trap-field gameplay — spotting and disarming concealed enemy traps (the lever
 * that motivates the Survivalist).
 *
 * A trap-field encounter pre-places concealed enemy traps (`makeConcealedTrap`,
 * `core/entities`) across the approach. The player experiences traps as a *threat*
 * — step on an unspotted one and it springs — then learns the payoff: spot them
 * with **Awareness**, and a trap-trained unit can **disarm** a spotted one to
 * pocket the kit, which then feeds their own Set Trap. This module holds the pure
 * mechanics; the BattleScene renders the markers and wires the verbs.
 *
 * Pure logic: no Phaser, no DOM; all randomness flows through the run's {@link Rng}.
 */
import type { Unit } from "./units";
import type { Inventory } from "./inventory";
import { addItem } from "./inventory";
import type { Rng } from "./rng";
import { chebyshev } from "./vision";
import { unitSkills } from "./jobs";
import { EntityRegistry, isConcealedTrap, type ConcealedTrap } from "./entities";

/** Spot-roll tuning (D11 awareness). */
export const SPOT = {
  /** Baseline spot chance before modifiers. */
  base: 0.35,
  /** Each Awareness point adds this to the chance. */
  perAwareness: 0.18,
  /** Each point of trap concealment subtracts this. */
  perConcealment: 0.12,
  /** Each tile of distance subtracts this. */
  perDistance: 0.12,
  /** A deliberate Search adds this and extends the radius by `searchRadiusBonus`. */
  searchBonus: 0.3,
  searchRadiusBonus: 2,
} as const;

/** The passive spot radius a unit covers each turn (Awareness-scaled, like sight). */
export function spotRadius(unit: Unit): number {
  return 2 + Math.floor((unit.awareness ?? 0) / 2);
}

/** The probability `unit` spots a trap of `concealment` at `distance` tiles (clamped 0..1). */
export function spotChance(awareness: number, concealment: number, distance: number): number {
  const p =
    SPOT.base +
    SPOT.perAwareness * awareness -
    SPOT.perConcealment * concealment -
    SPOT.perDistance * distance;
  return Math.max(0, Math.min(1, p));
}

/** The concealed traps still hidden (unrevealed, unsprung) on the field. */
export function hiddenTraps(entities: EntityRegistry): ConcealedTrap[] {
  return entities.all().filter((e): e is ConcealedTrap => isConcealedTrap(e) && !e.revealed && !e.sprung);
}

/**
 * Roll `unit`'s Awareness against every hidden trap within range, revealing those
 * it spots. Drives both the passive per-turn pass (defaults) and the active Search
 * (`search: true` — a wider radius and a better roll). Mutates `revealed` on the
 * traps it finds and returns them (so the render can announce + draw them).
 */
export function revealTrapsNear(
  unit: Unit,
  entities: EntityRegistry,
  rng: Rng,
  opts: { search?: boolean } = {},
): ConcealedTrap[] {
  const radius = spotRadius(unit) + (opts.search ? SPOT.searchRadiusBonus : 0);
  const bonus = opts.search ? SPOT.searchBonus : 0;
  const found: ConcealedTrap[] = [];
  for (const trap of hiddenTraps(entities)) {
    const d = chebyshev(unit.pos, trap.pos);
    if (d > radius) continue;
    const p = Math.min(1, spotChance(unit.awareness ?? 0, trap.concealment, d) + bonus);
    if (rng.chance(p)) {
      trap.revealed = true;
      found.push(trap);
    }
  }
  return found;
}

/** True if `unit` knows traps (holds a Set Trap deployment skill) — so it can disarm one. */
export function canDisarm(unit: Unit): boolean {
  return unitSkills(unit, "deployment").some((s) => s.effect.kind === "placeTrap");
}

/** The outcome of a disarm attempt. */
export interface DisarmResult {
  ok: boolean;
  reason?: string;
  /** The material id pocketed on success (omitted if storage was full). */
  harvested?: string;
}

/**
 * Disarm a spotted concealed trap and pocket its kit. Requires a trap-trained unit
 * (the Survivalist) standing adjacent to a **revealed**, un-sprung trap. Removes
 * the entity from the field and adds its material to storage (cap permitting).
 */
export function disarmTrap(
  entities: EntityRegistry,
  trapId: string,
  unit: Unit,
  inv: Inventory,
): DisarmResult {
  const e = entities.all().find((x) => x.id === trapId);
  if (!e || !isConcealedTrap(e)) return { ok: false, reason: "There's no trap there." };
  if (e.sprung) return { ok: false, reason: "That trap has already sprung." };
  if (!e.revealed) return { ok: false, reason: "That trap hasn't been spotted yet." };
  if (!canDisarm(unit)) return { ok: false, reason: "Only a trap-trained unit can disarm a trap." };
  if (chebyshev(unit.pos, e.pos) > 1) return { ok: false, reason: "Move adjacent to disarm it." };
  entities.remove(e.id);
  const stored = addItem(inv, e.materialId, 1);
  return { ok: true, harvested: stored ? e.materialId : undefined };
}
