/**
 * Recruitment (M10, D33) — the roster as a loop, not a fixed cast.
 *
 * Through M9 the roster grew by exactly one valve: {@link "./guild".hireMercenary}
 * (rebuild-after-wipe). M10 turns recruitment into a real loop with **two sources
 * feeding three tiers** (the BG3 split):
 *
 * - **A refreshing mercenary pool** at the hall ({@link refreshMercPool}/
 *   {@link hireFromPool}) — several **rolled**, gold-hired recruits beyond the
 *   single rebuild valve. Deterministic from the guild seed (D22). Mercenaries are
 *   the **expendable**, rolled tier.
 * - **The mid-combat bribe/rescue → roster vector** — the whole new rule (D33) is a
 *   **temp↔permanent flag**: a bribed (Noble Influence, {@link "./economy-actions"})
 *   or rescued (D21) **authored** character ({@link "./units".Unit.authored}) joins
 *   the roster **permanently** ({@link recruitToRoster}); a bribed **generic** only
 *   **fights for the rest of the battle** (temporary — no roster bloat). The Noble's
 *   bribe and the rescue system thus **double as recruitment vectors**, reusing
 *   existing machinery.
 *
 * **Deferred (D33):** the authored-cast *data shape* — how a companion declares its
 * fixed identity + recruit hooks. This module works on the temp↔permanent flag only;
 * authoring the cast is later.
 *
 * **Determinism (D22):** the pool rolls from the guild seed + a monotonic counter —
 * no live RNG, no `Math.random`. Pure logic: no Phaser, no DOM.
 */

import { recruitClassify, type Unit } from "./units";
import { GUILD, rollMercenary, type Guild } from "./guild";

/** Recruitment tuning — data, a numbers pass later (D33). */
export const RECRUIT = {
  /** Mercenaries shown in the refreshing hall pool at once. */
  poolSize: 3,
} as const;

// --- The refreshing mercenary pool (D33) ------------------------------------

/**
 * Top the hall's mercenary pool back up to {@link RECRUIT.poolSize} (M10, D33).
 * Each fresh merc is rolled **deterministically** from the guild seed +
 * `mercCounter` (the same counter the rebuild valve uses, so every roll is unique
 * and reproducible). Returns the pool.
 */
export function refreshMercPool(guild: Guild): Unit[] {
  while (guild.mercPool.length < RECRUIT.poolSize) {
    guild.mercPool.push(rollMercenary(guild.seed, guild.mercCounter++));
  }
  return guild.mercPool;
}

/** The current hall mercenary pool (rolls a fresh one in if it's empty). */
export function mercPool(guild: Guild): Unit[] {
  if (guild.mercPool.length === 0) refreshMercPool(guild);
  return guild.mercPool;
}

/** Why a pool merc can't be hired right now, or `null` if it can. */
export function hireRefusal(guild: Guild, mercId: string): string | null {
  if (!guild.mercPool.some((m) => m.id === mercId)) return "That recruit is no longer available.";
  if (guild.treasury < GUILD.mercCost) return "Treasury can't cover the hire.";
  return null;
}

/**
 * Hire a specific mercenary from the refreshing pool (M10, D33): debit the
 * **treasury** ({@link GUILD.mercCost}), move the recruit into the roster, and top
 * the pool back up (so the hall always shows a full slate). Returns the hired unit,
 * or `null` if it can't be afforded / isn't on offer.
 */
export function hireFromPool(guild: Guild, mercId: string): Unit | null {
  if (hireRefusal(guild, mercId)) return null;
  const i = guild.mercPool.findIndex((m) => m.id === mercId);
  const merc = guild.mercPool[i];
  guild.mercPool.splice(i, 1);
  guild.treasury -= GUILD.mercCost;
  guild.roster.push(merc);
  refreshMercPool(guild);
  return merc;
}

// --- The temp↔permanent vector (the whole new rule, D33) --------------------

// `RecruitOutcome` / `recruitClassify` (the temp↔permanent flag itself) live in `units.ts` — a read of
// the unit's own `authored` mark, so the verb modules classify a bribe without importing this module
// (which reaches `guild` → `run`; design map, step 2).

/**
 * Land a **permanent** recruit (a bribed/rescued **authored** unit) in the guild
 * roster (D33). A no-op for a generic (temporary) unit — those never join. Returns
 * true if the unit joined.
 */
export function recruitToRoster(guild: Guild, unit: Unit): boolean {
  if (!recruitClassify(unit).permanent) return false;
  if (guild.roster.some((u) => u.id === unit.id)) return false;
  guild.roster.push(unit);
  return true;
}
