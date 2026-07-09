/**
 * R4 (#112/#113/#123) — characterization safety net for the verb substrate build.
 *
 * Batch 1 (the cost grammar + phase retirement) leans on three references pinned here
 * at increment 0, **before** any substrate change:
 *
 *  - (a) **The camp-verb board** — for a fixed seed at a prep-camp beat, exactly which
 *    overworld/camp verbs each party member is offered, and the refuse-with-reason for
 *    the rest, derived **purely from core state** (`availableSkills` × `checkOverworldCost`,
 *    no Phaser). This is **batch 3's parity reference**: when `availableActions(run)` folds
 *    these into one projection the OverworldScene renders, this board is what it must match.
 *  - (b) **The agreement WITNESS** — `battle-flow.noActionsAvailable` reads
 *    `unlockedSkills(actor, "battle")` (job battle-skills only), while the surfacing
 *    projection is `availableSkills(actor, "combat")` (job skills **+ the universals** +
 *    the capability gate). These **disagree today** for a unit whose only combat option is
 *    a universal (Defend): a boxed-in noncombat unit is auto-passed even though it could
 *    Defend. Increment 4 flips battle-flow to `availableSkills` and this witness flips with it.
 *  - (c) **The sim digest reference** (below) — batch 1 must keep `npm run sim` byte-identical
 *    to this (no named deltas in batch 1). Recorded at increment 0 (2026-07-09), 1052 tests:
 *
 *      ── procedural / normal (80 runs) ──
 *        completed 3 (4%) · lost 77 · stalled 0 · crashed 0
 *        median nights 6 · median gold earned 215 · permadeaths/run 0.00
 *        encounters: win 195 · obj-fail 0 · wipe 77
 *        ended at layer: L4:9 L5:16 L6:55
 *        levers engaged: goldPressure 100% · skippedFood 0% · tookCaptureRisk 0% ·
 *          moraleMoved 100% · leveled 49% · restedInPlace 0% · storagePressure 56% · feltTraps 0%
 *        enemy traps: staged 0 · spotted 0 · sprung 0 · disarmed 0 · salvaged 0
 *        Hollow Mill (authored): complete — ended finale (L7)
 *        Hollow Mill traps: staged 8 · spotted 0 · sprung 5 · disarmed 0 · salvaged 0
 *
 * Pure logic: no Phaser, no DOM.
 */
import { describe, it, expect } from "vitest";
import { createRun, type RunState } from "./run";
import { createUnit, type Unit } from "./units";
import type { JobId } from "./jobs";
import { availableSkills } from "./leveling";
import { unitSkills } from "./jobs";
import { overworldCostOf, checkOverworldCost } from "./overworld-cost";
import { noActionsAvailable } from "./battle-flow";
import { TileGrid } from "./grid";
import { EntityRegistry } from "./entities";
import { EventBus } from "./event-bus";

function jobUnit(id: string, jobId: JobId, over: Partial<Parameters<typeof createUnit>[0]> = {}): Unit {
  return createUnit({
    id,
    name: id,
    side: "player",
    pos: { col: 0, row: 0 },
    awareness: 2,
    speed: 10,
    maxHp: 20,
    attack: 5,
    defense: 1,
    moveRange: 3,
    sightRadius: 4,
    jobId,
    ...over,
  });
}

/**
 * The camp-verb board **from core state** (batch-3 parity reference): every overworld/camp
 * skill each party member surfaces, with its gate verdict — offered, or refused-with-reason —
 * exactly as `availableActions(run)` will have to report it once it folds these in.
 */
function campVerbBoard(run: RunState): string[] {
  const lines: string[] = [];
  for (const u of run.party) {
    for (const skill of availableSkills(u, "overworld")) {
      const cost = overworldCostOf(skill);
      const check = checkOverworldCost(run, skill.id, cost, skill.name, u);
      lines.push(`${u.name} · ${skill.name}: ${check.ok ? "offered" : `refused — ${check.reason}`}`);
    }
  }
  return lines;
}

describe("R4 increment 0(a) — the camp-verb board (batch-3 parity reference)", () => {
  it("pins, from core state, which verbs each member is offered at a fresh prep-camp beat", () => {
    const run = createRun("r4-camp-board", {
      party: [
        jobUnit("Wynn", "cook"),
        jobUnit("Pia", "merchant"),
        jobUnit("Vale", "survivalist"),
        jobUnit("Rook", "soldier"),
      ],
      gold: 40,
    });
    expect(campVerbBoard(run)).toMatchInlineSnapshot(`
      [
        "Wynn · Cook Stew: offered",
        "Wynn · Feast: offered",
        "Pia · Find Trade: offered",
        "Pia · Savvy Barter: offered",
        "Pia · Merchant Sell: offered",
        "Vale · Forage: offered",
      ]
    `);
  });

  it("the board is deterministic for a fixed seed + party", () => {
    const mk = () =>
      createRun("r4-camp-board", {
        party: [jobUnit("Wynn", "cook"), jobUnit("Pia", "merchant")],
        gold: 40,
      });
    expect(campVerbBoard(mk())).toEqual(campVerbBoard(mk()));
  });
});

describe("R4 increment 0(b) — the agreement WITNESS, now FLIPPED authoritative (increment 4, #123)", () => {
  const reg = () => new EntityRegistry(new EventBus());

  it("the divergence source: the universal Defend lives only in the availableSkills projection", () => {
    // A Cook holds no combat *job* skill, so the raw job set has none of them…
    const cook = jobUnit("Wynn", "cook");
    expect(unitSkills(cook).filter((s) => s.effect.kind === "damage")).toEqual([]);
    // …but the authoritative surfacing projection folds in the universal Defend, so it is non-empty.
    // (This is exactly what the retired unlockedSkills('battle') read missed, plus the `requires`
    // capability gate — no shipping skill declares `requires`, so the universals are the witness.)
    expect(availableSkills(cook, "combat").map((s) => s.id)).toEqual(["defend"]);
  });

  it("POST-FLIP behavior: the D55 backstop no longer auto-passes a unit that could Defend", () => {
    // A 1×1 grid pins the Cook; no foes, no entities, no guild. battle-flow now reads
    // availableSkills('combat') (which offers the universal Defend), so the backstop correctly
    // reports the unit HAS an action — the flip fixed the latent bug the increment-0 witness pinned.
    const g = new TileGrid(1, 1);
    const cook = jobUnit("Wynn", "cook", { pos: { col: 0, row: 0 }, moveRange: 0 });
    expect(noActionsAvailable({ actor: cook, units: [cook], grid: g, entities: reg(), hasGuild: false })).toBe(false);
  });
});
