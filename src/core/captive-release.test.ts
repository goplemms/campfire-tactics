import { describe, it, expect } from "vitest";
import { canRelease } from "./deployment";
import { createUnit, type ReleaseRequirement } from "./units";
import type { JobId } from "./jobs";

/**
 * The captive **rescue gate** (D52/D69) — `canRelease` decides whether a given rescuer may
 * free a bound captive, per the captive's {@link ReleaseRequirement}. This is the pure core
 * of the "pick the cell" infiltration taste: a **cuffed** captive (`lockpick`) can only be
 * freed by a unit holding the Expert Lockpick capability (the Thief), while the shipped L1
 * Cook (`reach`, the default) is unchanged.
 */

const STATS = { speed: 10, maxHp: 20, attack: 8, defense: 2, moveRange: 4, sightRadius: 5 };

function captive(release?: ReleaseRequirement) {
  return createUnit({ id: "captive", side: "player", pos: { col: 0, row: 0 }, ...STATS, release });
}
function rescuer(jobId: JobId) {
  return createUnit({ id: `r-${jobId}`, side: "player", pos: { col: 0, row: 1 }, jobId, primaryJob: jobId, ...STATS });
}

describe("canRelease — the captive rescue gate (D52/D69)", () => {
  it("a reach captive (the default) is freed by any rescuer — the L1 Cook is unchanged", () => {
    const c = captive(); // absent release ⇒ reach
    expect(canRelease(c, rescuer("scout"))).toBe(true);
    expect(canRelease(c, rescuer("thief"))).toBe(true);
    expect(canRelease(c, undefined)).toBe(true); // freed-by-winning-the-field / no named rescuer
  });

  it("an explicit reach requirement behaves the same as the default", () => {
    expect(canRelease(captive({ kind: "reach" }), rescuer("scout"))).toBe(true);
  });

  it("a lockpick (cuffed) captive refuses a rescuer without the capability", () => {
    const c = captive({ kind: "lockpick" });
    expect(canRelease(c, rescuer("scout"))).toBe(false); // the base Scout holds no lockpick
    expect(canRelease(c, undefined)).toBe(false); // and the win/no-rescuer path can't pick it either
  });

  it("a lockpick (cuffed) captive is freed by a Thief (Expert Lockpick)", () => {
    expect(canRelease(captive({ kind: "lockpick" }), rescuer("thief"))).toBe(true);
  });
});
