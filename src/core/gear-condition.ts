/**
 * Gear-condition combat link (D52/D76) — the gear modifier combat reads, stamped
 * per combatant at staging.
 *
 * Two axes fold into one stamp here (D76/D78):
 *   - **Blanket condition + party-gear** ({@link gearDelta}): the worn-gear −defense
 *     penalty (driven by `camp.gearWear` alone — it bites an un-geared party too) **plus**
 *     the **possession-driven** party-wide bonus of any carried **party-gear** materials
 *     (D78). Party-gear (e.g. the Hollow Mill's `iron-weapons`) confers a party-wide
 *     effect simply by sitting in the shared stash — no per-weapon meter (logistics.md
 *     L86–88), its bonus **decayed** through the same `gearWear` path for `maintained` items.
 *   - **Per-unit equipment** ({@link "./equipment".equipDelta}): the unit's worn
 *     weapon/armor/accessory, degraded by the same `gearWear` for *maintained* gear.
 *
 * {@link applyGearCondition} sums them into one signed {@link StatDelta} (+ any granted
 * passives) and stamps it onto each player combatant, so combat reads it for free
 * through the unit's existing `attack`/`defense`/… — no `camp` import threaded into
 * `combat.ts` (which would cycle). The applied delta is recorded on the unit
 * (`gearStamp`) so it reverts cleanly between battles. With no party-gear carried, no
 * wear, and no equipment the stamp is the identity, so an un-upgraded run is byte-identical.
 *
 * Pure logic: no Phaser, no DOM, no `Math.random`.
 */

import type { Unit, StatDelta } from "./units";
import type { RunState } from "./run";
import { applyStatDelta, equipDelta, revertStatDelta, addDelta, degradedMods } from "./equipment";
import { getMaterial } from "./inventory";

/** Gear-condition tuning — data, a numbers pass later (D52). */
export const GEAR_CONDITION = {
  /** Each point of `camp.gearWear` is a blanket −defense (the specced worn-gear penalty). */
  defPenaltyPerWear: 1,
  /** The worn-gear −defense never exceeds this (a floor on how bad gear gets). */
  maxDefPenalty: 3,
} as const;

/**
 * The party-wide gear deltas in effect for a run (D52/D78): the **possession-driven**
 * party-gear bonuses (sum of carried party-gear `mods`, each degraded by wear) + their
 * passives, and the blanket worn-gear −defense penalty.
 */
export interface GearDelta {
  /** Party-wide stat bonuses from carried party-gear (degraded). Possession-driven (D78). */
  stats: StatDelta;
  /** Party-wide keyworded passives from carried party-gear. Possession-driven (D78). */
  passives: Record<string, number>;
  /** Blanket −defense (worn gear), expressed as a positive penalty — driven by `gearWear` alone. */
  defensePenalty: number;
}

/**
 * The party-wide gear deltas for a run (D52/D78). Two halves with **different drivers**:
 *   - **Possession-driven** (D78): for each **carried** party-gear material, its `mods`
 *     and `passive`, with `maintained` mods degraded by `camp.gearWear` (the shared
 *     {@link "./equipment".degradedMods} rule). Possession is **boolean** — carrying ≥1
 *     confers the effect once; copies don't stack (a tuning choice). Stop reading the old
 *     `iron-weapons` run flag.
 *   - **Blanket** (D52): the worn-gear −defense penalty, scaling with wear (capped) and
 *     **independent of possession** — it still bites an un-geared party.
 * With nothing carried and no wear this is `{ stats: {}, passives: {}, defensePenalty: 0 }`
 * — an identity, so an un-upgraded run is byte-identical.
 */
export function gearDelta(run: RunState): GearDelta {
  const wear = Math.max(0, run.camp.gearWear);
  const stats: StatDelta = {};
  const passives: Record<string, number> = {};
  for (const [id, count] of Object.entries(run.inventory.counts)) {
    if (count <= 0) continue;
    const pg = getMaterial(id)?.partyGear;
    if (!pg) continue;
    // Possession boolean: carrying ≥1 confers the effect once (copies don't stack).
    addDelta(stats, degradedMods(pg, wear));
    if (pg.passive) passives[pg.passive.key] = (passives[pg.passive.key] ?? 0) + pg.passive.value;
  }
  return {
    stats,
    passives,
    defensePenalty: Math.min(GEAR_CONDITION.maxDefPenalty, wear * GEAR_CONDITION.defPenaltyPerWear),
  };
}

/**
 * Stamp the aggregate gear delta onto a set of player combatants for a battle
 * (D52/D76/D78): the party-wide {@link gearDelta} (carried party-gear bonuses + the
 * worn-gear −defense) **plus** each unit's per-unit {@link "./equipment".equipDelta}
 * (degraded by the same wear), folded into one signed {@link StatDelta} and any granted
 * passives. Records the **actually applied** delta on each unit (`gearStamp`) so it
 * reverts exactly. Re-applying first reverts any prior stamp (idempotent across
 * re-stages). Mutates the units; returns the party-wide delta (per-unit part varies).
 */
export function applyGearCondition(run: RunState, players: readonly Unit[]): GearDelta {
  const delta = gearDelta(run);
  const wear = Math.max(0, run.camp.gearWear);
  for (const u of players) {
    revertGearStamp(u);
    const eq = equipDelta(u, wear);
    // Party-gear bonuses merged onto the unit's equipment delta; blanket −defense rides it.
    const stats: StatDelta = { ...eq.stats };
    addDelta(stats, delta.stats);
    if (delta.defensePenalty !== 0) stats.defense = (stats.defense ?? 0) - delta.defensePenalty;
    const appliedStats = applyStatDelta(u, stats);
    const appliedPassives: Record<string, number> = {};
    for (const [k, v] of Object.entries(eq.passives)) {
      if (!v) continue;
      u.passives[k] = (u.passives[k] ?? 0) + v;
      appliedPassives[k] = (appliedPassives[k] ?? 0) + v;
    }
    for (const [k, v] of Object.entries(delta.passives)) {
      if (!v) continue;
      u.passives[k] = (u.passives[k] ?? 0) + v;
      appliedPassives[k] = (appliedPassives[k] ?? 0) + v;
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
