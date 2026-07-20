/**
 * Deterministic seeded PRNG (M6) — the bedrock the whole run seeds from.
 *
 * **Determinism is load-bearing** (D-run-loop): every random choice in a run —
 * map/roster generation, reward rolls, AI tie-breaks, recovery-keyword rolls,
 * the Seer's divination — pulls from one PRNG threaded through the run state, so
 * the **same seed reproduces the run exactly**. There is **no `Math.random`
 * anywhere in `core/`** (a grep test enforces it); this module is the only
 * source of randomness.
 *
 * The generator is a mulberry32 — a tiny, fast 32-bit PRNG with good
 * distribution for game use. State is a single 32-bit integer, so a run can be
 * **serialized and restored** to replay from any point. {@link Rng.fork} derives
 * an independent sub-stream (used to give each encounter its own deterministic
 * stream without entangling it with the main draw order).
 *
 * Pure logic: no Phaser, no DOM, no `Math.random`.
 */

/** A serializable PRNG state — just the 32-bit cursor. */
export interface RngState {
  s: number;
}

/**
 * Hash an arbitrary string/number seed into a 32-bit integer (xfnv1a-style).
 * Stable across runs and platforms, so a textual seed always maps to the same
 * starting state.
 */
export function hashSeed(seed: string | number): number {
  const str = typeof seed === "number" ? `n:${seed}` : seed;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Final avalanche so similar seeds diverge quickly.
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A deterministic pseudo-random number generator (mulberry32). */
export class Rng {
  /** The original seed, kept for display / re-entry. */
  readonly seed: string | number;
  private s: number;

  constructor(seed: string | number = 0) {
    this.seed = seed;
    this.s = hashSeed(seed);
  }

  /** Restore an {@link Rng} from a serialized {@link RngState}. */
  static fromState(state: RngState, seed: string | number = 0): Rng {
    const rng = new Rng(seed);
    rng.s = state.s >>> 0;
    return rng;
  }

  /** Serialize the current state (for save / replay). */
  state(): RngState {
    return { s: this.s >>> 0 };
  }

  /** Restore from a serialized state in place. */
  setState(state: RngState): void {
    this.s = state.s >>> 0;
  }

  /** Next float in [0, 1). Advances the stream. */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** A non-negative integer in [0, max). Returns 0 for max <= 0. */
  int(max: number): number {
    if (max <= 0) return 0;
    return Math.floor(this.next() * max);
  }

  /** An integer in [min, max] inclusive. */
  range(min: number, max: number): number {
    if (max < min) [min, max] = [max, min];
    return min + this.int(max - min + 1);
  }

  /** A float in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** True with probability `p` (clamped to [0, 1]). */
  chance(p: number): boolean {
    if (p <= 0) return false;
    if (p >= 1) return true;
    return this.next() < p;
  }

  /** Pick a uniformly-random element of a non-empty array. */
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error("Rng.pick: empty array");
    return arr[this.int(arr.length)];
  }

  /**
   * Pick a weighted element. `weightOf` returns each item's relative weight;
   * items with weight <= 0 are never chosen. Deterministic for a given stream.
   */
  pickWeighted<T>(arr: readonly T[], weightOf: (item: T) => number): T {
    if (arr.length === 0) throw new Error("Rng.pickWeighted: empty array");
    let total = 0;
    for (const item of arr) total += Math.max(0, weightOf(item));
    if (total <= 0) return arr[0];
    let roll = this.next() * total;
    for (const item of arr) {
      roll -= Math.max(0, weightOf(item));
      if (roll < 0) return item;
    }
    return arr[arr.length - 1];
  }

  /** Fisher–Yates shuffle a copy of `arr` (does not mutate the input). */
  shuffle<T>(arr: readonly T[]): T[] {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /**
   * Derive an **independent** sub-stream. Each call advances this stream and
   * seeds a fresh {@link Rng} from the drawn value (+ optional `salt`), so forks
   * are reproducible and don't disturb the parent's later draws. Used to give a
   * subsystem (e.g. one encounter's generation) its own deterministic stream.
   */
  fork(salt = 0): Rng {
    const childSeed = (Math.imul(this.next() * 4294967296, 1) ^ (salt | 0)) >>> 0;
    return new Rng(childSeed);
  }
}

/**
 * Derive a deterministic stream for a labelled sub-purpose **without** touching
 * any live state — purely a function of `(seed, label)`. This is how encounter
 * generation stays reproducible regardless of how many other draws a run makes:
 * `streamFor(runSeed, "enc:3")` always yields the same encounter for run seed
 * X. (A re-seed-by-label fork; see {@link Rng.fork} for the in-stream variant.)
 */
export function streamFor(seed: string | number, label: string): Rng {
  return new Rng(saltSeed(seed, label));
}

/**
 * Compose a labelled **child seed** — the `seed#label` join `streamFor` uses,
 * exposed for the sites that need the *seed string* rather than a live stream
 * (a quest's dispatch seed, a battle's encounter seed). One home for the join
 * so the `#` convention is never hand-encoded at a call site.
 */
export function saltSeed(seed: string | number, label: string): string {
  return `${seed}#${label}`;
}
