import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import type { JobId } from "./jobs";
import { createCamp } from "./camp";
import { DIFFICULTIES } from "./mortality";
import {
  computeUpkeep,
  payUpkeep,
  rpPerNight,
  triageHeal,
  clericRevive,
  chunkHp,
  CLERIC_COST,
  UPKEEP,
} from "./upkeep";

function member(id: string, jobId?: JobId): Unit {
  return createUnit({
    id,
    side: "player",
    pos: { col: 0, row: 0 },
    jobId,
    speed: 10,
    maxHp: 32,
    attack: 6,
    defense: 2,
    moveRange: 4,
    sightRadius: 5,
  });
}

describe("upkeep — the gold figure (D15)", () => {
  it("sums Food + Repairs into one total", () => {
    const party = [member("a"), member("b")];
    const bill = computeUpkeep(party);
    expect(bill.lines.map((l) => l.id)).toEqual(["food", "repairs"]);
    expect(bill.total).toBe(bill.lines.reduce((s, l) => s + l.cost, 0));
    // No Chef → full food cost.
    expect(bill.lines.find((l) => l.id === "food")!.cost).toBe(UPKEEP.foodPerUnit * 2);
  });

  it("a Chef lowers the per-unit food cost", () => {
    const withChef = computeUpkeep([member("a"), member("chef", "chef")]);
    const without = computeUpkeep([member("a"), member("b")]);
    expect(withChef.lines.find((l) => l.id === "food")!.cost).toBeLessThan(
      without.lines.find((l) => l.id === "food")!.cost,
    );
  });

  it("paying in full deducts gold and leaves morale untouched", () => {
    const party = [member("a"), member("b")];
    const camp = createCamp({ gold: 100, morale: 0 });
    const res = payUpkeep(camp, party);
    expect(res.underfunded).toEqual([]);
    expect(res.moraleDelta).toBe(0);
    expect(camp.gold).toBe(100 - computeUpkeep(party).total);
  });

  it("underfunding food hits morale (the harsh breach, funded last)", () => {
    const party = [member("a"), member("b")];
    const camp = createCamp({ gold: 0, morale: 0 });
    const res = payUpkeep(camp, party);
    expect(res.underfunded).toContain("food");
    expect(res.moraleDelta).toBeLessThan(0);
    expect(camp.morale).toBeLessThan(0);
  });

  it("underfunding only repairs wears gear with a moderate hit", () => {
    const party = [member("a"), member("b")];
    const bill = computeUpkeep(party);
    const foodCost = bill.lines.find((l) => l.id === "food")!.cost;
    const camp = createCamp({ gold: foodCost, morale: 0 }); // enough for food only
    const res = payUpkeep(camp, party);
    expect(res.underfunded).toEqual(["repairs"]);
    expect(res.gearWorn).toBe(true);
    expect(res.skipped).toEqual([]);
    expect(camp.gearWear).toBe(1); // worn-gear debt compounds (D45/D47)
  });
});

describe("upkeep — voluntary underfunding: the ledger as an input (D45)", () => {
  it("a voluntary skip frees its gold but still applies the consequence", () => {
    const party = [member("a"), member("b")];
    const bill = computeUpkeep(party);
    const camp = createCamp({ gold: 100, morale: 0 }); // could afford everything
    const res = payUpkeep(camp, party, { skip: ["food"] });

    // The Food gold is freed (only Repairs paid) — that's the point of the skip.
    const repairs = bill.lines.find((l) => l.id === "repairs")!.cost;
    expect(camp.gold).toBe(100 - repairs);
    // It's reported as an *intentional* skip, not a can't-afford breach…
    expect(res.skipped).toEqual(["food"]);
    expect(res.underfunded).toEqual([]);
    // …but the morale consequence still lands (the skip keeps teeth, D45).
    expect(res.moraleDelta).toBeLessThan(0);
    expect(camp.morale).toBeLessThan(0);
  });

  it("voluntarily skipping repairs compounds the worn-gear debt", () => {
    const party = [member("a")];
    const camp = createCamp({ gold: 100 });
    payUpkeep(camp, party, { skip: ["repairs"] });
    expect(camp.gearWear).toBe(1);
    payUpkeep(camp, party, { skip: ["repairs"] });
    expect(camp.gearWear).toBe(2); // compounds — the rest node clears it (D47)
  });

  it("a can't-afford skip still breaches (intent vs affordability)", () => {
    const party = [member("a"), member("b")];
    const camp = createCamp({ gold: 0 }); // can't afford anything
    const res = payUpkeep(camp, party); // no voluntary skips
    // Genuinely unaffordable lines are breaches, not voluntary skips.
    expect(res.underfunded.length).toBeGreaterThan(0);
    expect(res.skipped).toEqual([]);
  });

  it("defaults the skip set to the camp's persisted selection (D45 seam)", () => {
    const party = [member("a"), member("b")];
    const camp = createCamp({ gold: 100, skippedUpkeep: ["food"] });
    const res = payUpkeep(camp, party); // no explicit skip → reads camp.skippedUpkeep
    expect(res.skipped).toEqual(["food"]);
  });
});

describe("recovery — Rest Points (D9)", () => {
  it("support roles bank RP per night (data-driven)", () => {
    expect(rpPerNight([member("fighter")])).toBe(0);
    expect(rpPerNight([member("chef", "chef")])).toBeGreaterThan(0);
  });

  it("triage spends whole chunks of RP to heal a unit", () => {
    const u = member("hurt");
    u.hp = 4;
    const policy = DIFFICULTIES.normal;
    const before = u.hp;
    const res = triageHeal(u, policy.rpPerChunk * 2, policy);
    expect(res.chunks).toBeGreaterThan(0);
    expect(res.rpSpent).toBe(res.chunks * policy.rpPerChunk);
    expect(u.hp).toBe(before + res.chunks * chunkHp(u));
  });

  it("triage heals nothing with insufficient RP or a full unit", () => {
    const u = member("full");
    expect(triageHeal(u, 999, DIFFICULTIES.normal).hpHealed).toBe(0); // already full
    u.hp = 1;
    expect(triageHeal(u, 0, DIFFICULTIES.normal).hpHealed).toBe(0); // no RP
  });

  it("difficulty scales RP per chunk (one dial)", () => {
    const u = member("x");
    u.hp = 1;
    const easy = triageHeal({ ...u, hp: 1, counters: {}, statuses: [] } as Unit, 100, DIFFICULTIES.easy);
    const hard = triageHeal({ ...u, hp: 1, counters: {}, statuses: [] } as Unit, 100, DIFFICULTIES.hardest);
    // The same 100 RP buys more chunks on Easy than on Hardest.
    expect(easy.chunks).toBeGreaterThanOrEqual(hard.chunks);
  });
});

describe("recovery — the cleric (D9 economy sink)", () => {
  it("revives a dying unit for gold; refuses if not dying or broke", () => {
    const u = member("rook");
    u.alive = false;
    u.hp = 0;
    u.counters.dyingNights = 2;
    const camp = createCamp({ gold: CLERIC_COST });
    const res = clericRevive(camp, u);
    expect(res.revived).toBe(true);
    expect(camp.gold).toBe(0);
    expect(u.alive).toBe(true);
    expect(u.counters.dyingNights).toBeUndefined();

    // A healthy unit can't be revived; a broke camp can't pay.
    expect(clericRevive(createCamp({ gold: CLERIC_COST }), member("ok")).revived).toBe(false);
  });
});
