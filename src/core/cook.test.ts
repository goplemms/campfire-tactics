import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import { createRun, type RunState } from "./run";
import { useOverworldSkill } from "./overworld-actions";
import { availableSkills } from "./leveling";
import { computeUpkeep, payUpkeep } from "./upkeep";
import { COOK_STEW, FEAST, COOK_KIT } from "./jobs-data/support";

// D71 — the Cook kit (renamed from Chef), consuming the D72 substrate:
// Field Kitchen (food-upkeep discount), Cook Stew (provisionMeal — food → RP), Feast (morale).

const cook = (): Unit =>
  createUnit({ id: "Pip", side: "player", pos: { col: -1, row: -1 }, jobId: "cook", speed: 8, maxHp: 18, attack: 3, defense: 1, moveRange: 3, sightRadius: 4 });
const fighter = (id: string): Unit =>
  createUnit({ id, side: "player", pos: { col: -1, row: -1 }, jobId: "soldier", speed: 10, maxHp: 24, attack: 8, defense: 3, moveRange: 4, sightRadius: 4 });
const newRun = (seed: string, party: Unit[], gold = 200): RunState =>
  createRun(seed, { party, difficultyId: "normal", gold, storageCap: 8 });

describe("Cook kit (D71) — food → recovery", () => {
  it("surfaces its two meal verbs via the one projection (the non-combat 2+1)", () => {
    const ids = availableSkills(cook(), "overworld").map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["cook-stew", "feast"]));
  });

  it("Field Kitchen — a fielded Cook lowers the party's Food upkeep", () => {
    const food = (party: Unit[]) => computeUpkeep(party).lines.find((l) => l.id === "food")!.cost;
    expect(food([fighter("a"), cook()])).toBeLessThan(food([fighter("a"), fighter("b")]));
  });

  it("Cook Stew — priced at the night's Food value, banks RP, satisfies the Food line (no double-charge)", () => {
    const run = newRun("stew", [cook(), fighter("r")]);
    const foodCost = computeUpkeep(run.party).lines.find((l) => l.id === "food")!.cost;
    const goldBefore = run.camp.gold;
    const rpBefore = run.rp;

    const res = useOverworldSkill(run, run.party[0], COOK_STEW);
    expect(res.applied).toBe(true);
    expect(run.camp.gold).toBe(goldBefore - foodCost); // the dynamic price = the night's food value
    expect(run.rp).toBe(rpBefore + COOK_KIT.stewRp); // RP banked

    // End the Night bills upkeep — Food is already satisfied, so it isn't charged again.
    const bill = computeUpkeep(run.party);
    const up = payUpkeep(run.camp, run.party, { skip: [] });
    expect(up.paid).toBe(bill.total - foodCost);
    expect(up.underfunded).not.toContain("food");
  });

  it("Cook Stew is once per node (the costless-signature limiter)", () => {
    const run = newRun("stew-cap", [cook()]);
    expect(useOverworldSkill(run, run.party[0], COOK_STEW).applied).toBe(true);
    const second = useOverworldSkill(run, run.party[0], COOK_STEW);
    expect(second.applied).toBe(false);
    expect(second.reason).toMatch(/spent for tonight/i);
  });

  it("Feast — a paid, once-per-node morale lift (the dedicated morale lever)", () => {
    const run = newRun("feast", [cook()]);
    const moraleBefore = run.camp.morale;
    const goldBefore = run.camp.gold;
    const res = useOverworldSkill(run, run.party[0], FEAST);
    expect(res.applied).toBe(true);
    expect(run.camp.morale).toBe(moraleBefore + COOK_KIT.feastMorale);
    expect(run.camp.gold).toBe(goldBefore - COOK_KIT.feastGold);
  });
});
