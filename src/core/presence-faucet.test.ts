import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import { createRun, type RunState } from "./run";
import { effectiveMarketTier, marketTierBonus, type MapNode } from "./overworld";
import { declaredFaucetInfluence, accrueDeclaredFaucets } from "./economy-actions";
import { getJob, jobPresenceSummary, JOBS, type JobDef, type JobLookup } from "./jobs";

// D72 — the presence / faucet declaration substrate (decision 4). A class's standing
// "by being fielded" (Appraisal's market lift, Renown's Influence trickle) is **data** on
// the JobDef that the readers fold in — not a hardcoded fn. Proven here with **throwaway
// fixture jobs injected via JobLookup**, never registered in JOBS (so production — where no
// class declares either yet — stays byte-identical).

function soldier(id = "u"): Unit {
  return createUnit({ id, side: "player", pos: { col: -1, row: -1 }, jobId: "soldier", speed: 10, maxHp: 20, attack: 6, defense: 2, moveRange: 4, sightRadius: 4 });
}

/** A node with a real `basic` market — what Appraisal lifts. */
function basicNode(): MapNode {
  return { id: "nMkt", layer: 1, index: 0, kind: "rest", market: "basic", edges: [] };
}

describe("presence — Appraisal market lift as data (D72)", () => {
  // A fixture job (keyed to "soldier" so the unit resolves it via the injected lookup)
  // declaring a +1 market-tier presence. Never added to JOBS.
  const appraiser: JobDef = { id: "soldier", name: "Fixture Appraiser", description: "", skills: [], presence: { marketTierBonus: 1 } };
  const lookup: JobLookup = (id) => (id === "soldier" ? appraiser : getJob(id));

  it("a fielded member's presence lifts an existing market a tier (basic → premium)", () => {
    const party = [soldier()];
    expect(effectiveMarketTier(basicNode(), party)).toBe("basic"); // real Soldier: no presence
    expect(effectiveMarketTier(basicNode(), party, undefined, lookup)).toBe("premium"); // fixture: +1 tier
  });

  it("presence does NOT conjure a market on a barren node (Appraisal ≠ Find Trade)", () => {
    const barren: MapNode = { ...basicNode(), id: "nBarren", market: "none" };
    expect(effectiveMarketTier(barren, [soldier()], undefined, lookup)).toBe("none");
  });

  it("the lift caps at premium (never overshoots the band)", () => {
    const strong: JobDef = { ...appraiser, presence: { marketTierBonus: 5 } };
    const cap: JobLookup = (id) => (id === "soldier" ? strong : getJob(id));
    expect(effectiveMarketTier(basicNode(), [soldier()], undefined, cap)).toBe("premium");
  });

  it("marketTierBonus sums across the fielded party (and ignores the fallen)", () => {
    const a = soldier("a");
    const b = soldier("b");
    const dead = soldier("d");
    dead.alive = false;
    expect(marketTierBonus([a, b, dead], lookup)).toBe(2); // 1 + 1, the dead member contributes nothing
  });
});

describe("faucet — Renown Influence trickle as data (D72)", () => {
  const patron: JobDef = { id: "soldier", name: "Fixture Patron", description: "", skills: [], faucet: { influencePerStep: 2 } };
  const lookup: JobLookup = (id) => (id === "soldier" ? patron : getJob(id));

  it("declaredFaucetInfluence reads the per-step faucet off the (injected) job", () => {
    expect(declaredFaucetInfluence([soldier(), soldier("b")], lookup)).toBe(4); // 2 each
    expect(declaredFaucetInfluence([soldier()])).toBe(0); // real Soldier declares none
  });

  it("accrueDeclaredFaucets banks the declared Influence into the run's standing", () => {
    const run: RunState = createRun("faucet-fix", { party: [soldier()], difficultyId: "normal", gold: 50 });
    expect(run.overworld.influence).toBe(0);
    const gained = accrueDeclaredFaucets(run, lookup);
    expect(gained).toBe(2);
    expect(run.overworld.influence).toBe(2);
  });
});

describe("card-surfacing hook + production dormancy (D72)", () => {
  it("jobPresenceSummary turns the declarations into legible card lines", () => {
    const both: JobDef = { id: "x", name: "X", description: "", skills: [], presence: { marketTierBonus: 1 }, faucet: { influencePerStep: 1 } };
    expect(jobPresenceSummary(both)).toEqual(["Markets read +1 tier while fielded", "+1 Influence per node-step"]);
    expect(jobPresenceSummary(getJob("soldier")!)).toEqual([]); // a plain combat job: nothing to surface
  });

  it("the kit pass declares the economy classes' presence/faucet (D70/D71)", () => {
    // Noble → Renown (Influence faucet); Merchant → Appraisal (market presence).
    expect(JOBS.noble.faucet?.influencePerStep).toBe(1);
    expect(JOBS.merchant.presence?.marketTierBonus).toBe(1);
    for (const [id, job] of Object.entries(JOBS)) {
      if (id !== "noble") expect(job.faucet).toBeUndefined();
      if (id !== "merchant") expect(job.presence).toBeUndefined();
    }
  });
});
