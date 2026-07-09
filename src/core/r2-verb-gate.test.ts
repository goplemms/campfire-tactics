/**
 * R2 verb-gate closure — **characterization witnesses** (increment 0, #125/#126/#112).
 *
 * These tests pin TODAY'S behaviors before the R2 refactor touches them, so each
 * later increment flips (or retires) exactly the witness it named and nothing else:
 *
 * - (a) A **captured** Cook is still offered the stew choice — the node-events Cook
 *   check forgot `!u.captured` (the audit's real inconsistency). **Flips at
 *   increment 2** (the one named behavior change of this brief).
 * - (b) `bankerBorrow` / `bankerEngageInterest` succeed **back-to-back with no
 *   refusal** — neither routes through the D61 cost gate (no pacing, no price;
 *   Borrow is an unbounded gold advance). **Flips at increment 7.**
 * - (c) The **CostKnob re-resolution trap** (`overworld-actions.ts`'s documented
 *   check→commit drift bomb): `commitOverworldCost` re-resolves gold knobs **after**
 *   the effect, so an effect that moves party composition mid-verb commits a price
 *   different from the one checked. No shipped effect moves composition today (the
 *   registered overworld effects are openMarket / primeDeal / provisionMeal / survey
 *   / forage — none touch the roster), so the witness assembles the check→commit
 *   sandwich exactly as the six production call sites do, around a fixture effect
 *   that does. **Flips/retires at increment 5** (prices captured at check time).
 *
 * Sim digest reference (`npm run sim` at the R1-landed baseline, 2026-07-08 —
 * 1044 tests / 97 files green):
 *
 *   procedural / normal (80 runs)
 *   completed 3 (4%) · lost 77 · stalled 0 · crashed 0
 *   median nights 6 · median gold earned 215 · permadeaths/run 0.00
 *   encounters: win 195 · obj-fail 0 · wipe 77
 *   ended at layer: L4:9 L5:16 L6:55
 *   Hollow Mill (authored): complete — ended finale (L7)
 *   Hollow Mill traps: staged 8 · spotted 0 · sprung 5 · disarmed 0 · salvaged 0
 */

import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import { createRun, type RunState } from "./run";
import type { JobId } from "./jobs";
import { getEvent } from "./node-events";
import type { MapNode } from "./overworld";
import { bankerBorrow, bankerEngageInterest } from "./economy-actions";
import {
  checkOverworldCost,
  commitOverworldCost,
  resolveKnob,
  type OverworldCost,
} from "./overworld-actions";

let nextId = 0;
function member(name: string, jobId: JobId): Unit {
  return createUnit({
    id: `${name}-${nextId++}`,
    side: "player",
    pos: { col: -1, row: -1 },
    name,
    jobId,
    speed: 11,
    maxHp: 28,
    attack: 9,
    defense: 3,
    moveRange: 4,
    sightRadius: 5,
  });
}

function newRun(seed: string, party: Unit[], gold = 200): RunState {
  return createRun(seed, { party, difficultyId: "normal", gold });
}

// --- Witness (a): the captured-Cook stew offer (flips at increment 2) --------

describe("R2 witness (a) — a captured Cook IS offered the stew choice today", () => {
  it("provision-choice offers cook-stew even when the only Cook is captured", () => {
    const cook = member("Pip", "cook");
    cook.captured = true; // bound on the map — but the Cook check forgot `!u.captured`
    const run = newRun("r2-w-a", [member("Rook", "soldier"), cook]);
    const node: MapNode = { id: "n2-0", layer: 2, index: 0, kind: "event", edges: [] };

    const choices = getEvent("provision-choice").choices!(run, node);
    // TODAY: the captured Cook still offers to cook the stew — the check reads only
    // `primaryJobOf(u) === "cook" && u.alive`, missing `!u.captured`. Increment 2
    // migrates it onto `fieldsJob` and this expectation flips to false.
    expect(choices.some((c) => c.id === "cook-stew")).toBe(true);
  });

  it("(control) an un-captured Cook is offered it, and no Cook at all is not", () => {
    const node: MapNode = { id: "n2-0", layer: 2, index: 0, kind: "event", edges: [] };
    const withCook = newRun("r2-w-a2", [member("Rook", "soldier"), member("Pip", "cook")]);
    expect(getEvent("provision-choice").choices!(withCook, node).some((c) => c.id === "cook-stew")).toBe(true);
    const noCook = newRun("r2-w-a3", [member("Rook", "soldier")]);
    expect(getEvent("provision-choice").choices!(noCook, node).some((c) => c.id === "cook-stew")).toBe(false);
  });
});

// --- Witness (b): the ungated Banker verbs (flips at increment 7) ------------

describe("R2 witness (b) — bankerBorrow / bankerEngageInterest are ungated today", () => {
  it("bankerBorrow succeeds back-to-back with no refusal (no pacing, no price)", () => {
    const run = newRun("r2-w-b", [member("Vault", "banker")], 50);
    const first = bankerBorrow(run, 40);
    expect(first.applied).toBe(true);
    expect(first.borrowed).toBe(40);
    // TODAY: an immediate second loan is granted without refusal — Borrow never
    // opted into the D61 gate. Increment 7 gives it `{ usesPerNode: 1 }` and the
    // second call refuses.
    const second = bankerBorrow(run, 40);
    expect(second.applied).toBe(true);
    expect(second.borrowed).toBe(40);
    expect(run.overworld.debt).toBe(80);
    expect(run.camp.gold).toBe(50 + 80);
  });

  it("bankerEngageInterest re-engages back-to-back with no refusal", () => {
    const run = newRun("r2-w-b2", [member("Vault", "banker")], 100);
    const first = bankerEngageInterest(run);
    expect(first).toBeGreaterThan(0);
    // TODAY: engaging again immediately just recomputes and re-arms — no pacing.
    // Increment 7 gives it `{ usesPerNode: 1 }` and the second call refuses.
    const second = bankerEngageInterest(run);
    expect(second).toBeGreaterThan(0);
    expect(run.overworld.interestPerStep).toBe(second);
  });
});

// --- Witness (c): the CostKnob re-resolution trap (flips at increment 5) -----

describe("R2 witness (c) — commit re-resolves a gold CostKnob AFTER the effect", () => {
  it("an effect that moves party composition mid-verb commits a different price than was checked", () => {
    const PRICE_PER_FIELDED = 10;
    const party = [member("Rook", "soldier"), member("Vale", "scout"), member("Bram", "hunter")];
    const run = newRun("r2-w-c", party, 100);

    // A gated fixture verb priced per fielded member — the CostKnob-provider shape
    // overworld-actions.ts:~53-58 documents as the trap ("key it off composition the
    // effect doesn't move"). This fixture deliberately violates that contract to pin
    // what happens when the first composition-moving effect meets the gate.
    const cost: OverworldCost = {
      gold: (r) => PRICE_PER_FIELDED * r.party.filter((u) => u.alive && !u.captured).length,
    };

    // The hand-assembled check→commit sandwich, exactly as the six production call
    // sites (useOverworldSkill ×2, triage, merchantBuy, bankerProtect, patronize) do it.
    const checkedPrice = resolveKnob(cost.gold, run);
    expect(checkedPrice).toBe(30); // 3 fielded members at check time
    const check = checkOverworldCost(run, "r2-fixture-verb", cost, "Fixture Verb");
    expect(check.ok).toBe(true);

    // The effect applies between check and commit — and captures a member.
    run.party[2].captured = true;

    const before = run.camp.gold;
    if (check.ok) commitOverworldCost(run, "r2-fixture-verb", cost, check.fatigueSpend);
    const committedPrice = before - run.camp.gold;

    // TODAY: the commit re-resolves the knob against the post-effect run — the purse
    // is charged 20g (2 fielded), NOT the 30g the check gated on. This is the drift
    // bomb increment 5 defuses (prices captured at check time); when it lands, the
    // committed price becomes 30 and this pin is flipped/retired with it.
    expect(committedPrice).toBe(20);
    expect(committedPrice).not.toBe(checkedPrice);
  });
});
