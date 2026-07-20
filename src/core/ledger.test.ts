import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import { createRun, type RunState } from "./run";
import { computeUpkeep } from "./upkeep";
import { buildLedger, nightEndGate } from "./ledger";

function roster(): Unit[] {
  return [
    createUnit({ id: "Rook", side: "player", pos: { col: 0, row: 1 }, jobId: "soldier", speed: 12, maxHp: 30, attack: 9, defense: 3, moveRange: 4, sightRadius: 5, awareness: 4, intelligence: 4 }),
    createUnit({ id: "Vale", side: "player", pos: { col: 0, row: 4 }, jobId: "survivalist", speed: 10, maxHp: 24, attack: 11, defense: 2, moveRange: 4, sightRadius: 5, awareness: 2 }),
  ];
}

function newRun(seed: string, gold = 200): RunState {
  return createRun(seed, { party: roster(), difficultyId: "normal", gold });
}

/** Push a synthetic history record (a node outcome). */
function record(run: RunState, nodeId: string, goldEarned: number): void {
  run.history.push({ nodeId, layer: 1, kind: "combat", goldEarned, fallen: [], night: run.night });
}

describe("ledger — purse-scoped categories reconcile (D45)", () => {
  it("each itemized category total is the sum of its line items", () => {
    const run = newRun("ledger-lines");
    record(run, "n1-0", 60); // loot
    record(run, "n2-0", -15); // a field spend (a toll / skim)
    const ledger = buildLedger(run);
    // The `opening` lump-sum carries its figure on the header with no sub-lines; every other
    // category itemizes, so its total must equal the sum of its lines.
    for (const cat of ledger.categories.filter((c) => c.id !== "opening")) {
      expect(cat.total).toBe(cat.lines.reduce((s, l) => s + l.amount, 0));
    }
  });

  it("the opening lump-sum is a header-only total (no redundant sub-line)", () => {
    const ledger = buildLedger(newRun("ledger-opening", 180));
    const opening = ledger.categories.find((c) => c.id === "opening")!;
    expect(opening.lines).toHaveLength(0);
    expect(opening.total).toBe(180);
  });

  it("the realized categories sum to the balance", () => {
    const run = newRun("ledger-balance", 200);
    record(run, "n1-0", 80);
    record(run, "n2-0", -25);
    const ledger = buildLedger(run);
    const realized = ledger.categories.filter((c) => !c.projected);
    const sum = realized.reduce((s, c) => s + c.total, 0);
    expect(sum).toBe(ledger.balance);
    expect(ledger.balance).toBe(run.camp.purse);
  });

  it("expanding the Upkeep category exposes the Food/Repairs lines", () => {
    const run = newRun("ledger-upkeep");
    const ledger = buildLedger(run);
    const upkeep = ledger.categories.find((c) => c.id === "upkeep")!;
    expect(upkeep.projected).toBe(true);
    const bill = computeUpkeep(run.party);
    expect(upkeep.lines.map((l) => l.label).sort()).toEqual(bill.lines.map((l) => l.name).sort());
  });

  it("Influence is shown but never summed into the gold balance (D34)", () => {
    const run = newRun("ledger-influence", 150);
    const ledger = buildLedger(run, { influence: 999 });
    expect(ledger.influence).toBe(999);
    expect(ledger.balance).toBe(150); // gold untouched by Influence
    const realizedSum = ledger.categories.filter((c) => !c.projected).reduce((s, c) => s + c.total, 0);
    expect(realizedSum).toBe(150); // Influence is nowhere in the gold reconciliation
  });

  it("forecastBalance = balance + the projected categories (into tomorrow)", () => {
    const run = newRun("ledger-forecast-balance", 200);
    record(run, "n1-0", 40); // loot in → balance already reflects it
    const ledger = buildLedger(run);
    const projected = ledger.categories.filter((c) => c.projected).reduce((s, c) => s + c.total, 0);
    expect(ledger.forecastBalance).toBe(ledger.balance + projected);
    // Tonight's Upkeep is an outflow, so the forecast sits below the current balance.
    expect(ledger.forecastBalance).toBeLessThan(ledger.balance);
  });

  it("a voluntary Upkeep skip lifts the forecast balance (its cost is freed)", () => {
    const run = newRun("ledger-forecast-skip", 200);
    const funded = buildLedger(run).forecastBalance;
    run.camp.skippedUpkeep = ["food"];
    const skipped = buildLedger(run).forecastBalance;
    expect(skipped).toBeGreaterThan(funded); // crossing Food off keeps that gold
  });

  it("embeds the route forecast (the load-bearing forward half, D48)", () => {
    const run = newRun("ledger-forecast");
    const ledger = buildLedger(run);
    expect(ledger.forecast).toBeDefined();
    expect(ledger.forecast.perEdge.length).toBeGreaterThan(0);
  });
});

describe("ledger — the intent-aware soft gate (D45)", () => {
  it("warns on a real shortfall (a can't-afford, non-voluntary breach)", () => {
    const run = newRun("gate-broke", 0); // can't afford a thing
    const gate = nightEndGate(run);
    expect(gate.warn).toBe(true);
    expect(gate.reasons.some((r) => /afford/i.test(r))).toBe(true);
  });

  it("stays quiet on a deliberate voluntary skip (intent, not the funded bit)", () => {
    const run = newRun("gate-skip", 500); // flush — could afford everything
    run.camp.skippedUpkeep = ["food"]; // but chooses to skip Food
    const gate = nightEndGate(run);
    // The voluntary skip must NOT nag — nothing else is wrong here.
    expect(gate.reasons.some((r) => /food/i.test(r))).toBe(false);
    expect(gate.warn).toBe(false);
  });

  it("warns on outstanding debt (Banker gold + worn gear)", () => {
    const run = newRun("gate-debt", 500);
    run.overworld.debt = 40;
    run.camp.gearWear = 2;
    const gate = nightEndGate(run);
    expect(gate.warn).toBe(true);
    expect(gate.reasons.some((r) => /debt/i.test(r))).toBe(true);
    expect(gate.reasons.some((r) => /worn gear/i.test(r))).toBe(true);
  });

  it("a can't-afford line still nags even alongside a voluntary skip", () => {
    const run = newRun("gate-mixed", 0);
    run.camp.skippedUpkeep = ["repairs"]; // voluntarily skip Repairs…
    const gate = nightEndGate(run);
    // …but Food is genuinely unaffordable → it still warns (intent vs affordability).
    expect(gate.reasons.some((r) => /Food/.test(r))).toBe(true);
    expect(gate.reasons.some((r) => /Repairs/.test(r))).toBe(false);
  });
});
