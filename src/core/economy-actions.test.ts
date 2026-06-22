import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import { createRun, breakCamp, type RunState } from "./run";
import { createGuild, type Guild } from "./guild";
import { createCaravan } from "./caravan";
import {
  merchantBuy,
  merchantPrice,
  merchantSell,
  sellPrice,
  bankerEngageInterest,
  bankerBorrow,
  bankerProtect,
  patronize,
  hasNoble,
  nobleInfluencePerStep,
  accrueNobleInfluence,
  bribeEnemy,
  bribeCost,
  bribeChance,
  ECONOMY,
} from "./economy-actions";
import { streamFor } from "./rng";
import { gainRunGold, payTreasuryUpkeep } from "./economy";
import { countOf, addItem, getMaterial } from "./inventory";
import { currentNode } from "./run";
import type { NodePreview } from "./intel";

/** A Merchant party member (raises the market floor, D61). */
function merchant(): Unit {
  return createUnit({
    id: `merchant-${nextId++}`, side: "player", pos: { col: -1, row: -1 },
    jobId: "merchant", speed: 8, maxHp: 16, attack: 2, defense: 1, moveRange: 3, sightRadius: 4,
  });
}

/** A Noble party member — the standing-bearer that enables Influence, Patronize, and the bribe (D62). */
function noble(): Unit {
  return createUnit({
    id: `noble-${nextId++}`, side: "player", pos: { col: -1, row: -1 },
    jobId: "noble", speed: 8, maxHp: 16, attack: 2, defense: 1, moveRange: 3, sightRadius: 4, intelligence: 4,
  });
}

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

function newRun(seed: string, gold = 200): RunState {
  // The default party fields a Noble so the Influence verbs (Patronize, bribe — both
  // now job-gated on hasNoble, D62) are available; tests for the no-Noble path build
  // their own commoner-only run below.
  return createRun(seed, { party: [fighter("Rook"), noble()], difficultyId: "normal", gold, storageCap: 8 });
}

function guildWith(seed: string, treasury = 500): Guild {
  return createGuild(seed, { roster: [fighter("Rook")], treasury, caravans: [createCaravan("alpha", "scout-cart")] });
}

describe("economy-actions — Merchant ACCESS (purse, market-tier price) (D30/D61)", () => {
  it("buys a supply from the PURSE at the market-tier price", () => {
    const run = newRun("merchant", 100);
    const goldBefore = run.camp.gold;
    const res = merchantBuy(run, "trap-kit", "poor");
    expect(res.applied).toBe(true);
    expect(res.price).toBe(ECONOMY.merchant.buyPrice.poor);
    expect(run.camp.gold).toBe(goldBefore - ECONOMY.merchant.buyPrice.poor);
    expect(countOf(run.inventory, "trap-kit")).toBe(1);
  });

  it("a better market is cheaper access (premium < basic < poor) (D61)", () => {
    expect(merchantPrice("premium")).toBeLessThan(merchantPrice("basic"));
    expect(merchantPrice("basic")).toBeLessThan(merchantPrice("poor"));
  });

  it("refuses to buy where there is no market (`none`), spending nothing (D61)", () => {
    const run = newRun("merchant-nomarket");
    const res = merchantBuy(run, "trap-kit", "none");
    expect(res.applied).toBe(false);
    expect(res.reason).toMatch(/no market/i);
    expect(countOf(run.inventory, "trap-kit")).toBe(0);
  });

  it("refuses (spending nothing) when the purse can't cover it", () => {
    const run = newRun("merchant-broke", 1);
    const res = merchantBuy(run, "trap-kit", "basic");
    expect(res.applied).toBe(false);
    expect(run.camp.gold).toBe(1);
    expect(countOf(run.inventory, "trap-kit")).toBe(0);
  });
});

describe("economy-actions — Merchant SELL (goods -> gold, market-gated) (D61)", () => {
  it("sellPrice scales with the market tier (none can't sell; premium = full face)", () => {
    const v = getMaterial("valuables")!;
    expect(sellPrice(v, "none")).toBe(0);
    expect(sellPrice(v, "premium")).toBe(v.saleValue); // full face at a premium hub
    expect(sellPrice(v, "poor")).toBeGreaterThan(0);
    expect(sellPrice(v, "poor")).toBeLessThan(sellPrice(v, "basic"));
    expect(sellPrice(v, "basic")).toBeLessThan(sellPrice(v, "premium"));
  });

  it("sells a carried good for purse gold at the start node's market", () => {
    const run = newRun("sell-happy"); // start node is a `rest` (a real market)
    addItem(run.inventory, "valuables", 2);
    const goldBefore = run.camp.gold;
    const expected = sellPrice(getMaterial("valuables")!, currentNode(run).market!);
    const res = merchantSell(run, "valuables");
    expect(res.applied).toBe(true);
    expect(res.earned).toBe(expected);
    expect(run.camp.gold).toBe(goldBefore + expected);
    expect(countOf(run.inventory, "valuables")).toBe(1); // one sold
  });

  it("refuses (removing nothing) with no market here, and an impromptu Merchant unlocks it", () => {
    const run = newRun("sell-nomarket");
    run.map.nodes[run.mapNodeId].market = "none"; // a wild node, no market
    addItem(run.inventory, "valuables", 1);
    const blocked = merchantSell(run, "valuables");
    expect(blocked.applied).toBe(false);
    expect(countOf(run.inventory, "valuables")).toBe(1); // nothing removed

    // A Merchant in the party brokers an impromptu `poor` market -> the sale lands.
    run.party.push(merchant());
    const ok = merchantSell(run, "valuables");
    expect(ok.applied).toBe(true);
    expect(ok.earned).toBe(sellPrice(getMaterial("valuables")!, "poor"));
    expect(countOf(run.inventory, "valuables")).toBe(0);
  });

  it("refuses to sell a good you don't carry", () => {
    const run = newRun("sell-empty");
    const res = merchantSell(run, "valuables");
    expect(res.applied).toBe(false);
  });

  it("a brokering Merchant gains use-XP from the sale (D61, replaces Trade XP)", () => {
    const run = newRun("sell-xp");
    const coin = merchant();
    run.party.push(coin);
    addItem(run.inventory, "valuables", 1);
    const xpBefore = coin.xp;
    const res = merchantSell(run, "valuables");
    expect(res.applied).toBe(true);
    expect(coin.xp).toBeGreaterThan(xpBefore); // the Merchant grows from trading
    expect(typeof res.levels).toBe("number");
  });
});

describe("economy-actions — Banker TIME-SHIFT + SECURE (purse only) (D30/D34)", () => {
  it("engaged interest accrues on the node-step tick (purse, never treasury)", () => {
    const run = newRun("banker-interest", 100);
    const perStep = bankerEngageInterest(run);
    expect(perStep).toBeGreaterThan(0);
    expect(run.overworld.interestPerStep).toBe(perStep);

    const purseBefore = run.camp.gold;
    breakCamp(run); // the node-step tick at departure (D46) accrues interest
    expect(run.camp.gold).toBe(purseBefore + perStep);
  });

  it("buy-on-debt advances the purse and auto-repays from incoming run gold", () => {
    const run = newRun("banker-debt", 0);
    const res = bankerBorrow(run, 40);
    expect(res.applied).toBe(true);
    expect(run.camp.gold).toBe(40);
    expect(run.overworld.debt).toBe(40);

    // Incoming loot repays the debt before topping the purse.
    const credit = gainRunGold(run, 50);
    expect(credit.debtRepaid).toBe(40);
    expect(run.overworld.debt).toBe(0);
    expect(run.camp.gold).toBe(50); // 40 advanced + 10 net loot
  });

  it("theft protection is bought from the purse and engages a skim reduction", () => {
    const run = newRun("banker-protect", 200);
    const goldBefore = run.camp.gold;
    const res = bankerProtect(run);
    expect(res.applied).toBe(true);
    expect(run.camp.gold).toBe(goldBefore - ECONOMY.banker.protectionCost);
    expect(run.overworld.protection).toBeGreaterThan(0);
  });

  it("no Banker verb ever touches the guild treasury (D34)", () => {
    const g = guildWith("banker-no-treasury");
    const treasuryBefore = g.treasury;
    const run = newRun("banker-no-treasury-run", 100);
    bankerEngageInterest(run);
    bankerBorrow(run, 20);
    bankerProtect(run);
    // The Banker is purse-scoped — the vault is untouched.
    expect(g.treasury).toBe(treasuryBefore);
  });
});

/** A commoner — a plain fighter, not the Noble job, so the party fields no Noble (D62). */
function commoner(seed: string): Unit {
  return createUnit({ id: `grunt-${seed}`, side: "player", pos: { col: -1, row: -1 }, jobId: "soldier", speed: 10, maxHp: 20, attack: 6, defense: 2, moveRange: 4, sightRadius: 4, intelligence: 0 });
}

describe("economy-actions — Noble INFLUENCE (per-expedition, D30/D62)", () => {
  it("a Noble in the party accrues passive Influence each node-step", () => {
    const run = newRun("noble-passive"); // newRun's party fields a Noble (the standing-bearer)
    expect(hasNoble(run.party)).toBe(true);
    const before = run.overworld.influence;
    const gained = accrueNobleInfluence(run);
    expect(gained).toBe(ECONOMY.noble.incomePerStep);
    expect(run.overworld.influence).toBe(before + gained);
  });

  it("no Noble in the party → no passive Influence (no free faucet)", () => {
    const run = createRun("noble-none", { party: [commoner("none")], difficultyId: "normal", gold: 100, storageCap: 8 });
    expect(hasNoble(run.party)).toBe(false);
    expect(nobleInfluencePerStep(run.party)).toBe(0);
    expect(accrueNobleInfluence(run)).toBe(0);
    expect(run.overworld.influence).toBe(0);
  });

  it("Patronize converts purse gold into Influence, once per node (the two-axis gate, D61)", () => {
    const run = newRun("noble-patronize", 100);
    const goldBefore = run.camp.gold;
    const first = patronize(run);
    expect(first.applied).toBe(true);
    expect(run.overworld.influence).toBe(ECONOMY.noble.patronizeYield);
    expect(run.camp.gold).toBe(goldBefore - ECONOMY.noble.patronizeCost);
    // Spent for the node — a second Patronize refuses until Break Camp.
    const second = patronize(run);
    expect(second.applied).toBe(false);
    expect(second.reason).toMatch(/spent for tonight/i);
    // The per-node cap resets on the node-step.
    breakCamp(run);
    expect(patronize(run).applied).toBe(true);
  });

  it("Patronize refuses without a Noble, and when the purse can't cover it", () => {
    const noNoble = createRun("noble-patronize-none", { party: [commoner("pat")], difficultyId: "normal", gold: 100, storageCap: 8 });
    expect(patronize(noNoble).applied).toBe(false);

    const broke = newRun("noble-patronize-broke", ECONOMY.noble.patronizeCost - 1);
    const res = patronize(broke);
    expect(res.applied).toBe(false);
    expect(res.reason).toMatch(/gold/i);
  });

  it("Influence can't pay Upkeep — earning it leaves the treasury bill unfunded (D34)", () => {
    const g = guildWith("noble-no-upkeep", 0);
    const run = newRun("noble-no-upkeep-run");
    accrueNobleInfluence(run);
    const infBefore = run.overworld.influence;
    expect(infBefore).toBeGreaterThan(0);
    const res = payTreasuryUpkeep(g);
    expect(res.paid).toBe(0); // treasury empty; Influence is no help
    expect(run.overworld.influence).toBe(infBefore); // and it isn't spent on Upkeep
  });

  it("a bribe reads the preview for its price and flips a GENERIC for the fight only (D33)", () => {
    const run = newRun("noble-bribe-generic");
    run.overworld.influence = 30; // renowned standing → a guaranteed sway (chance 1.0)
    const generic = createUnit({ id: "thug", side: "enemy", pos: { col: 7, row: 0 }, name: "Thug", speed: 10, maxHp: 16, attack: 6, defense: 1, moveRange: 4, sightRadius: 5 });

    const lowIntel: NodePreview = { nodeId: "n1-0", kind: "combat", layer: 1, intel: { tier: 0, grantsVision: false } };
    const highIntel: NodePreview = { nodeId: "n1-0", kind: "combat", layer: 1, intel: { tier: 3, grantsVision: true } };
    // Knowing the field is leverage: a higher-intel preview makes the sway cheaper.
    expect(bribeCost(highIntel)).toBeLessThan(bribeCost(lowIntel));

    const infBefore = run.overworld.influence;
    const res = bribeEnemy(run, generic, highIntel);
    expect(res.applied).toBe(true);
    expect(run.overworld.influence).toBe(infBefore - res.cost!);
    expect(res.outcome!.temporary).toBe(true);
    expect(res.outcome!.permanent).toBe(false);
  });

  it("a bribed AUTHORED unit is a permanent recruit (the temp↔permanent flag, D33)", () => {
    const run = newRun("noble-bribe-authored");
    run.overworld.influence = 30; // renowned standing → a guaranteed sway (chance 1.0)
    const named = createUnit({ id: "Sable", side: "enemy", pos: { col: 7, row: 0 }, name: "Sable", speed: 12, maxHp: 24, attack: 8, defense: 2, moveRange: 4, sightRadius: 5, authored: true });
    const res = bribeEnemy(run, named);
    expect(res.applied).toBe(true);
    expect(res.outcome!.permanent).toBe(true);
    expect(res.outcome!.temporary).toBe(false);
  });

  it("refuses (spending no Influence) when the run can't afford the bribe", () => {
    const run = newRun("noble-broke");
    run.overworld.influence = 0;
    const generic = createUnit({ id: "thug2", side: "enemy", pos: { col: 7, row: 0 }, name: "Thug", speed: 10, maxHp: 16, attack: 6, defense: 1, moveRange: 4, sightRadius: 5 });
    const res = bribeEnemy(run, generic);
    expect(res.applied).toBe(false);
    expect(res.failed).toBeUndefined(); // couldn't afford — *not* a failed roll
    expect(run.overworld.influence).toBe(0);
  });

  it("standing makes a bribe cheaper and likelier (D62)", () => {
    // Cost falls as standing rises; the success chance is monotonic across bands.
    expect(bribeCost(undefined, "renowned")).toBeLessThanOrEqual(bribeCost(undefined, "known"));
    expect(bribeChance("known")).toBeLessThan(bribeChance("respected"));
    expect(bribeChance("respected")).toBeLessThan(bribeChance("renowned"));
    expect(bribeChance("renowned")).toBe(1);
  });

  it("a failed sway still spends the Influence (the gamble), deterministic per target+node (D62)", () => {
    const run = newRun("noble-bribe-fail");
    run.overworld.influence = 5; // 'known' band → chance 0.55, so some targets resist
    // Find a target whose fixed roll resists at this band (no save-scum: same seed each call).
    let resistId = "";
    for (let i = 0; i < 60 && !resistId; i++) {
      if (!streamFor(run.seed, `bribe:${run.mapNodeId}:foe-${i}`).chance(bribeChance("known"))) resistId = `foe-${i}`;
    }
    expect(resistId).not.toBe("");
    const foe = createUnit({ id: resistId, side: "enemy", pos: { col: 7, row: 0 }, name: "Holdout", speed: 10, maxHp: 16, attack: 6, defense: 1, moveRange: 4, sightRadius: 5 });
    const before = run.overworld.influence;
    const res = bribeEnemy(run, foe);
    expect(res.applied).toBe(false);
    expect(res.failed).toBe(true);
    expect(run.overworld.influence).toBeLessThan(before); // spent for nothing
    // The roll is fixed for this target+node — re-attempting (refunded) resists again.
    run.overworld.influence = before;
    expect(bribeEnemy(run, foe).failed).toBe(true);
  });
});
