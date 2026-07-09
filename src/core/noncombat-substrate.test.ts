import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import { createRun, breakCamp, type RunState } from "./run";
import { useOverworldSkill, DEAL_PRIMED_FLAG } from "./overworld-actions";
import { hasNodeFlag, isPrimed, consumeFlag } from "./overworld-state";
import { availableSkills } from "./leveling";
import { effectiveMarketTier, marketOpenedFlag, type MapNode } from "./overworld";
import { computeUpkeep, payUpkeep } from "./upkeep";
import { getJob, JOBS, type JobDef, type JobLookup } from "./jobs";
import { PASSIVE } from "./combat";
import type { SkillDef } from "./skills";

// =============================================================================
// D72 — the non-combat action substrate, proven END-TO-END with throwaway fixtures.
//
// Mirrors how the Scout/Soldier per-class passes consumed the D65 prestige substrate:
// the kits aren't built here — instead fixture SkillDefs on fixture JobDefs (injected via
// JobLookup, NEVER registered in JOBS) exercise every shape THROUGH the one interpreter
// (useOverworldSkill) and the one projection (availableSkills), exactly as Find Trade /
// Savvy Barter / Cook Stew / Field Triage / Appraisal will. The live registries — which
// drive the deterministic sim — stay untouched, so the headless sim is byte-identical.
// =============================================================================

// --- The fixture verb-kit (the shapes the triad needs) ----------------------

/** Computed-cost meal priced at *the night's upkeep value* (provider) → bank RP + satisfy Food. */
const COOK_FIX: SkillDef = {
  id: "fx-cook-stew", name: "Fixture Cook Stew", description: "", target: "party", range: 0, spend: "act",
  overworldCost: { usesPerNode: 1, gold: (run) => computeUpkeep(run.party).total },
  effect: { kind: "provisionMeal", rp: 4 },
};
/** Per-node-state verb: open an impromptu market here (the Find-Trade shape). */
const FIND_FIX: SkillDef = {
  id: "fx-find-trade", name: "Fixture Find Trade", description: "", target: "self", range: 0, spend: "act",
  overworldCost: { cooldown: 1 }, effect: { kind: "openMarket" },
};
/** One-shot primed verb: the next deal goes my way (the Savvy-Barter shape). */
const BARTER_FIX: SkillDef = {
  id: "fx-savvy-barter", name: "Fixture Savvy Barter", description: "", target: "self", range: 0, spend: "act",
  overworldCost: { cooldown: 1 }, effect: { kind: "primeDeal" },
};
/** Capability-gated verb: only a healer may (the Triage/Capability shape). */
const TRIAGE_FIX: SkillDef = {
  id: "fx-field-triage", name: "Fixture Field Triage", description: "", target: "party", range: 0, spend: "act",
  requires: "healer", overworldCost: { fatigue: 1 }, effect: { kind: "provisionMeal", rp: 1 },
};

/** A fixture broker job (keyed to "merchant") — its overworld kit + a presence declaration. */
const BROKER_FIX: JobDef = {
  id: "merchant", name: "Fixture Broker", description: "",
  skills: [COOK_FIX, FIND_FIX, BARTER_FIX, TRIAGE_FIX],
  presence: { marketTierBonus: 1 }, // Appraisal
};
/** Same kit, but its members ARE healers — so the capability-gated Triage surfaces for them. */
const HEALER_BROKER_FIX: JobDef = { ...BROKER_FIX, id: "medic", passives: { [PASSIVE.triage]: 0.5 } };

const lookup: JobLookup = (id) =>
  id === "merchant" ? BROKER_FIX : id === "medic" ? HEALER_BROKER_FIX : getJob(id);

const mk = (id: string, jobId: string): Unit =>
  createUnit({ id, side: "player", pos: { col: -1, row: -1 }, jobId: jobId as never, speed: 9, maxHp: 18, attack: 4, defense: 2, moveRange: 3, sightRadius: 4 });
const broker = () => mk("Coin", "merchant");
const healerBroker = () => mk("Mreni", "medic");
const fighter = () => mk("Rook", "soldier");
const newRun = (seed: string, party: Unit[]): RunState => createRun(seed, { party, difficultyId: "normal", gold: 200, storageCap: 6 });

describe("D72 substrate end-to-end — the one projection (job + capability gates)", () => {
  it("a job's overworld kit surfaces through availableSkills, capability-gated rows filtered", () => {
    const ids = availableSkills(broker(), "overworld", lookup).map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["fx-cook-stew", "fx-find-trade", "fx-savvy-barter"]));
    // Capability gate: a non-healer broker doesn't see Field Triage...
    expect(ids).not.toContain("fx-field-triage");
    // ...but a healer who holds the same kit does.
    expect(availableSkills(healerBroker(), "overworld", lookup).map((s) => s.id)).toContain("fx-field-triage");
    // Class gate: a fighter holding no such job surfaces none of them (the gate is the projection).
    expect(availableSkills(fighter(), "overworld", lookup).map((s) => s.id)).not.toContain("fx-cook-stew");
  });
});

describe("D72 substrate end-to-end — driving each shape through useOverworldSkill", () => {
  it("computed-cost meal: billed at the night's value, banks RP, satisfies Food (no double-charge)", () => {
    const run = newRun("e2e-cook", [broker(), fighter()]);
    const value = computeUpkeep(run.party).total;
    const rpBefore = run.rp;
    const goldBefore = run.camp.gold;

    const res = useOverworldSkill(run, run.party[0], COOK_FIX);
    expect(res.applied).toBe(true);
    expect(run.camp.gold).toBe(goldBefore - value); // the dynamic price billed once
    expect(run.rp).toBe(rpBefore + 4); // RP banked

    // End the Night bills upkeep — Food is already satisfied, so it isn't charged again.
    const bill = computeUpkeep(run.party);
    const foodCost = bill.lines.find((l) => l.id === "food")!.cost;
    const up = payUpkeep(run.camp, run.party, { skip: [] });
    expect(up.paid).toBe(bill.total - foodCost);
    expect(up.underfunded).not.toContain("food");
    expect(run.camp.satisfiedUpkeep).toEqual([]); // single-night provision, consumed by billing
  });

  it("per-node state: opening a market here lets a barren node trade at poor, reset on departure", () => {
    const run = newRun("e2e-find", [broker()]);
    const res = useOverworldSkill(run, run.party[0], FIND_FIX);
    expect(res.applied).toBe(true);
    expect(hasNodeFlag(run.overworld, marketOpenedFlag(run.mapNodeId))).toBe(true);

    // The flag the verb set is the one effectiveMarketTier folds in (read at its site).
    const here: MapNode = { id: run.mapNodeId, layer: 0, index: 0, kind: "combat", market: "none", edges: [] };
    expect(effectiveMarketTier(here, [], run.overworld)).toBe("poor");
    breakCamp(run); // departing the node clears the per-node mark
    expect(effectiveMarketTier(here, [], run.overworld)).toBe("none");
  });

  it("one-shot primed modifier: a follow-up trade cashes it exactly once", () => {
    const run = newRun("e2e-barter", [broker()]);
    useOverworldSkill(run, run.party[0], BARTER_FIX);
    expect(isPrimed(run.overworld, DEAL_PRIMED_FLAG)).toBe(true);
    expect(consumeFlag(run.overworld, DEAL_PRIMED_FLAG)).toBe(true);
    expect(consumeFlag(run.overworld, DEAL_PRIMED_FLAG)).toBe(false);
  });

  it("capability gate at the interpreter: refuses a non-healer, applies for a healer", () => {
    const run = newRun("e2e-cap", [healerBroker(), fighter()]);
    const refused = useOverworldSkill(run, run.party[1], TRIAGE_FIX); // the fighter
    expect(refused.applied).toBe(false);
    expect(refused.reason).toMatch(/healer/i);
    const applied = useOverworldSkill(run, run.party[0], TRIAGE_FIX); // the healer
    expect(applied.applied).toBe(true);
    expect(run.party[0].fatigue).toBeGreaterThan(0); // the fatigue price was paid
  });

  it("presence declaration read at its site: Appraisal lifts an existing market a tier", () => {
    const basic: MapNode = { id: "nB", layer: 1, index: 0, kind: "rest", market: "basic", edges: [] };
    expect(effectiveMarketTier(basic, [broker()], undefined, lookup)).toBe("premium");
  });
});

describe("D72 substrate — determinism + registry hygiene", () => {
  it("the fixture paths are seed-stable", () => {
    const drive = (s: string) => {
      const r = newRun(s, [broker()]);
      useOverworldSkill(r, r.party[0], FIND_FIX);
      useOverworldSkill(r, r.party[0], BARTER_FIX);
      useOverworldSkill(r, r.party[0], COOK_FIX);
      return r;
    };
    const a = drive("det");
    const b = drive("det");
    expect(b.overworld).toEqual(a.overworld);
    expect(b.rp).toBe(a.rp);
    expect(b.camp.gold).toBe(a.camp.gold);
  });

  it("no fixture entered the live registries (the deterministic sim is untouched)", () => {
    expect(Object.values(JOBS)).not.toContain(BROKER_FIX);
    const liveSkillIds = Object.values(JOBS).flatMap((j) => j.skills.map((s) => s.id));
    for (const fx of ["fx-cook-stew", "fx-find-trade", "fx-savvy-barter", "fx-field-triage"]) {
      expect(liveSkillIds).not.toContain(fx);
    }
  });
});
