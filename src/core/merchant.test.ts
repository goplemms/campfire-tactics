import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import { createRun, currentNode, type RunState } from "./run";
import { useOverworldSkill, DEAL_PRIMED_FLAG } from "./overworld-actions";
import { isPrimed } from "./overworld-state";
import { availableSkills } from "./leveling";
import { effectiveMarketTier, type MapNode } from "./overworld";
import { merchantBuy, merchantSell, sellPrice, merchantPrice, ECONOMY } from "./economy-actions";
import { FIND_TRADE, SAVVY_BARTER } from "./jobs-data/support";
import { addItem, getMaterial } from "./inventory";

// D70 — the Merchant kit (the first non-combat verb-kit), consuming the D72 substrate:
// Appraisal (presence), Find Trade (openMarket), Savvy Barter (primeDeal → buy/sell).

const merchant = (): Unit =>
  createUnit({ id: "Coin", side: "player", pos: { col: -1, row: -1 }, jobId: "merchant", speed: 8, maxHp: 16, attack: 2, defense: 1, moveRange: 3, sightRadius: 4 });
const newRun = (seed: string, gold = 200): RunState =>
  createRun(seed, { party: [merchant()], difficultyId: "normal", gold, storageCap: 8 });

describe("Merchant kit (D70) — the trade-broker", () => {
  it("surfaces its two overworld verbs via the one projection (the non-combat 2+1)", () => {
    const ids = availableSkills(merchant(), "overworld").map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["find-trade", "savvy-barter"]));
  });

  it("Appraisal (presence) lifts an existing market a tier; never conjures one on a barren node", () => {
    const town: MapNode = { id: "t", layer: 1, index: 0, kind: "rest", market: "basic", edges: [] };
    const barren: MapNode = { id: "b", layer: 1, index: 0, kind: "combat", market: "none", edges: [] };
    expect(effectiveMarketTier(town, [merchant()])).toBe("premium"); // basic +1
    expect(effectiveMarketTier(barren, [merchant()])).toBe("none"); // not conjured (that's Find Trade)
  });

  it("Find Trade opens an impromptu poor market at a barren node for this node-step (paid access)", () => {
    const run = newRun("find");
    const here = (): MapNode => ({ id: run.mapNodeId, layer: 0, index: 0, kind: "combat", market: "none", edges: [] });
    expect(effectiveMarketTier(here(), run.party, run.overworld)).toBe("none");
    const res = useOverworldSkill(run, run.party[0], FIND_TRADE);
    expect(res.applied).toBe(true);
    // The conjured market is poor — Appraisal does NOT lift it to basic (D70 ordering).
    expect(effectiveMarketTier(here(), run.party, run.overworld)).toBe("poor");
  });

  it("Savvy Barter halves the next buy, then is spent (one deal)", () => {
    const run = newRun("barter-buy");
    useOverworldSkill(run, run.party[0], SAVVY_BARTER);
    expect(isPrimed(run.overworld, DEAL_PRIMED_FLAG)).toBe(true);
    const full = merchantPrice("basic");
    const first = merchantBuy(run, "trap-kit", "basic");
    expect(first.applied).toBe(true);
    expect(first.price).toBe(Math.ceil(full * ECONOMY.merchant.savvyBuyFactor)); // half off
    expect(isPrimed(run.overworld, DEAL_PRIMED_FLAG)).toBe(false); // consumed
    // The prime is spent — a second buy pays full price.
    expect(merchantBuy(run, "trap-kit", "basic").price).toBe(full);
  });

  it("Savvy Barter fetches +25% on the next sale, then is spent", () => {
    const run = newRun("barter-sell");
    addItem(run.inventory, "valuables", 2);
    const tier = effectiveMarketTier(currentNode(run), run.party, run.overworld);
    const base = sellPrice(getMaterial("valuables")!, tier);
    useOverworldSkill(run, run.party[0], SAVVY_BARTER);
    const first = merchantSell(run, "valuables");
    expect(first.applied).toBe(true);
    expect(first.earned).toBe(Math.floor(base * ECONOMY.merchant.savvySellFactor));
    // Spent — the second sale fetches the plain price.
    expect(merchantSell(run, "valuables").earned).toBe(base);
  });
});
