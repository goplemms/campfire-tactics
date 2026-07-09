import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import { stampPassives } from "./jobs";
import { SCOUT_JOB } from "./jobs-data/scout-line";
import { applyStatus, swift, EXPOSED } from "./status";
import { captureEvasionFactor, QUIET_FOOTSTEPS_CAPTURE_FACTOR, DASH_CAPTURE_FACTOR } from "./deployment";

/** A unit on the Scout's frame; `jobId` "scout" stamps Quiet Footsteps, undefined = a plain body. */
function mk(id: string, jobId?: "scout"): Unit {
  const u = createUnit({
    id,
    side: "player",
    pos: { col: 0, row: 0 },
    speed: 14,
    maxHp: 24,
    attack: 9,
    defense: 2,
    moveRange: 5,
    sightRadius: 6,
    attackRange: 1,
    jobId,
  });
  stampPassives(u);
  return u;
}

describe("Scout — Quiet Footsteps capture-evasion (D68)", () => {
  it("a unit without the passive faces the full net (factor 1)", () => {
    expect(captureEvasionFactor(mk("grunt"))).toBe(1);
  });

  it("Quiet Footsteps halves the Scout's capture chance — it slips the net", () => {
    expect(captureEvasionFactor(mk("vale", "scout"))).toBe(QUIET_FOOTSTEPS_CAPTURE_FACTOR);
  });

  it("Dash (Swift) halves it again — a darting Scout faces a quarter of the grab", () => {
    const u = mk("vale", "scout");
    applyStatus(u, swift(1, 3));
    expect(captureEvasionFactor(u)).toBe(QUIET_FOOTSTEPS_CAPTURE_FACTOR * DASH_CAPTURE_FACTOR);
  });

  it("Swift on a non-Scout does nothing — the net-evasion is the passive's, not Swift's", () => {
    const u = mk("grunt");
    applyStatus(u, swift(1, 3));
    expect(captureEvasionFactor(u)).toBe(1);
  });
});

describe("Scout — base kit shape (D68)", () => {
  it("Set Trap's rider is Exposed (weaken the approach, not root) and still feeds Deadeye", () => {
    const trap = SCOUT_JOB.skills.find((s) => s.id === "set-snare")!;
    expect(trap.effect.kind).toBe("placeTrap");
    if (trap.effect.kind === "placeTrap") expect(trap.effect.status?.id).toBe(EXPOSED);
  });

  it("Set Trap is the L1 starter; Recon (combat) + Survey (overworld) are the L2 growth (D74)", () => {
    const byId = (id: string) => SCOUT_JOB.skills.find((s) => s.id === id)!;
    expect(byId("set-snare").unlockLevel ?? 1).toBe(1); // moved to L1 — full combat kit from the start
    const recon = byId("recon");
    expect(recon.unlockLevel).toBe(2); // the Scout's 2nd-tier unlock
    expect(recon.effect.kind).toBe("status"); // combat-only now — the dart (Swift), was Dash
    // The overworld face is its own ability (split from Recon): Survey, same L2 tier.
    const survey = byId("survey");
    expect(survey.unlockLevel).toBe(2);
    expect(survey.effect.kind).toBe("survey"); // scouts a node's intel on the overworld
  });

  it("carries exactly one identity-anchor passive (the twin flank keys are merged)", () => {
    expect(Object.keys(SCOUT_JOB.passives ?? {})).toEqual(["quietFootsteps"]);
  });
});
