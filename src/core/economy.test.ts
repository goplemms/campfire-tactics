import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import { createRun, breakCamp, type RunState } from "./run";
import {
  createGuild,
  dispatch,
  resolveReturn,
  type Guild,
} from "./guild";
import { createCaravan, assignMember, loadPurse } from "./caravan";
import {
  gainRunGold,
  routePayoutToTreasury,
  payTreasuryUpkeep,
  addInfluence,
  spendInfluence,
  canAffordInfluence,
  influenceTier,
} from "./economy";
import { createOverworldEconomy } from "./overworld-actions";

let nextId = 0;
function fighter(name: string): Unit {
  return createUnit({
    id: `${name}-${nextId++}`,
    side: "player",
    pos: { col: -1, row: -1 },
    name,
    jobId: "soldier",
    speed: 11,
    maxHp: 28,
    attack: 9,
    defense: 3,
    moveRange: 4,
    sightRadius: 5,
    awareness: 3,
    intelligence: 3,
  });
}

function newRun(seed: string, gold = 100): RunState {
  return createRun(seed, { party: [fighter("Rook")], difficultyId: "normal", gold });
}

function guildWith(seed: string): Guild {
  return createGuild(seed, {
    roster: [fighter("Rook"), fighter("Vale")],
    treasury: 500,
    caravans: [createCaravan("alpha", "scout-cart")],
  });
}

describe("economy — loot fills the PURSE (D34)", () => {
  it("gainRunGold credits the run purse (camp.gold), not the treasury", () => {
    const run = newRun("loot", 50);
    const res = gainRunGold(run, 80);
    expect(res.credited).toBe(80);
    expect(res.debtRepaid).toBe(0);
    expect(run.camp.gold).toBe(130);
  });

  it("incoming gold auto-repays Banker debt first, then fills the purse (D30)", () => {
    const run = newRun("loot-debt", 0);
    run.overworld.debt = 30;
    const res = gainRunGold(run, 50);
    expect(res.debtRepaid).toBe(30);
    expect(res.credited).toBe(20);
    expect(run.overworld.debt).toBe(0);
    expect(run.camp.gold).toBe(20);
  });
});

describe("economy — quest payouts fill the TREASURY (D34)", () => {
  it("routePayoutToTreasury banks gold into the vault", () => {
    const g = guildWith("payout");
    const before = g.treasury;
    const banked = routePayoutToTreasury(g, 200);
    expect(banked).toBe(200);
    expect(g.treasury).toBe(before + 200);
  });

  it("a completed quest grows the treasury by its payout (the only earned faucet)", () => {
    const g = guildWith("payout-int");
    const c = g.caravans[0];
    assignMember(c, g.roster[0]);
    loadPurse(c, 40);
    const quest = g.board.find((q) => q.generated)!;
    const gr = dispatch(g, c, quest);
    const afterDispatch = g.treasury; // treasury already debited the purse

    gr.run.complete = true;
    gr.run.camp.gold = 40; // the surviving purse
    const res = resolveReturn(g, c, gr.run);

    expect(res.payout).toBe(quest.payout);
    // Treasury grew by the payout + the returning purse — nothing else.
    expect(g.treasury).toBe(afterDispatch + quest.payout + 40);
  });

  it("a WIPED quest pays nothing into the treasury (D34)", () => {
    const g = guildWith("payout-wipe");
    const c = g.caravans[0];
    assignMember(c, g.roster[0]);
    loadPurse(c, 40);
    const gr = dispatch(g, c, g.board.find((q) => q.generated)!);
    const afterDispatch = g.treasury;
    for (const u of gr.run.party) u.alive = false; // a wipe
    const res = resolveReturn(g, c, gr.run);
    expect(res.outcome).toBe("wiped");
    expect(res.payout).toBe(0);
    expect(g.treasury).toBe(afterDispatch); // not a copper
  });
});

describe("economy — the treasury has NO passive faucet (D34)", () => {
  it("advancing a caravan's run (node-steps) never grows the treasury", () => {
    const g = guildWith("no-faucet");
    const c = g.caravans[0];
    assignMember(c, g.roster[0]);
    const gr = dispatch(g, c, g.board.find((q) => q.generated)!);
    const treasuryAfterDispatch = g.treasury;

    // Play several node-steps; loot lands in the purse, not the vault.
    for (let i = 0; i < 4; i++) {
      breakCamp(gr.run); // the node-step tick at departure (D46)
    }
    expect(g.treasury).toBe(treasuryAfterDispatch);
  });

  it("purse interest accrues to the purse, never the treasury (D30/D34)", () => {
    const g = guildWith("interest-faucet");
    const c = g.caravans[0];
    assignMember(c, g.roster[0]);
    loadPurse(c, 100);
    const gr = dispatch(g, c, g.board.find((q) => q.generated)!);
    const treasuryAfterDispatch = g.treasury;

    gr.run.overworld.interestPerStep = 10; // Banker engaged
    const purseBefore = gr.run.camp.gold;
    breakCamp(gr.run); // the node-step tick at departure (D46) accrues interest

    expect(gr.run.camp.gold).toBe(purseBefore + 10); // purse grew
    expect(g.treasury).toBe(treasuryAfterDispatch); // treasury did not
  });
});

describe("economy — Upkeep is the TREASURY-side sink (D15/D34)", () => {
  it("payTreasuryUpkeep draws the bill from the treasury", () => {
    const g = guildWith("upkeep");
    const before = g.treasury;
    const res = payTreasuryUpkeep(g);
    expect(res.bill.total).toBeGreaterThan(0);
    expect(res.paid).toBe(res.bill.total);
    expect(res.underfunded).toEqual([]);
    expect(g.treasury).toBe(before - res.bill.total);
  });

  it("a broke treasury underfunds lines (a real choice, D15)", () => {
    const g = guildWith("upkeep-broke");
    g.treasury = 0;
    const res = payTreasuryUpkeep(g);
    expect(res.paid).toBe(0);
    expect(res.underfunded.length).toBeGreaterThan(0);
    expect(res.shortfall).toBeGreaterThan(0);
  });
});

describe("economy — Influence is a purpose-bound, per-expedition currency (D34/D62)", () => {
  it("adds and spends on the run economy, walled off from gold", () => {
    const eco = createOverworldEconomy();
    addInfluence(eco, 5);
    expect(eco.influence).toBe(5);
    expect(canAffordInfluence(eco, 3)).toBe(true);
    expect(spendInfluence(eco, 3)).toBe(true);
    expect(eco.influence).toBe(2);
    expect(spendInfluence(eco, 5)).toBe(false); // can't overdraw
    expect(eco.influence).toBe(2);
  });

  it("Influence can NEVER pay Upkeep — Upkeep only reads the treasury (D34)", () => {
    const g = guildWith("influence-upkeep");
    g.treasury = 0;
    const eco = createOverworldEconomy();
    addInfluence(eco, 1000); // a fortune in Influence, held by the run (not the guild)
    const res = payTreasuryUpkeep(g);
    // Upkeep still goes unfunded: Influence is not gold and can't cover it.
    expect(res.paid).toBe(0);
    expect(res.underfunded.length).toBeGreaterThan(0);
    expect(eco.influence).toBe(1000); // untouched by Upkeep
  });

  it("bands the raw standing value into tiers (D62)", () => {
    expect(influenceTier(0)).toBe("unknown");
    expect(influenceTier(3)).toBe("known");
    expect(influenceTier(8)).toBe("respected");
    expect(influenceTier(15)).toBe("favored");
    expect(influenceTier(25)).toBe("renowned");
  });
});
