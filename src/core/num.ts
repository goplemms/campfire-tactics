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
