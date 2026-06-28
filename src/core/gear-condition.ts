/**
 * Gear-condition combat link (D52/D76) — the gear modifier combat reads, stamped
 * per combatant at staging.
 *
 * Two axes fold into one stamp here (D76):
 *   - **Blanket condition + party set** ({@link gearDelta}): the Hollow Mill's
 *     "iron weapons" pick is a *party-wide* upgrade, not a per-weapon item
 *     (logistics.md L86–88 rejects a per-weapon meter) — a single party axis (+attack)
 *     that **decays** through the worn-gear path (`camp.gearWear`), with the specced
 *     worn-gear −defense riding the same axis from the negative side.
 *   - **Per-unit equipment** ({@link "./equipment".equipDelta}): the unit's worn
 *     weapon/armor/accessory, degraded by the same `gearWear` for *maintained* gear.
 *
 * {@link applyGearCondition} sums them into one signed {@link StatDelta} (+ any granted
 * passives) and stamps it onto each player combatant, so combat reads it for free
 * through the unit's existing `attack`/`defense`/… — no `camp` import threaded into
 * `combat.ts` (which would cycle). The applied delta is recorded on the unit
 * (`gearStamp`) so it reverts cleanly between battles. With no iron pick, no wear, and
 * no equipment the stamp is the identity, so an un-upgraded run is byte-identical.
 *
 * Pure logic: no Phaser, no DOM, no `Math.random`.
 */

import type { Unit, StatDelta } from "./units";
import type { RunState } from "./run";
import { applyStatDelta, equipDelta, revertStatDelta } from "./equipment";

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
 * Stamp the aggregate gear delta onto a set of player combatants for a battle
 * (D52/D76): the blanket {@link gearDelta} (iron edge + worn-gear −defense) **plus**
 * each unit's per-unit {@link "./equipment".equipDelta} (degraded by the same wear),
 * folded into one signed {@link StatDelta} and any granted passives. Records the
 * **actually applied** delta on each unit (`gearStamp`) so it reverts exactly.
 * Re-applying first reverts any prior stamp (idempotent across re-stages). Mutates the
 * units; returns the blanket delta (the per-unit part varies by unit).
 */
export function applyGearCondition(run: RunState, players: readonly Unit[]): GearDelta {
  const delta = gearDelta(run);
  const wear = Math.max(0, run.camp.gearWear);
  for (const u of players) {
    revertGearStamp(u);
    const eq = equipDelta(u, wear);
    // Blanket axis as a signed stat delta, merged onto the unit's equipment delta.
    const stats: StatDelta = { ...eq.stats };
    if (delta.attack !== 0) stats.attack = (stats.attack ?? 0) + delta.attack;
    if (delta.defensePenalty !== 0) stats.defense = (stats.defense ?? 0) - delta.defensePenalty;
    const appliedStats = applyStatDelta(u, stats);
    const appliedPassives: Record<string, number> = {};
    for (const [k, v] of Object.entries(eq.passives)) {
      if (!v) continue;
      u.passives[k] = (u.passives[k] ?? 0) + v;
      appliedPassives[k] = v;
    }
    u.gearStamp = {
      stats: appliedStats,
      passives: Object.keys(appliedPassives).length ? appliedPassives : undefined,
    };
  }
  return delta;
}

/** Revert a previously-applied gear stamp on a unit (no-op if none). */
export function revertGearStamp(u: Unit): void {
  const s = u.gearStamp;
  if (!s) return;
  revertStatDelta(u, s.stats);
  if (s.passives) {
    for (const [k, v] of Object.entries(s.passives)) {
      const next = (u.passives[k] ?? 0) - v;
      if (next === 0) delete u.passives[k];
      else u.passives[k] = next;
    }
  }
  u.gearStamp = undefined;
}
