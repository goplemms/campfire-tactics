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
  collectPoliticalIncome,
  bribeEnemy,
  bribeCost,
  ECONOMY,
} from "./economy-actions";
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
  return createRun(seed, { party: [fighter("Rook")], difficultyId: "normal", gold, storageCap: 8 });
}

function guildWith(seed: string, treasury = 500): Guild {
  return createGuild(seed, { roster: [fighter("Rook")], treasury, caravans: [createCaravan("alpha", "scout-cart")] });
}

describe("economy-actions — Merchant ACCESS (purse, node-tier price) (D30)", () => {
  it("buys a supply from the PURSE at a node-tier price", () => {
    const run = newRun("merchant", 100);
    const goldBefore = run.camp.gold;
    const res = merchantBuy(run, "trap-kit", "combat");
    expect(res.applied).toBe(true);
    expect(res.price).toBe(ECONOMY.merchant.wildPrice);
    expect(run.camp.gold).toBe(goldBefore - ECONOMY.merchant.wildPrice);
    expect(countOf(run.inventory, "trap-kit")).toBe(1);
  });

  it("a town (rest) node offers better access than the wild (D30)", () => {
    expect(merchantPrice("rest")).toBeLessThan(merchantPrice("combat"));
    expect(merchantPrice("rest")).toBe(ECONOMY.merchant.townPrice);
  });

  it("refuses (spending nothing) when the purse can't cover it", () => {
    const run = newRun("merchant-broke", 1);
    const res = merchantBuy(run, "trap-kit", "combat");
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

describe("economy-actions — Noble INFLUENCE (D30/D34)", () => {
  it("political income lands as Influence (a separate currency)", () => {
    const g = guildWith("noble-income");
    const before = g.influence;
    const gained = collectPoliticalIncome(g);
    expect(gained).toBeGreaterThan(0);
    expect(g.influence).toBe(before + gained);
  });

  it("Influence can't pay Upkeep — earning it leaves the treasury bill unfunded", () => {
    const g = guildWith("noble-no-upkeep", 0);
    collectPoliticalIncome(g);
    collectPoliticalIncome(g);
    const infBefore = g.influence;
    const res = payTreasuryUpkeep(g);
    expect(res.paid).toBe(0); // treasury empty; Influence is no help
    expect(g.influence).toBe(infBefore); // and it isn't spent on Upkeep
  });

  it("a bribe reads the preview for its price and flips a GENERIC for the fight only (D33)", () => {
    const g = guildWith("noble-bribe-generic");
    g.influence = 10;
    const generic = createUnit({ id: "thug", side: "enemy", pos: { col: 7, row: 0 }, name: "Thug", speed: 10, maxHp: 16, attack: 6, defense: 1, moveRange: 4, sightRadius: 5 });

    const lowIntel: NodePreview = { nodeId: "n1-0", kind: "combat", layer: 1, intel: { tier: 0, grantsVision: false } };
    const highIntel: NodePreview = { nodeId: "n1-0", kind: "combat", layer: 1, intel: { tier: 3, grantsVision: true } };
    // Knowing the field is leverage: a higher-intel preview makes the sway cheaper.
    expect(bribeCost(highIntel)).toBeLessThan(bribeCost(lowIntel));

    const infBefore = g.influence;
    const res = bribeEnemy(g, generic, highIntel);
    expect(res.applied).toBe(true);
    expect(g.influence).toBe(infBefore - res.cost!);
    expect(res.outcome!.temporary).toBe(true);
    expect(res.outcome!.permanent).toBe(false);
  });

  it("a bribed AUTHORED unit is a permanent recruit (the temp↔permanent flag, D33)", () => {
    const g = guildWith("noble-bribe-authored");
    g.influence = 10;
    const named = createUnit({ id: "Sable", side: "enemy", pos: { col: 7, row: 0 }, name: "Sable", speed: 12, maxHp: 24, attack: 8, defense: 2, moveRange: 4, sightRadius: 5, authored: true });
    const res = bribeEnemy(g, named);
    expect(res.applied).toBe(true);
    expect(res.outcome!.permanent).toBe(true);
    expect(res.outcome!.temporary).toBe(false);
  });

  it("refuses (spending no Influence) when the guild can't afford the bribe", () => {
    const g = guildWith("noble-broke");
    g.influence = 0;
    const generic = createUnit({ id: "thug2", side: "enemy", pos: { col: 7, row: 0 }, name: "Thug", speed: 10, maxHp: 16, attack: 6, defense: 1, moveRange: 4, sightRadius: 5 });
    const res = bribeEnemy(g, generic);
    expect(res.applied).toBe(false);
    expect(g.influence).toBe(0);
  });
});
