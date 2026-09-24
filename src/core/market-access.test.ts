/**
 * Market access — ONE reader for "what tier does the caravan trade at here", shared by the
 * core verbs and the scenes (the 2026-09 design map, bug 2).
 *
 * `effectiveMarketTier` folds three things: the node's innate market, a fielded Merchant's
 * Appraisal lift, and the per-node **Find Trade** flag (D70) that lives on `run.overworld`.
 * The scene's Market button, buy loop and market view called it *without* the overworld
 * state, so a market the Merchant paid a turn to open never showed a button — while the
 * core-side sell path (which did pass it) happily traded there. `marketTierHere(run)` is the
 * one spelling that can't forget the flag; the grep guard keeps every other reader on it.
 *
 * Pure logic: no Phaser, no DOM.
 */
import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import { createRun, currentNode } from "./run";
import { marketOpenedFlag } from "./overworld";
import { setNodeFlag } from "./overworld-state";
import { marketTierHere } from "./economy-actions";

function party(): Unit[] {
  // No Merchant aboard: Appraisal stays out of the picture, so only the flag can lift the tier.
  return [
    createUnit({ id: "Rook", side: "player", pos: { col: 0, row: 1 }, jobId: "soldier", speed: 12, maxHp: 30, attack: 9, defense: 3, moveRange: 4, sightRadius: 5 }),
  ];
}

describe("market access — marketTierHere is the one reader (design-map bug 2)", () => {
  it("folds the Find Trade flag: a barren node trades at `poor` once the market is opened here", () => {
    const run = createRun("market-here", { party: party(), difficultyId: "normal", gold: 100, storageCap: 6 });
    const node = currentNode(run);
    node.market = "none";
    expect(marketTierHere(run)).toBe("none");
    setNodeFlag(run.overworld, marketOpenedFlag(node.id));
    expect(marketTierHere(run)).toBe("poor");
    // The explicit-node form (the scene's `campNode`) reads the same state.
    expect(marketTierHere(run, node)).toBe("poor");
  });

  it("grep: effectiveMarketTier is called only from its two homes — every other reader rides marketTierHere", () => {
    // Raw sources over core AND game (the rng-labels guard's idiom): the scene layer is exactly
    // where the flag-less call hid.
    const sources = {
      ...import.meta.glob("./**/*.ts", { eager: true, query: "?raw", import: "default" }),
      ...import.meta.glob("../game/**/*.ts", { eager: true, query: "?raw", import: "default" }),
    } as Record<string, string>;
    const homes = new Set(["./overworld.ts", "./economy-actions.ts"]);
    const offenders: string[] = [];
    let sites = 0;
    for (const [path, src] of Object.entries(sources)) {
      if (path.endsWith(".test.ts")) continue;
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      const call = /effectiveMarketTier\(/g;
      for (let m = call.exec(code); m !== null; m = call.exec(code)) {
        sites++;
        if (!homes.has(path)) offenders.push(path);
      }
    }
    expect(sites).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});
