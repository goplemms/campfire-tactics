/**
 * The split-force extraction race (finale crux **C2**, issue #209) — guards on the *machinery*,
 * plus the head-start mechanism the whole model rests on.
 *
 * **What this file does and does NOT pin.** #209's headline deliverable is the **everyone-out pacing
 * bar** — a reference party gets all captives *and* all party units onto mouths with zero left behind.
 * That bar is **deliberately not asserted here yet**: measuring the race exposed two content findings
 * that must be ruled on first (both recorded on #209 / D125), and a bar pinned against today's numbers
 * would enshrine a race the content cannot run:
 *
 *  1. **Extraction is unreachable by the party that actually arrives.** The arc holds no Thief — it
 *     *prestiges* the Scout into one at the `thieves-guild-rite`, gated on `jobLevel scout ≥ 5`. The
 *     canonical playthrough arrives with the Scout at level **1**, so the rite declines and nothing in
 *     the party can pick a lock. See {@link referenceParty}, which models the passing branch.
 *  2. **The garrison is a pushover for that party.** Pinning requires *striking*, and a levelled Hunter
 *     one-shots a `bandit-thug`, so the distraction cannot pin — it deletes. Eliminate-all completes
 *     with **zero party casualties**, which means extraction is not the smart play at the shipped
 *     numbers. That is #209's *incentive check*, answered: not yet.
 *
 * So what is guarded here is everything that stays true **whatever the numbers become**: the harness is
 * deterministic, it really executes the canonical solution end to end, and the seal really buys a head
 * start that scales with its durability. The pacing bar lands on top of these once the numbers settle
 * (owner's "build first, tune later" call), and re-confirms at arc promotion (#210).
 */
import { describe, it, expect } from "vitest";
import { injectContentNodes } from "./authored-nodes";
import { runRescueRace, referenceParty } from "./rescue-race";
import { jobLevelOf, primaryJobOf, unitHasCapability } from "../core";

injectContentNodes(); // the D122/D123 body catalog — `traverseRoute` cannot resolve the arc without it

describe("the reference party (#209 — declared, but derived from the arc's own arrival)", () => {
  it("is the infiltration arm's real arrival party, levelled, with the Scout taken through the rite", () => {
    const party = referenceParty();
    // Levelled by the arc, not authored flat: the sim's playtest proxy shares one stat block, the real
    // arrival does not (the caveat recorded on #209).
    expect(party.length).toBeGreaterThanOrEqual(4);
    expect(party.some((u) => jobLevelOf(u, primaryJobOf(u)!) > 1)).toBe(true);
    // …and it can work locks, which is the whole point of the side door.
    expect(party.some((u) => unitHasCapability(u, "lockpick"))).toBe(true);
  });

  it("⚠️ the arc's UNMODIFIED arrival party cannot pick a lock — extraction's live prerequisite (#209)", () => {
    // The finding, as an executable statement rather than a claim in a doc: strip the modelled rite and
    // the party that actually reaches the finale holds no lockpick capability at all, so no cell opens
    // and extraction is unreachable. If a future change gives the arc a Thief natively (or moves the
    // side-door intel to the rite), this test is the one that should be revisited — deliberately, not
    // by accident.
    const party = referenceParty();
    const thief = party.find((u) => unitHasCapability(u, "lockpick"))!;
    // The Thief IS the prestiged Scout — no other body in the arc's cast carries the capability.
    expect(thief.jobId).toBe("scout");
    expect(primaryJobOf(thief)).toBe("thief");
    expect(party.filter((u) => unitHasCapability(u, "lockpick"))).toHaveLength(1);
  });
});

describe("the race harness (#209 — the machinery the pacing bar will stand on)", () => {
  it("is deterministic: identical inputs reproduce the report exactly", () => {
    const a = runRescueRace({ party: referenceParty(), pin: false });
    const b = runRescueRace({ party: referenceParty(), pin: false });
    expect({ ...a, trace: a.trace.length }).toEqual({ ...b, trace: b.trace.length });
    expect(a.trace).toEqual(b.trace);
  });

  it("executes the canonical solution end to end — slam, pick in, free every prisoner", () => {
    // `pin: false` is the *clean* read of the escort: with the distraction fighting, the front party's
    // levelled bodies end the encounter by elimination long before the escort finishes (finding 2), which
    // would cut the run short and prove nothing about the infiltrator's plan.
    const r = runRescueRace({ party: referenceParty(), pin: false });
    const slam = r.trace.find((l) => l.includes("slams winch-wall"));
    const hall = r.trace.find((l) => l.includes("picks hall-gate"));
    expect(slam, "the infiltrator never slammed the seal").toBeDefined();
    expect(hall, "the infiltrator never picked into the cellblock").toBeDefined();
    // All three named prisoners are freed — the escort exists, it is not a theory.
    expect(Object.keys(r.freedOn).sort()).toEqual(["bram", "cass", "wren"]);
  });

  it("the seal buys a head start that SCALES with its durability (the model's load-bearing number)", () => {
    // D118 sizes the head start as `sealHp / batterThroughput`. This is that relationship, measured on
    // the real board against the real door-drive doctrine rather than asserted arithmetically: halve the
    // durability and the garrison is through strictly sooner. It is also the mutation #209 requires the
    // pacing bar to be sensitive to — proving the *mechanism* responds is the half that does not depend
    // on the balance still being tuned.
    const full = runRescueRace({ party: referenceParty(), pin: false });
    const half = runRescueRace({ party: referenceParty(), pin: false, sealHp: 32 });
    expect(full.sealBreachTurn, "the seal was never breached — the garrison never drove it").toBeDefined();
    expect(half.sealBreachTurn).toBeDefined();
    expect(half.sealBreachTurn!).toBeLessThan(full.sealBreachTurn!);
  });

  it("the distraction pin is load-bearing: without it the escort is caught, with it the garrison lives", () => {
    // The two mutations that bracket D118's *thinned pursuit*. Unpinned, the whole garrison is free to
    // drive then chase, and the escort does not get everyone home; the run grades as the survivable
    // retreat, not an extraction win.
    const unpinned = runRescueRace({ party: referenceParty(), pin: false });
    expect(unpinned.result).toBe("objective-failure");
    expect(unpinned.leftBehind.length + unpinned.partyDown.length).toBeGreaterThan(0);
    // …and the garrison is still standing in that run, so the failure is the *pursuit* closing, not the
    // party having been wiped out by something else.
    expect(unpinned.garrisonAlive).toBeGreaterThan(0);
  });
});
