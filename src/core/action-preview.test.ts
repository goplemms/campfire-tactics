/**
 * D58 — golden characterization for the overworld action-effect previews.
 *
 * Pins the exact projected changes each camp/overworld action reports on hover, for a
 * fixed party + purse. It's the guard on the projection kernel: if a skill's cost/effect
 * moves, or an ECONOMY/upkeep knob changes, the snapshot diverges and we re-bless it on
 * purpose — never by accident. Also pins that Recon previews its **overworld face** (the
 * intel bump), not its combat dart — the `overworldEffect ?? effect` seam the resolver uses.
 *
 * Pure logic: no Phaser, no DOM.
 */
import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import { createRun, type RunState } from "./run";
import { COOK_STEW, FEAST, FIND_TRADE, SAVVY_BARTER, FORAGE, RECON, type JobId } from "./jobs";
import {
  skillEffectPreview,
  triageActionPreview,
  inPlaceRestPreview,
  bankerInterestPreview,
  bankerBorrowPreview,
  bankerProtectPreview,
  patronizePreview,
} from "./action-preview";

let nextId = 0;
function member(jobId: JobId, name: string): Unit {
  return createUnit({
    id: `${name}-${nextId++}`, side: "player", pos: { col: -1, row: -1 }, name,
    jobId, speed: 8, maxHp: 20, attack: 4, defense: 2, moveRange: 3, sightRadius: 4,
  });
}

/** A fixed run — a Cook (so Cook Stew's food-priced cost resolves) beside a soldier, purse 200. */
function fixedRun(): RunState {
  nextId = 0;
  return createRun("preview-golden", {
    party: [member("soldier", "Rook"), member("cook", "Pip")],
    difficultyId: "normal",
    gold: 200,
    storageCap: 8,
  });
}

describe("D58 — action-effect preview projection (golden)", () => {
  it("pins the projected changes for every camp/overworld action", () => {
    const run = fixedRun();
    const previews = {
      cookStew: skillEffectPreview(COOK_STEW, run),
      feast: skillEffectPreview(FEAST, run),
      findTrade: skillEffectPreview(FIND_TRADE, run),
      savvyBarter: skillEffectPreview(SAVVY_BARTER, run),
      recon: skillEffectPreview(RECON, run),
      forage: skillEffectPreview(FORAGE, run),
      triage: triageActionPreview(),
      inPlaceRest: inPlaceRestPreview(run),
      bankerInterest: bankerInterestPreview(run),
      bankerBorrow: bankerBorrowPreview(40),
      bankerProtect: bankerProtectPreview(),
      patronize: patronizePreview(),
    };
    expect(previews).toMatchInlineSnapshot(`
      {
        "bankerBorrow": [
          {
            "amount": 40,
            "label": "Purse",
            "stat": "purse",
          },
          {
            "amount": 40,
            "good": false,
            "label": "Debt",
          },
        ],
        "bankerInterest": [
          {
            "good": true,
            "label": "Interest",
            "text": "+20g/step",
          },
        ],
        "bankerProtect": [
          {
            "amount": -25,
            "label": "Purse",
            "stat": "purse",
          },
          {
            "good": true,
            "label": "Protection",
            "text": "50%",
          },
        ],
        "cookStew": [
          {
            "amount": -2,
            "label": "Purse",
            "stat": "purse",
          },
          {
            "amount": 14,
            "label": "Rest Pts",
            "stat": "rp",
          },
          {
            "good": true,
            "label": "Food",
            "text": "covered tonight",
          },
        ],
        "feast": [
          {
            "amount": -20,
            "label": "Purse",
            "stat": "purse",
          },
          {
            "amount": 2,
            "label": "Morale",
            "stat": "morale",
          },
        ],
        "findTrade": [
          {
            "good": true,
            "label": "Market",
            "text": "opens here",
          },
        ],
        "forage": [
          {
            "amount": 2,
            "good": false,
            "label": "Fatigue",
          },
          {
            "good": true,
            "label": "Forage",
            "text": "gather materials",
          },
        ],
        "inPlaceRest": [
          {
            "amount": -4,
            "label": "Purse",
            "stat": "purse",
          },
          {
            "amount": 1,
            "label": "Rest Pts",
            "stat": "rp",
          },
          {
            "good": true,
            "label": "HP",
            "text": "small heal",
          },
        ],
        "patronize": [
          {
            "amount": -12,
            "label": "Purse",
            "stat": "purse",
          },
          {
            "amount": 3,
            "good": true,
            "label": "Influence",
          },
        ],
        "recon": [
          {
            "amount": 1,
            "good": false,
            "label": "Fatigue",
          },
          {
            "good": true,
            "label": "Intel",
            "text": "+1 tier",
          },
        ],
        "savvyBarter": [
          {
            "good": true,
            "label": "Next deal",
            "text": "primed",
          },
        ],
        "triage": [
          {
            "good": true,
            "label": "HP",
            "text": "heals worst wound",
          },
          {
            "amount": 2,
            "good": false,
            "label": "Fatigue",
          },
        ],
      }
    `);
  });

  it("previews Recon's overworld face (the intel bump), not its combat dart", () => {
    const recon = skillEffectPreview(RECON, fixedRun());
    // The bug this guards: reading `skill.effect` (the combat `status` dart) instead of
    // `overworldEffect ?? effect` would drop the intel change entirely.
    expect(recon.some((c) => c.label === "Intel")).toBe(true);
    expect(recon.some((c) => c.text === "swift")).toBe(false);
  });

  it("is deterministic — the same run projects identically", () => {
    expect(skillEffectPreview(COOK_STEW, fixedRun())).toEqual(skillEffectPreview(COOK_STEW, fixedRun()));
  });
});
