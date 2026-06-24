/**
 * Statuses + per-unit counters (D12 seam).
 *
 * A thin, data-driven status layer: apply a status to a unit, tick it on the
 * unit's turn start, and let it expire. Plus a generic per-unit counter — the
 * shape the capture meter will later use. M3 ships only the hook and one sample
 * status (`Immobilized`); the full system is later milestones.
 */

import type { Unit } from "./units";

/**
 * The classifier (D41) cross-cutting systems key off **instead of an id list** —
 * cleanse ("remove a debuff"), the Hunter's Deadeye ("is this target debuffed?"),
 * and the render tracker tint all read `kind`. So adding e.g. Poison later is one
 * record + one read-hook; the cleanse/Deadeye/tracker need **zero** edits.
 */
export type StatusKind = "debuff" | "buff";

/** A status applied to a unit. Data, not a subclass. */
export interface StatusInstance {
  /** Stable kind id, e.g. `"immobilized"`. */
  id: string;
  /** Display name. */
  name: string;
  /**
   * Turns remaining before expiry, decremented on the unit's turn start. Use
   * `Infinity` for a status that never expires on its own.
   */
  duration: number;
  /** Buff/debuff classifier (D41); undefined for legacy/cosmetic statuses. */
  kind?: StatusKind;
  /** Optional arbitrary payload for richer statuses later. */
  data?: Record<string, unknown>;
}

/** Tuning for the status set (D41) — every magnitude is a named number. */
export const STATUS_TUNING = {
  /** Exposed: extra damage the target takes per hit. */
  exposedDamage: 4,
  /** Guarded: damage reduction while braced (the Defend action). */
  guardedReduction: 4,
  /** The tarpit's extreme Slow: effective speed capped to this floor. */
  tarpitSpeed: 1,
  /** Hastened: bonus effective speed (the Medic stimulant rider). */
  hastenBonus: 6,
  /** Swift: default bonus move tiles (the Scout/Hunter reposition). */
  swiftMove: 2,
} as const;

/** Apply (or refresh) a status on a unit. A same-id status is replaced. */
export function applyStatus(unit: Unit, status: StatusInstance): void {
  removeStatus(unit, status.id);
  unit.statuses.push(status);
}

/** True if the unit currently carries a status of the given id. */
export function hasStatus(unit: Unit, id: string): boolean {
  return unit.statuses.some((s) => s.id === id);
}

/** Remove a status by id; returns true if one was present. */
export function removeStatus(unit: Unit, id: string): boolean {
  const before = unit.statuses.length;
  unit.statuses = unit.statuses.filter((s) => s.id !== id);
  return unit.statuses.length !== before;
}

/**
 * Tick every status on a unit (call on its turn start): decrement `duration`
 * and drop any that hit zero. Returns the statuses that expired this tick.
 */
export function tickStatuses(unit: Unit): StatusInstance[] {
  const expired: StatusInstance[] = [];
  for (const s of unit.statuses) {
    if (s.duration !== Infinity) {
      s.duration -= 1;
      if (s.duration <= 0) expired.push(s);
    }
  }
  if (expired.length > 0) {
    unit.statuses = unit.statuses.filter((s) => !expired.includes(s));
  }
  return expired;
}

// --- The Immobilized sample status (the snare's effect, D12) ----------------

/** Id of the sample Immobilized status. */
export const IMMOBILIZED = "immobilized";

/** Build an Immobilized status lasting `duration` of the unit's turns. */
export function immobilized(duration: number): StatusInstance {
  return { id: IMMOBILIZED, name: "Immobilized", duration, kind: "debuff" };
}

/** True if the unit cannot move this turn. */
export function isImmobilized(unit: Unit): boolean {
  return hasStatus(unit, IMMOBILIZED);
}

// --- The M12 status set with teeth (D41) ------------------------------------
//
// Each status below has **exactly one** consuming system that reads it (the
// "teeth"): CT → clock.effectiveSpeed (Slowed/Hastened); damage →
// combat.computeDamage (Exposed/Guarded). Cross-cutting consumers read `kind`,
// never an id list. See docs/guides/adding-statuses.md.

/** Slowed: effective speed is capped to `speed` (the tarpit drives it to 1). */
export const SLOWED = "slowed";
/** Exposed: the target takes extra incoming damage. */
export const EXPOSED = "exposed";
/** Hastened: bonus effective speed for ~a turn. */
export const HASTENED = "hastened";
/** Guarded: reduced incoming damage until the unit's next turn (Defend). */
export const GUARDED = "guarded";
/** Swift: a transient extra-move buff for one turn (Scout Dash / Hunter Reposition). */
export const SWIFT = "swift";
/** Stealth: the bearer is unseen by the enemy unless a foe stands adjacent (Assassin Hidden Passage). */
export const STEALTH = "stealth";

/**
 * Slowed — a CT-gain debuff read by {@link "./clock".effectiveSpeed}. `speed`
 * is the **cap** the unit's effective speed is held to; the Heavy Knight's
 * tarpit is the extreme (`tarpitSpeed`, → 1).
 */
export function slowed(
  duration: number,
  speed: number = STATUS_TUNING.tarpitSpeed,
): StatusInstance {
  return { id: SLOWED, name: "Slowed", duration, kind: "debuff", data: { amount: speed } };
}

/** Exposed — a +damage debuff read by {@link "./combat".computeDamage}. */
export function exposed(
  duration: number,
  amount: number = STATUS_TUNING.exposedDamage,
): StatusInstance {
  return { id: EXPOSED, name: "Exposed", duration, kind: "debuff", data: { amount } };
}

/** Hastened — a +speed buff read by {@link "./clock".effectiveSpeed}. */
export function hastened(
  duration: number,
  amount: number = STATUS_TUNING.hastenBonus,
): StatusInstance {
  return { id: HASTENED, name: "Hastened", duration, kind: "buff", data: { amount } };
}

/** Guarded — a damage-reduction buff read by {@link "./combat".computeDamage}. */
export function guarded(
  duration = 1,
  amount: number = STATUS_TUNING.guardedReduction,
): StatusInstance {
  return { id: GUARDED, name: "Guarded", duration, kind: "buff", data: { amount } };
}

/** Swift — a transient +move buff read by {@link "./combat".effectiveMove}. */
export function swift(duration = 1, amount: number = STATUS_TUNING.swiftMove): StatusInstance {
  return { id: SWIFT, name: "Swift", duration, kind: "buff", data: { amount } };
}

/**
 * Stealth — a "hidden" buff read by {@link "./vision".canSeeUnit} (D68): the enemy can't
 * see (or target) the bearer unless a foe stands directly adjacent. The Assassin's Hidden
 * Passage; lasts until the bearer's next turn.
 */
export function stealth(duration = 1): StatusInstance {
  return { id: STEALTH, name: "Stealth", duration, kind: "buff" };
}

/** True if the unit is hidden by Stealth (read by {@link "./vision".canSeeUnit}). */
export function isStealthed(unit: Unit): boolean {
  return hasStatus(unit, STEALTH);
}

/** Read a status's numeric `data.amount` (0 if absent) — the teeth's magnitude. */
export function statusAmount(unit: Unit, id: string): number {
  const s = unit.statuses.find((s) => s.id === id);
  const amt = s?.data?.amount;
  return typeof amt === "number" ? amt : 0;
}

// --- Cross-cutting consumers (read the `kind` classifier, not ids) -----------

/** Every debuff currently on the unit. */
export function debuffs(unit: Unit): StatusInstance[] {
  return unit.statuses.filter((s) => s.kind === "debuff");
}

/** True if the unit carries any debuff (the Hunter's Deadeye trigger, D40). */
export function isDebuffed(unit: Unit): boolean {
  return unit.statuses.some((s) => s.kind === "debuff");
}

/**
 * Remove one debuff (the Medic's antidote cleanse, D40/D41). Drops the
 * first-applied debuff; returns the removed status, or undefined if none.
 */
export function cleanseOne(unit: Unit): StatusInstance | undefined {
  const d = unit.statuses.find((s) => s.kind === "debuff");
  if (d) removeStatus(unit, d.id);
  return d;
}

// --- The maintained-stance channel (D37) — the Hunter's Mark Prey -----------
//
// A channel is a sustained self-buff on the **caster** that ramps while a
// condition holds (here: consecutive hits on the same prey). The caster keeps
// moving & acting; the stance ends on disrupt (caster death drops it with the
// unit) or prey death/target-switch. This is the slice's channel proof; the
// damage hook lives in combat.rampMark / computeDamage.

/** Id of the maintained-stance channel (Mark Prey). */
export const MARKED = "marked";

/** Channel tuning — the ramp magnitudes (data, a numbers pass later). */
export const CHANNEL_TUNING = {
  /** Bonus damage added per ramp stack. */
  markPerStack: 2,
  /** Maximum stacks the ramp can reach. */
  markCap: 4,
} as const;

/**
 * Open a maintained-stance channel on `caster`, locked to `targetId`. Stacks
 * start at 0 and ramp on each consecutive hit (see {@link "./combat".rampMark}).
 */
export function markPrey(
  caster: Unit,
  targetId: string,
  perStack: number = CHANNEL_TUNING.markPerStack,
  cap: number = CHANNEL_TUNING.markCap,
): void {
  applyStatus(caster, {
    id: MARKED,
    name: "Marked Prey",
    duration: Infinity,
    kind: "buff",
    data: { targetId, stacks: 0, perStack, cap },
  });
}

/** The caster's active mark stance, if any. */
export function markOf(unit: Unit): StatusInstance | undefined {
  return unit.statuses.find((s) => s.id === MARKED);
}

/** Bonus damage the caster's mark adds against `targetId` right now (0 if none). */
export function markBonus(caster: Unit, targetId: string): number {
  const m = markOf(caster);
  if (!m || m.data?.targetId !== targetId) return 0;
  const stacks = (m.data?.stacks as number) ?? 0;
  const perStack = (m.data?.perStack as number) ?? 0;
  return stacks * perStack;
}

// --- Generic per-unit counters (the capture-meter shape, D12) ---------------

/** Read a per-unit counter (0 if unset). */
export function getCounter(unit: Unit, key: string): number {
  return unit.counters[key] ?? 0;
}

/** Add `by` (default 1) to a per-unit counter; returns the new value. */
export function incrementCounter(unit: Unit, key: string, by = 1): number {
  return (unit.counters[key] = getCounter(unit, key) + by);
}

/** Set a per-unit counter to an exact value. */
export function setCounter(unit: Unit, key: string, value: number): void {
  unit.counters[key] = value;
}

/**
 * The status→visual registry (D41): the **data** the render's at-a-glance tracker
 * reads (a glyph/badge + a tint). A new status gets a tracker by adding one row
 * here, not bespoke draw code. Tints are hex ints for Phaser.
 */
export interface StatusVisual {
  glyph: string;
  tint: number;
  label: string;
}
export const STATUS_VISUALS: Record<string, StatusVisual> = {
  [IMMOBILIZED]: { glyph: "I", tint: 0x9a6bd0, label: "Immobilized" },
  [SLOWED]: { glyph: "S", tint: 0x6f86c0, label: "Slowed" },
  [EXPOSED]: { glyph: "X", tint: 0xe07b7b, label: "Exposed" },
  [HASTENED]: { glyph: "H", tint: 0x7be0a0, label: "Hastened" },
  [GUARDED]: { glyph: "G", tint: 0x8fb6e0, label: "Guarded" },
  [SWIFT]: { glyph: "F", tint: 0xe0d27b, label: "Swift" },
  [STEALTH]: { glyph: "◌", tint: 0x8a7fb0, label: "Stealth" },
  [MARKED]: { glyph: "M", tint: 0xe0a070, label: "Marked Prey" },
};

/** The visual for a status id (a neutral default if unregistered). */
export function statusVisual(id: string): StatusVisual {
  return STATUS_VISUALS[id] ?? { glyph: "*", tint: 0xaaaaaa, label: id };
}
