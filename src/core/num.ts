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

/**
 * Add `n` (default 1) to a counter-map entry, treating a missing key as 0 — the
 * increment companion to {@link decayCounters} for the `map[id] = (map[id] ?? 0) + n`
 * idiom (Scout's scouted tiers, per-node camp uses). Mutates `map`; returns the new value.
 */
export function bumpCounter(map: Record<string, number>, id: string, n = 1): number {
  return (map[id] = (map[id] ?? 0) + n);
}

/** Clamp `x` to the inclusive range `[lo, hi]`. */
export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Clamp `x` to the unit interval `[0, 1]` — the fraction sanitizer (a skim, a protection level). */
export function clamp01(x: number): number {
  return clamp(x, 0, 1);
}

/**
 * Pick a value's **band** from a floor table: the first entry whose `min` floor `x`
 * meets. Author the table **high-to-low** (tightest band first) so the first match
 * wins; returns `fallback` when `x` is below every floor. Returns the whole entry,
 * so each domain keeps its own value field (`.tier`, `.label`, …). The one scan
 * behind the tier ladders (Influence standing, reward band, …).
 */
export function bandFor<T extends { min: number }>(x: number, bands: readonly T[], fallback: T): T {
  for (const b of bands) if (x >= b.min) return b;
  return fallback;
}

/**
 * Exhaustiveness guard for discriminated-union dispatch: unreachable if every
 * variant is handled, so an unhandled one is a **compile error** here; if bad data
 * still reaches it at runtime, it throws rather than failing silently.
 */
export function assertNever(x: never, msg = "unexpected variant"): never {
  throw new Error(`${msg}: ${JSON.stringify(x)}`);
}
