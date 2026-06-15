/**
 * Attack/damage resolution and win/lose detection.
 *
 * Pure logic: no Phaser, no DOM. Damage is the classic `max(1, atk - def)`; a
 * defeated unit flips `alive = false`. When a {@link EventBus} is passed,
 * `onUnitDamaged` / `onUnitDefeated` fire so listeners (and the render layer)
 * can react — the same bus a trap or aura would hang off.
 */

import type { Unit, Side } from "./units";
import type { GridCoord } from "./iso";
import type { EventBus } from "./events";
import {
  hasStatus,
  isDebuffed,
  statusAmount,
  markOf,
  markBonus,
  applyStatus,
  removeStatus,
  slowed,
  EXPOSED,
  GUARDED,
  SLOWED,
  SWIFT,
  STATUS_TUNING,
} from "./status";

/** Manhattan distance — matches the grid's 4-connected movement. */
export function manhattan(a: GridCoord, b: GridCoord): number {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

/** True if two tiles are orthogonally adjacent (melee range). */
export function isAdjacent(a: GridCoord, b: GridCoord): boolean {
  return manhattan(a, b) === 1;
}

/** True if `attacker` can reach `target` with a basic attack (its `attackRange`). */
export function inAttackRange(attacker: Unit, target: Unit): boolean {
  return manhattan(attacker.pos, target.pos) <= attacker.attackRange;
}

/** Flanking tuning (D36) — one tunable number. */
export const FLANK = { bonus: 4 } as const;

/**
 * Passive-parameter keys (D40) a job stamps onto a unit and combat reads. Kept
 * here so combat stays self-contained (no jobs import — that would cycle).
 */
export const PASSIVE = {
  /** Scout Flanker: flank an isolated target **solo** (no second body needed). */
  flankSolo: "flankSolo",
  /** Scout Flanker: flank bonus override (bigger than the baseline +4). */
  flankBonus: "flankBonus",
  /** Hunter Deadeye: bonus damage against a debuffed target. */
  deadeye: "deadeye",
  /** Medic Triage: missing-HP heal-scaling factor (read by the heal resolver). */
  triage: "triage",
  /** Heavy Knight Hold-the-Line: emits the speed-1 tarpit to adjacent foes. */
  tarpit: "tarpit",
} as const;

/** A unit's **effective** move this turn: base move + the Swift buff (Dash). */
export function effectiveMove(unit: Unit): number {
  return unit.moveRange + statusAmount(unit, SWIFT);
}

/**
 * Recompute the Heavy Knight's **Hold the Line** tarpit aura (D40), an
 * aura-maintained status (D41): every foe orthogonally adjacent to a tarpit unit
 * is Slowed to speed 1 while in the ring, cleared on leaving. Re-run whenever
 * positions change (after a move) so the clock reads the right speed. Only the
 * aura's own Slowed is added/removed — a skill-applied Slow is left alone.
 */
export function refreshAuras(units: readonly Unit[]): void {
  const rings = units.filter((u) => u.alive && !u.captured && u.passives[PASSIVE.tarpit]);
  for (const u of units) {
    if (!u.alive || u.captured) continue;
    const inRing = rings.some((k) => k.side !== u.side && isAdjacent(k.pos, u.pos));
    const cur = u.statuses.find((s) => s.id === SLOWED && s.data?.aura === "tarpit");
    if (inRing && !cur) {
      applyStatus(u, {
        ...slowed(Infinity, STATUS_TUNING.tarpitSpeed),
        data: { amount: STATUS_TUNING.tarpitSpeed, aura: "tarpit" },
      });
    } else if (!inRing && cur) {
      removeStatus(u, SLOWED);
    }
  }
}

/**
 * Count living, non-captured units on `side` orthogonally adjacent to `target`
 * (excluding `target` itself). **Body-counting (D36):** an Immobilized unit
 * still counts (it pincers / it shelters); captured or downed units don't (they
 * aren't an active threat — `alive`/`captured` already exclude them).
 */
export function adjacentBodies(
  target: Unit,
  units: readonly Unit[],
  side: Side,
): number {
  return units.filter(
    (u) =>
      u.alive &&
      !u.captured &&
      u.side === side &&
      u !== target &&
      isAdjacent(u.pos, target.pos),
  ).length;
}

/**
 * The flank bonus `attacker` earns hitting `defender` (D36): **melee-only**,
 * symmetric, binary. Gang an isolated target with two blades — ≥2 of the
 * attacker's side adjacent to the target **and no** unit on the target's side
 * adjacent (formation shelters). The Scout's Flanker passive flanks **solo** and
 * for a **bigger** bonus. Returns 0 when no flank applies.
 */
export function computeFlankBonus(
  attacker: Unit,
  defender: Unit,
  units: readonly Unit[],
): number {
  // A ranged attacker never flanks (it already has a DPS/safety edge).
  if (attacker.attackRange > 1) return 0;
  if (!isAdjacent(attacker.pos, defender.pos)) return 0;
  // Clause 2: a target with any ally adjacent is in formation — can't be flanked.
  if (adjacentBodies(defender, units, defender.side) > 0) return 0;
  // Clause 1: ≥2 of the attacker's side adjacent to the target (the attacker —
  // already counted by adjacentBodies — plus at least one more). The Scout's
  // solo-flank passive drops the requirement to 1 (the attacker alone).
  const needed = attacker.passives[PASSIVE.flankSolo] ? 1 : 2;
  if (adjacentBodies(defender, units, attacker.side) < needed) return 0;
  return attacker.passives[PASSIVE.flankBonus] || FLANK.bonus;
}

/**
 * True if `unit` is currently **exposed to a melee flank** — the victim's-eye view
 * of {@link computeFlankBonus} (D36): no same-side ally adjacent to shelter it
 * (formation breaks the flank), plus an adjacent *melee* foe that would earn the
 * bonus — either backed by a second adjacent foe (the standard gang-up) or a
 * solo-flanker (the Scout). Positional and instantaneous, so the render recomputes
 * it each frame rather than storing it as a status; ranged foes never flank.
 */
export function isFlanked(unit: Unit, units: readonly Unit[]): boolean {
  if (adjacentBodies(unit, units, unit.side) > 0) return false; // sheltered by formation
  const enemySide: Side = unit.side === "player" ? "enemy" : "player";
  const adjFoes = units.filter((u) => u.alive && !u.captured && u.side === enemySide && isAdjacent(u.pos, unit.pos));
  const meleeFoes = adjFoes.filter((f) => f.attackRange <= 1);
  if (meleeFoes.length === 0) return false; // only a melee attacker can flank
  if (adjFoes.length >= 2) return true; // ganged: the melee foe + a second body
  return meleeFoes.some((f) => Boolean(f.passives[PASSIVE.flankSolo])); // lone solo-flanker
}

/**
 * Damage a basic attack would deal. Base is `max(1, atk − def)`, then the
 * positional + status modifiers stack into the attack power before the floor:
 * **flanking** (melee, when `units` is given, D36), the **Mark Prey** ramp and
 * the **Deadeye** passive (D40), then the defender's **Exposed** (+) / **Guarded**
 * (−) statuses (D41). Pass `units` to enable flanking; omit it for a context-free
 * hit (a trap, a test).
 */
export function computeDamage(
  attacker: Unit,
  defender: Unit,
  attackPower: number = attacker.attack,
  units?: readonly Unit[],
): number {
  let power = attackPower;
  if (units) power += computeFlankBonus(attacker, defender, units);
  power += markBonus(attacker, defender.id);
  const deadeye = attacker.passives[PASSIVE.deadeye] ?? 0;
  if (deadeye && isDebuffed(defender)) power += deadeye;

  let dmg = power - defender.defense + statusAmount(defender, EXPOSED);
  if (hasStatus(defender, GUARDED)) dmg -= statusAmount(defender, GUARDED);
  return Math.max(1, dmg);
}

/**
 * Ramp the attacker's Mark Prey channel after a hit (D37): a hit on the marked
 * prey adds a stack (capped); hitting a different target re-locks the mark and
 * resets the ramp. No-op for an unmarked attacker.
 */
export function rampMark(attacker: Unit, defender: Unit): void {
  const m = markOf(attacker);
  if (!m || !m.data) return;
  if (m.data.targetId === defender.id) {
    const cap = (m.data.cap as number) ?? 0;
    m.data.stacks = Math.min(cap, ((m.data.stacks as number) ?? 0) + 1);
  } else {
    m.data.targetId = defender.id;
    m.data.stacks = 0;
  }
}

/**
 * Apply raw damage to a unit, emitting `onUnitDamaged` and (on a kill)
 * `onUnitDefeated`. `source` is the attacker if any — a trap or rune passes
 * none. Returns the damage applied. This is the single mutation point so
 * unit attacks and field-entity effects defeat units identically.
 */
export function applyDamage(
  target: Unit,
  amount: number,
  bus?: EventBus,
  source?: Unit,
): number {
  const damage = Math.max(0, Math.floor(amount));
  target.hp = Math.max(0, target.hp - damage);
  bus?.emit("unitDamaged", { unit: target, amount: damage, source });
  if (target.hp <= 0 && target.alive) {
    target.alive = false;
    bus?.emit("unitDefeated", { unit: target, source });
  }
  return damage;
}

/**
 * Resolve a basic attack: apply damage, emit `onUnitDamaged`, and on a kill flip
 * `alive` and emit `onUnitDefeated`. Returns the damage dealt. `attackPower`
 * overrides the attacker's base attack (used by skills like Power Strike).
 */
export function resolveAttack(
  attacker: Unit,
  defender: Unit,
  bus?: EventBus,
  attackPower: number = attacker.attack,
  units?: readonly Unit[],
): number {
  const dealt = applyDamage(
    defender,
    computeDamage(attacker, defender, attackPower, units),
    bus,
    attacker,
  );
  rampMark(attacker, defender);
  return dealt;
}

/** The result of a win/lose check. */
export interface BattleOutcome {
  over: boolean;
  /** The surviving side, or undefined for a mutual wipe / not-over. */
  winner?: Side;
}

/**
 * Win/lose detection: a side wins when the other has no **active** units. A
 * captured unit (D7) is bound and doesn't count as an active defender — a side
 * with only captured/fallen units is eliminated (the captured one becomes a
 * rescue follow-up, not an instant loss). If both sides lack active units it's
 * over with no winner; otherwise the battle continues.
 */
export function battleOutcome(units: readonly Unit[]): BattleOutcome {
  const playersActive = units.some((u) => u.alive && !u.captured && u.side === "player");
  const enemiesActive = units.some((u) => u.alive && !u.captured && u.side === "enemy");
  if (playersActive && enemiesActive) return { over: false };
  if (playersActive) return { over: true, winner: "player" };
  if (enemiesActive) return { over: true, winner: "enemy" };
  return { over: true };
}
