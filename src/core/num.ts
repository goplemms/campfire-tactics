/**
 * Small numeric helpers shared across the core. Pure: no Phaser, no DOM.
 */

/**
 * Coerce to a non-negative integer (`max(0, floor(x))`) — the sanitizer every
 * gold/resource mutation runs its input through so a fractional or negative
 * amount can never poison a purse, payout, or cost.
 */
export function nonNegInt(x: number): number {
  return Math.max(0, Math.floor(x));
}

/**
 * Decrement every value in a **counter map** by `amount` (default 1), deleting any
 * entry that reaches 0 or below. The one shape behind both cooldown ledgers — the
 * combat per-skill CT cooldowns ({@link "./clock".tickSkillCooldowns}, decayed by a
 * tick's CT) and the overworld node-step cooldowns ({@link
 * "./overworld-actions".tickCooldowns}, decayed by one step). Mutates `map` in place.
 */
export function decayCounters(map: Record<string, number>, amount = 1): void {
  for (const id of Object.keys(map)) {
    const left = map[id] - amount;
    if (left <= 0) delete map[id];
    else map[id] = left;
  }
}
