import { describe, it, expect } from "vitest";
import { createUnit, remember, type Unit } from "./units";
import { stampPassives, getJob } from "./jobs";
import { THIEF_JOB, SCOUT_PRESTIGE_FLOOR } from "./jobs-data/scout-line";
import { canDisarm } from "./traps";
import { PASSIVE } from "./combat";
import { prestige, prestigeOptions, eligiblePrestiges } from "./grants";
import { createRun, type RunState } from "./run";
import { deftHandsSkim, hasThief, DEFT_HANDS, accrueDeclaredFaucets } from "./economy-actions";

function mk(id: string, jobId?: "scout" | "assassin" | "thief", over: Partial<Parameters<typeof createUnit>[0]> = {}): Unit {
  const u = createUnit({
    id, side: "player", pos: { col: 0, row: 0 },
    speed: 12, maxHp: 24, attack: 9, defense: 2, moveRange: 5, sightRadius: 6, attackRange: 1,
    jobId, ...over,
  });
  stampPassives(u);
  return u;
}

describe("Thief — kit shape (D68)", () => {
  it("is the non-combat-leaning branch: Hidden Passage spine, lockpick, no combat passive", () => {
    expect(THIEF_JOB.lockpick).toBe(true);
    expect(Object.keys(THIEF_JOB.passives ?? {})).toEqual([]); // the anchor is economic, not a combat passive
    expect(THIEF_JOB.skills.map((s) => s.id)).toEqual(["hidden-passage"]);
  });

  it("shares the Hidden Passage spine with the Assassin", () => {
    expect(getJob("assassin")!.skills.some((s) => s.id === "hidden-passage")).toBe(true);
    expect(getJob("thief")!.skills.some((s) => s.id === "hidden-passage")).toBe(true);
  });
});

describe("Thief — Expert Lockpick disarms (D68)", () => {
  it("a Thief disarms (lockpick job); an Assassin can't; a Scout can (Set Trap)", () => {
    expect(canDisarm(mk("t", "thief"))).toBe(true);
    expect(canDisarm(mk("a", "assassin"))).toBe(false);
    expect(canDisarm(mk("s", "scout"))).toBe(true);
  });
});

describe("Scout → Thief prestige (D68)", () => {
  it("SCOUT_JOB offers the Thief branch", () => {
    expect(prestigeOptions(mk("vale", "scout")).map((o) => o.into)).toContain("thief");
  });

  it("replaces the Scout in place and CLEARS Quiet Footsteps (the Thief's anchor is economic)", () => {
    const u = mk("vale", "scout", { jobLevels: { scout: { level: 6, xp: 0 } } });
    expect(u.passives[PASSIVE.quietFootsteps]).toBe(1); // had it as a Scout
    const res = prestige(u, "scout", "thief");
    expect(res.ok).toBe(true);
    expect(u.primaryJob).toBe("thief");
    expect(u.jobLevels.thief).toEqual({ level: 6, xp: 0 }); // the grind carries
    expect(u.passives[PASSIVE.quietFootsteps]).toBeUndefined(); // cleared on prestige
    expect(canDisarm(u)).toBe(true); // gained the lockpick capability
  });

  it("eligible only at the floor AND with the thieves'-guild invite", () => {
    const ctx = { run: {} as RunState };
    const ready = mk("c", "scout", { jobLevels: { scout: { level: SCOUT_PRESTIGE_FLOOR, xp: 0 } } });
    expect(eligiblePrestiges(ready, ctx).map((o) => o.into)).not.toContain("thief"); // no invite yet
    remember(ready, "thieves-guild-invite");
    expect(eligiblePrestiges(ready, ctx).map((o) => o.into)).toContain("thief");
  });
});

describe("Thief — Deft Hands node skim (D68)", () => {
  const thiefUnit = () => createUnit({ id: "vale", side: "player", pos: { col: -1, row: -1 }, jobId: "thief", speed: 14, maxHp: 22, attack: 7, defense: 2, moveRange: 5, sightRadius: 6 });
  const fighter = () => createUnit({ id: "rook", side: "player", pos: { col: -1, row: -1 }, jobId: "soldier", speed: 11, maxHp: 28, attack: 9, defense: 3, moveRange: 4, sightRadius: 5 });

  it("hasThief reflects a Thief in the party", () => {
    expect(hasThief([thiefUnit()])).toBe(true);
    expect(hasThief([fighter()])).toBe(false);
  });

  it("the Thief declares Deft Hands as a goldSkim faucet mirroring DEFT_HANDS (#114 — no drift)", () => {
    const skim = THIEF_JOB.faucet?.goldSkim;
    expect(skim).toBeDefined();
    expect(skim!.chance).toBe(DEFT_HANDS.chance);
    expect(skim!.amount).toBe(DEFT_HANDS.gold);
    expect(skim!.nodeKinds).toEqual(["combat", "event"]);
  });

  it("accrueDeclaredFaucets resolves the goldSkim in the one walk — the same take as deftHandsSkim (#114)", () => {
    // The one faucet walk fires the skim (breakCamp no longer calls deftHandsSkim directly). Two
    // fresh runs: one skimmed via the walk, one via the direct resolver — identical seeded outcome.
    const viaWalk = createRun("deft-walk", { party: [fighter(), thiefUnit()], difficultyId: "normal", gold: 0, storageCap: 8 });
    const viaDirect = createRun("deft-walk", { party: [fighter(), thiefUnit()], difficultyId: "normal", gold: 0, storageCap: 8 });
    const busy = Object.values(viaWalk.map.nodes).find((n) => n.kind === "combat" || n.kind === "event")!;
    viaWalk.mapNodeId = busy.id;
    viaDirect.mapNodeId = busy.id;
    const before = viaWalk.camp.gold;
    accrueDeclaredFaucets(viaWalk);
    const skimmed = deftHandsSkim(viaDirect);
    expect(viaWalk.camp.gold - before).toBe(skimmed); // the walk skimmed exactly what the resolver reports
    expect([0, DEFT_HANDS.gold]).toContain(skimmed);
  });

  it("no Thief ⇒ no skim", () => {
    const run = createRun("deft-none", { party: [fighter()], difficultyId: "normal", gold: 0, storageCap: 8 });
    expect(deftHandsSkim(run)).toBe(0);
  });

  it("a Thief skims a busy node sometimes (each take the full amount); never a rest node", () => {
    const run = createRun("deft-go", { party: [fighter(), thiefUnit()], difficultyId: "normal", gold: 0, storageCap: 8 });
    const nodes = Object.values(run.map.nodes);
    const busy = nodes.find((n) => n.kind === "combat" || n.kind === "event")!;
    const rest = nodes.find((n) => n.kind === "rest");
    expect(busy).toBeTruthy();

    // Busy node: vary the night for many seeded rolls; each take is the full DEFT_HANDS.gold.
    run.mapNodeId = busy.id;
    let fired = 0, total = 0;
    for (let night = 0; night < 30; night++) {
      run.night = night;
      run.camp.gold = 0;
      const got = deftHandsSkim(run);
      expect([0, DEFT_HANDS.gold]).toContain(got);
      if (got > 0) { fired++; total += got; }
    }
    expect(fired).toBeGreaterThan(3); // fires often (≈50%)
    expect(total).toBe(fired * DEFT_HANDS.gold);

    // Rest node: the kind gate — never skims.
    if (rest) {
      run.mapNodeId = rest.id;
      let restTotal = 0;
      for (let night = 0; night < 12; night++) { run.night = night; restTotal += deftHandsSkim(run); }
      expect(restTotal).toBe(0);
    }
  });
});
