/**
 * Gear-condition combat link (D52 vertical-slice) — the **blanket** party
 * gear-condition modifier combat reads.
 *
 * The Hollow Mill's node-2 "iron weapons" pick is a *party-wide* gear upgrade, not a
 * per-weapon item (logistics.md L86–88 explicitly rejects a per-weapon meter): it
 * raises a single party-wide gear-condition axis (+attack), and that edge **decays
 * back** through the existing worn-gear path (`camp.gearWear`) without a Blacksmith /
 * Repairs — "the no smith to maintain it decay *is* the designed mechanic." The
 * specced worn-gear penalty (−defense) rides the same axis from the negative side.
 *
 * This is a **blanket stamp**, applied to player combatants at staging time (a small
 * per-unit attack/defense delta), so combat reads it for free through the unit's
 * existing `attack`/`defense` — no `camp` import threaded into `combat.ts` (which
 * would cycle). The deltas are recorded on the unit so they can be reverted cleanly.
 *
 * Pure logic: no Phaser, no DOM, no `Math.random`.
 */

import type { Unit } from "./units";
import type { RunState } from "./run";

/** Gear-condition tuning — data, a numbers pass later (D52). */
export const GEAR_CONDITION = {
  /** Blanket +attack the iron-weapons pick grants (before decay). */
  ironAttack: 3,
  /** Each point of `camp.gearWear` shaves this much off the iron edge (the decay). */
  ironDecayPerWear: 1,
  /** Each point of `camp.gearWear` is also a blanket −defense (the specced worn-gear penalty). */
  defPenaltyPerWear: 1,
  /** The worn-gear −defense never exceeds this (a floor on how bad gear gets). */
  maxDefPenalty: 3,
} as const;

/** The run flag the node-2 iron-weapons pick sets (read here). */
export const IRON_WEAPONS_FLAG = "iron-weapons";

/** The blanket gear-condition deltas in effect for a run, given its iron-weapons pick + wear. */
export interface GearDelta {
  /** Blanket +attack (iron edge, after decay) — never negative. */
  attack: number;
  /** Blanket −defense (worn gear), expressed as a positive penalty. */
  defensePenalty: number;
}

/**
 * The party-wide gear-condition deltas for a run (D52): the iron-weapons +attack edge
 * **decayed by `camp.gearWear`**, and the worn-gear −defense penalty scaling with wear
 * (capped). With no iron pick and no wear this is `{ attack: 0, defensePenalty: 0 }` —
 * an identity, so an un-upgraded run is byte-identical.
 */
export function gearDelta(run: RunState): GearDelta {
  const wear = Math.max(0, run.camp.gearWear);
  const hasIron = !!run.flags[IRON_WEAPONS_FLAG];
  const ironRaw = hasIron ? GEAR_CONDITION.ironAttack - wear * GEAR_CONDITION.ironDecayPerWear : 0;
  return {
    attack: Math.max(0, ironRaw),
    defensePenalty: Math.min(GEAR_CONDITION.maxDefPenalty, wear * GEAR_CONDITION.defPenaltyPerWear),
  };
}

/**
 * Stamp the blanket gear-condition delta onto a set of player combatants for a battle
 * (D52). Records the applied delta on each unit (`gearStamp`) so it can be reverted.
 * Re-applying first reverts any prior stamp (idempotent across re-stages). Mutates the
 * units; returns the delta applied.
 */
export function applyGearCondition(run: RunState, players: readonly Unit[]): GearDelta {
  const delta = gearDelta(run);
  for (const u of players) {
    revertGearStamp(u);
    if (delta.attack !== 0) u.attack += delta.attack;
    if (delta.defensePenalty !== 0) u.defense = Math.max(0, u.defense - delta.defensePenalty);
    u.gearStamp = { attack: delta.attack, defensePenalty: delta.defensePenalty };
  }
  return delta;
}

/** Revert a previously-applied gear stamp on a unit (no-op if none). */
export function revertGearStamp(u: Unit): void {
  const s = u.gearStamp;
  if (!s) return;
  if (s.attack !== 0) u.attack -= s.attack;
  if (s.defensePenalty !== 0) u.defense += s.defensePenalty;
  u.gearStamp = undefined;
}
