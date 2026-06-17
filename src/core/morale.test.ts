import { describe, it, expect } from "vitest";
import { moraleModifiers } from "./morale";
import { moraleTier } from "./camp";

/**
 * These guard the *magnitude* of the morale bundle, not just its wiring. Morale
 * was decorative when the bonuses sat at ±3–8% (below player perception); this
 * pins them to a felt floor so they can't silently drift back to noise. Bump the
 * thresholds deliberately if a future balance pass revisits D8.
 */
describe("morale modifiers — perceptible, and asymmetric (D8)", () => {
  it("High and Inspired add a felt combat + economy reward", () => {
    const high = moraleModifiers("High");
    const inspired = moraleModifiers("Inspired");

    // Crit and gold-find are clearly above the old ~5% noise floor.
    expect(high.critBonus).toBeGreaterThanOrEqual(0.1);
    expect(high.goldFindBonus).toBeGreaterThanOrEqual(0.1);
    expect(inspired.critBonus).toBeGreaterThan(high.critBonus);
    expect(inspired.goldFindBonus).toBeGreaterThan(high.goldFindBonus);

    // Confident troops expose themselves meaningfully less and hold deeper.
    expect(high.exposureMultiplier).toBeLessThanOrEqual(0.8);
    expect(inspired.safeDepthBonus).toBeGreaterThanOrEqual(high.safeDepthBonus);
  });

  it("Neutral is the zero reference and Low stays a gentle penalty (asymmetry)", () => {
    const neutral = moraleModifiers("Neutral");
    expect(neutral).toEqual({
      safeDepthBonus: 0,
      initiativeBonus: 0,
      exposureMultiplier: 1,
      critBonus: 0,
      goldFindBonus: 0,
    });

    const low = moraleModifiers("Low");
    // Low has teeth but stays shallow vs. the High-side reward (the D8 asymmetry):
    // it never adds a bonus, only a small penalty.
    expect(low.initiativeBonus).toBeLessThan(0);
    expect(low.critBonus).toBeLessThan(0);
    expect(Math.abs(low.critBonus)).toBeLessThan(moraleModifiers("High").critBonus);
    expect(low.goldFindBonus).toBe(0);
  });

  it("reads the right tier off a morale value", () => {
    expect(moraleModifiers(moraleTier(-1)).initiativeBonus).toBeLessThan(0); // Low
    expect(moraleModifiers(moraleTier(0))).toEqual(moraleModifiers("Neutral"));
    expect(moraleModifiers(moraleTier(2)).goldFindBonus).toBeGreaterThan(0); // High
    expect(moraleModifiers(moraleTier(5)).safeDepthBonus).toBeGreaterThanOrEqual(2); // Inspired
  });
});
