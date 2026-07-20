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
  hasBanker,
  patronize,
  hasNoble,
  declaredFaucetInfluence,
  accrueDeclaredFaucets,
  bribeEnemy,
  bribePrice,
  bribeChance,
  triage,
  ECONOMY,
} from "./economy-actions";
import { streamFor } from "./rng";
import { Labels } from "./rng-labels";
import { gainRunGold, payTreasuryUpkeep } from "./economy";
import { countOf, addItem, getMaterial } from "./inventory";
import { currentNode } from "./run";
import { useOverworldSkill, applyOverworldEffect } from "./overworld-actions";
import { FIND_TRADE, TRIAGE_FALLBACK, UNIVERSAL_BUY } from "./jobs-data/support";
import { MEDIC_TRIAGE } from "./jobs-data/combat";
import { chunkHp, restHeal } from "./upkeep";
import { runDifficulty } from "./run";
import { availableSkills } from "./leveling";
import type { NodePreview } from "./intel";

/** A Merchant party member — the trade-broker (Appraisal / Find Trade / Savvy Barter, D70). */
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

/** A Banker party member — the financier that enables the purse-finance verbs (D30). */
function banker(): Unit {
  return createUnit({
    id: `banker-${nextId++}`, side: "player", pos: { col: -1, row: -1 },
    jobId: "banker", speed: 8, maxHp: 16, attack: 2, defense: 1, moveRange: 3, sightRadius: 4,
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
  // The default party fields a Noble *and* a Banker so the job-gated economy verbs are
  // available — the Influence verbs (Patronize, bribe — hasNoble, D62) and the purse-
  // finance verbs (Invest/Borrow/Guard — hasBanker, D30). Tests for the no-Noble /
  // no-Banker paths build their own commoner-only run below.
  return createRun(seed, { party: [fighter("Rook"), noble(), banker()], difficultyId: "normal", gold, storageCap: 8 });
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

  it("refuses (removing nothing) with no market here; the Merchant's Find Trade unlocks it (D70)", () => {
    const run = newRun("sell-nomarket");
    run.map.nodes[run.mapNodeId].market = "none"; // a wild node, no market
    addItem(run.inventory, "valuables", 1);
    const blocked = merchantSell(run, "valuables");
    expect(blocked.applied).toBe(false);
    expect(countOf(run.inventory, "valuables")).toBe(1); // nothing removed

    // A Merchant alone no longer passively floors the market (D70 retired merchantFloor)…
    const coin = merchant();
    run.party.push(coin);
    expect(merchantSell(run, "valuables").applied).toBe(false);
    // …but Find Trade opens an impromptu `poor` market here, and the sale lands at poor
    // (Appraisal never lifts the conjured market — D70 ordering).
    useOverworldSkill(run, coin, FIND_TRADE);
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
    const res = bankerEngageInterest(run);
    expect(res.applied).toBe(true);
    const perStep = res.perStep!;
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

  it("the purse-finance verbs are job-gated: with no Banker they refuse, engaging/spending nothing (D30)", () => {
    // A party with gold but no Banker — the financier who works the purse is absent.
    const run = createRun("banker-none", { party: [commoner("nb")], difficultyId: "normal", gold: 200, storageCap: 8 });
    expect(hasBanker(run.party)).toBe(false);

    // Invest: refuses (nothing engaged) despite a non-empty purse.
    expect(bankerEngageInterest(run).applied).toBe(false);
    expect(run.overworld.interestPerStep).toBe(0);
    // Borrow: refuses, advancing no gold and no debt.
    const borrow = bankerBorrow(run, 40);
    expect(borrow.applied).toBe(false);
    expect(run.overworld.debt).toBe(0);
    expect(run.camp.gold).toBe(200);
    // Guard the Purse: refuses, spending nothing and engaging no protection.
    const protect = bankerProtect(run);
    expect(protect.applied).toBe(false);
    expect(run.overworld.protection).toBe(0);
    expect(run.camp.gold).toBe(200);

    // Field a Banker → the same verbs now work.
    run.party.push(banker());
    expect(hasBanker(run.party)).toBe(true);
    expect(bankerEngageInterest(run).applied).toBe(true);
    expect(bankerBorrow(run, 40).applied).toBe(true);
    expect(bankerProtect(run).applied).toBe(true);
  });
});

/** A commoner — a plain fighter, not the Noble job, so the party fields no Noble (D62). */
function commoner(seed: string): Unit {
  return createUnit({ id: `grunt-${seed}`, side: "player", pos: { col: -1, row: -1 }, jobId: "soldier", speed: 10, maxHp: 20, attack: 6, defense: 2, moveRange: 4, sightRadius: 4, intelligence: 0 });
}

describe("economy-actions — Noble INFLUENCE (per-expedition, D30/D62)", () => {
  it("a Noble in the party accrues passive Influence each node-step (Renown, declared D71/D72)", () => {
    const run = newRun("noble-passive"); // newRun's party fields a Noble (the standing-bearer)
    expect(hasNoble(run.party)).toBe(true);
    const before = run.overworld.influence;
    const gained = accrueDeclaredFaucets(run); // the Noble's Renown faucet, now read as data
    expect(gained).toBe(ECONOMY.noble.incomePerStep);
    expect(run.overworld.influence).toBe(before + gained);
  });

  it("no Noble in the party → no passive Influence (no free faucet)", () => {
    const run = createRun("noble-none", { party: [commoner("none")], difficultyId: "normal", gold: 100, storageCap: 8 });
    expect(hasNoble(run.party)).toBe(false);
    expect(declaredFaucetInfluence(run.party)).toBe(0);
    expect(accrueDeclaredFaucets(run)).toBe(0);
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
    accrueDeclaredFaucets(run);
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
    expect(bribePrice(highIntel)).toBeLessThan(bribePrice(lowIntel));

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
    expect(bribePrice(undefined, "renowned")).toBeLessThanOrEqual(bribePrice(undefined, "known"));
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
      if (!streamFor(run.seed, Labels.bribe(run.mapNodeId, `foe-${i}`)).chance(bribeChance("known"))) resistId = `foe-${i}`;
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

// --- The economy-verb effect handlers mirror their legacy verb cores (R4/A inc 5) -----------
//
// Each new OverworldActionEffect handler (dispatched via applyOverworldEffect) delegates to the
// SAME economy-actions core its legacy free-function verb runs, so the registry path and the
// verb produce identical state mutations. These pin that parity BEFORE increments 6–8 flip the
// legacy verbs onto SkillDefs — the handler path (the batch-3 projection's route) and the verb
// path never drift. The gate-owned spends (gold/fatigue via checkOverworldCost + use-XP) live in
// the verb / useOverworldSkill, not the pure effect core, so these compare only the effect state.

/** A Medic — the healing class (its job carries the Triage passive), for the Triage handler. */
function medicUnit(): Unit {
  return createUnit({ id: `medic-${nextId++}`, side: "player", pos: { col: -1, row: -1 }, jobId: "medic", speed: 9, maxHp: 20, attack: 4, defense: 2, moveRange: 3, sightRadius: 4 });
}

describe("economy-verb effect handlers mirror the legacy verb cores (R4/A inc 5)", () => {
  it("buy: the handler adds the good to storage exactly like merchantBuy's effect (gold rides the gate)", () => {
    const legacy = newRun("h-buy", 100);
    const viaHandler = newRun("h-buy", 100);
    const a = merchantBuy(legacy, "trap-kit", "poor");
    expect(a.applied).toBe(true);
    const res = applyOverworldEffect({ kind: "buy" }, { run: viaHandler, unit: viaHandler.party[0], opts: { materialId: "trap-kit", tier: "poor" } });
    expect(res.ok).toBe(true);
    expect(countOf(viaHandler.inventory, "trap-kit")).toBe(countOf(legacy.inventory, "trap-kit"));
  });

  it("sell: the handler credits the purse + removes one good exactly like merchantSell's effect", () => {
    const legacy = newRun("h-sell"); addItem(legacy.inventory, "valuables", 2);
    const viaHandler = newRun("h-sell"); addItem(viaHandler.inventory, "valuables", 2);
    const goldBefore = legacy.camp.gold;
    const a = merchantSell(legacy, "valuables");
    expect(a.applied).toBe(true);
    const res = applyOverworldEffect({ kind: "sell" }, { run: viaHandler, unit: viaHandler.party[0], opts: { materialId: "valuables" } });
    expect(res.ok).toBe(true);
    expect(viaHandler.camp.gold).toBe(legacy.camp.gold); // identical purse credit
    expect(viaHandler.camp.gold).toBeGreaterThan(goldBefore);
    expect(countOf(viaHandler.inventory, "valuables")).toBe(countOf(legacy.inventory, "valuables"));
  });

  it("borrow: the handler advances the purse + records the debt exactly like bankerBorrow's effect", () => {
    const legacy = newRun("h-borrow", 0);
    const viaHandler = newRun("h-borrow", 0);
    const a = bankerBorrow(legacy, 40);
    expect(a.applied).toBe(true);
    const res = applyOverworldEffect({ kind: "borrow" }, { run: viaHandler, unit: viaHandler.party[0], opts: { amount: 40 } });
    expect(res.ok).toBe(true);
    expect(viaHandler.camp.gold).toBe(legacy.camp.gold);
    expect(viaHandler.overworld.debt).toBe(legacy.overworld.debt);
    // a non-positive amount refuses (nothing to borrow), advancing nothing
    const zero = applyOverworldEffect({ kind: "borrow" }, { run: viaHandler, unit: viaHandler.party[0], opts: { amount: 0 } });
    expect(zero.ok).toBe(false);
  });

  it("engageInterest: the handler sets the per-step credit exactly like bankerEngageInterest's effect", () => {
    const legacy = newRun("h-interest", 100);
    const viaHandler = newRun("h-interest", 100);
    const a = bankerEngageInterest(legacy);
    expect(a.applied).toBe(true);
    const res = applyOverworldEffect({ kind: "engageInterest" }, { run: viaHandler, unit: viaHandler.party[0], opts: {} });
    expect(res.ok).toBe(true);
    expect(viaHandler.overworld.interestPerStep).toBe(legacy.overworld.interestPerStep);
    expect(viaHandler.overworld.interestPerStep).toBeGreaterThan(0);
  });

  it("guardPurse: the handler engages protection exactly like bankerProtect's effect (gold rides the gate)", () => {
    const legacy = newRun("h-guard", 200);
    const viaHandler = newRun("h-guard", 200);
    const a = bankerProtect(legacy);
    expect(a.applied).toBe(true);
    const res = applyOverworldEffect({ kind: "guardPurse" }, { run: viaHandler, unit: viaHandler.party[0], opts: {} });
    expect(res.ok).toBe(true);
    expect(viaHandler.overworld.protection).toBe(legacy.overworld.protection);
    expect(viaHandler.overworld.protection).toBeGreaterThan(0);
  });

  it("patronize: the handler credits Influence exactly like patronize's effect (gold rides the gate)", () => {
    const legacy = newRun("h-patron", 100);
    const viaHandler = newRun("h-patron", 100);
    const a = patronize(legacy);
    expect(a.applied).toBe(true);
    const res = applyOverworldEffect({ kind: "patronize" }, { run: viaHandler, unit: viaHandler.party[0], opts: {} });
    expect(res.ok).toBe(true);
    expect(viaHandler.overworld.influence).toBe(legacy.overworld.influence);
    expect(viaHandler.overworld.influence).toBe(ECONOMY.noble.patronizeYield);
  });

  it("triage (full-strength): the handler heals the most-wounded exactly like triage's effect (fatigue rides the gate)", () => {
    const legacy = newRun("h-triage"); const legacyDoc = medicUnit(); legacy.party.push(legacyDoc); legacy.party[0].hp = 1;
    const viaHandler = newRun("h-triage"); const handlerDoc = medicUnit(); viaHandler.party.push(handlerDoc); viaHandler.party[0].hp = 1;
    const a = triage(legacy, legacyDoc);
    expect(a.applied).toBe(true);
    expect(a.healed!).toBeGreaterThan(0);
    const res = applyOverworldEffect({ kind: "triage", base: 6 }, { run: viaHandler, unit: handlerDoc, opts: {} });
    expect(res.ok).toBe(true);
    expect(viaHandler.party[0].hp).toBe(legacy.party[0].hp); // identical heal
  });

  it("triage (universal fallback): a NON-Medic heals ONE rest-chunk — half the chunks per RP (the named change)", () => {
    // The ratified ruling: a Medic-less party can triage via the universal fallback, healing one
    // chunk per cast funded by RP at 2× a normal rest's rpPerChunk (pinned in full via useOverworldSkill
    // in the increment-8 test). Here the effect core heals exactly one chunk, no Triage-passive scaling.
    const run = newRun("h-triage-fallback");
    const grunt = fighter("Plain"); // a plain fighter — not a healer
    run.party.push(grunt);
    const wounded = run.party[0]; wounded.hp = 1;
    const chunk = chunkHp(wounded);
    const res = applyOverworldEffect({ kind: "triage", base: 6, fallback: true }, { run, unit: grunt, opts: {} });
    expect(res.ok).toBe(true);
    expect(wounded.hp).toBe(1 + chunk); // exactly one rest-chunk, NOT the full-strength base+scaling
  });
});

// --- The universal overworld home + the ONE named behavior change (R4/A inc 8) --------------
describe("UNIVERSAL_OVERWORLD_SKILLS — buy + the Medic-less Triage fallback (R4/A inc 8)", () => {
  /** A commoner-only (Medic-less) run — the fallback's whole reason to exist. */
  function medicLessRun(seed: string, gold = 200): RunState {
    return createRun(seed, { party: [fighter("Rook"), fighter("Bram")], difficultyId: "normal", gold, storageCap: 8 });
  }

  it("both universal verbs surface for EVERY unit through availableSkills, regardless of class", () => {
    const run = medicLessRun("uni-surface");
    for (const u of run.party) {
      const ids = availableSkills(u, "overworld").map((s) => s.id);
      expect(ids).toContain("merchant-buy"); // Buy is job-ungated (M8)
      expect(ids).toContain("triage-fallback"); // the Medic-less camp heal
    }
    // The FULL-strength Triage is capability-gated to a healer — a commoner does NOT surface it.
    expect(availableSkills(run.party[0], "overworld").map((s) => s.id)).not.toContain("triage");
    expect(UNIVERSAL_BUY.effect.kind).toBe("buy");
  });

  it("a Medic surfaces the full-strength Triage (requires healer); the fallback still surfaces too", () => {
    const run = createRun("uni-medic", { party: [medicUnit()], difficultyId: "normal", gold: 100, storageCap: 8 });
    const ids = availableSkills(run.party[0], "overworld").map((s) => s.id);
    expect(ids).toContain("triage"); // MEDIC_TRIAGE — capability gate passes
    expect(MEDIC_TRIAGE.requires).toBe("healer");
  });

  it("THE NAMED BEHAVIOR CHANGE: a Medic-less party's Triage fallback heals HALF the chunks per RP", () => {
    // Ratified ruling #1: the universal fallback converts RP at 2× a normal rest's rpPerChunk —
    // one rest-chunk per cast, funded from Rest Points, no Medic + no Triage-passive scaling. TUNABLE.
    const run = medicLessRun("uni-fallback-pin");
    const policy = runDifficulty(run);
    const wounded = run.party[0];
    wounded.hp = 1;
    const chunk = chunkHp(wounded);
    run.rp = 100; // plenty of RP to fund the chunk

    const rpBefore = run.rp;
    const res = useOverworldSkill(run, run.party[1], TRIAGE_FALLBACK); // a commoner casts it (no healer needed)
    expect(res.applied).toBe(true);
    const rpSpent = rpBefore - run.rp;
    const healed = wounded.hp - 1;

    // The pin: one chunk healed, funded at 2× rpPerChunk — half the chunks per RP vs a normal rest.
    expect(healed).toBe(chunk);
    expect(rpSpent).toBe(2 * policy.rpPerChunk);
    // Contrast: a normal rest-heal buys the SAME chunk for HALF the RP.
    const normal = restHeal({ ...wounded, hp: 1 } as typeof wounded, 100, policy);
    expect(normal.chunks).toBeGreaterThanOrEqual(1);
    expect(rpSpent / healed).toBe(2 * (policy.rpPerChunk / chunk)); // exactly twice the RP-per-HP of a rest
  });

  it("the fallback refuses (standard-shaped) when the party lacks the Rest Points", () => {
    const run = medicLessRun("uni-fallback-broke");
    run.party[0].hp = 1;
    run.rp = 0; // no Rest Points banked
    const res = useOverworldSkill(run, run.party[1], TRIAGE_FALLBACK);
    expect(res.applied).toBe(false);
    expect(res.reason).toMatch(/Rest Points/i);
    expect(run.party[0].hp).toBe(1); // nothing healed
  });
});
