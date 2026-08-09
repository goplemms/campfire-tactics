import { describe, it, expect } from "vitest";
import { createUnit, type Unit, type UnitSpec } from "./units";
import { createRun, createRunFromExpedition, type RunState } from "./run";
import { RunLoop } from "./runloop";
import { registerExpedition, type AuthoredExpedition } from "./expedition";
// `THE_HOLLOW_MILL` left with the shipped-E1 regression pin when it moved to
// `content/hollow-mill-expedition.test.ts` (D122); the synthetic expeditions below are this
// file's own fixtures and need no authored-body catalog.
import { freeCaptive, captureUnit } from "./deployment";
import type { AuthoredEncounter } from "./authored";
import type { OverworldMap, MapNode } from "./overworld";
import { canCallExfil, callExfil, heldTheField } from "./staging";

/**
 * **Exfil semantics, the "Go now" call, and the left-behind consequence (D120).**
 *
 * This file is the guard for the riskiest change on the finale track: it narrows **shipped
 * resolution semantics for every encounter**, not just the finale. So the first block is a
 * pure **regression** block — it pins the behaviour that must NOT move — and it is deliberately
 * written to be *specific*: each case fails only if its own clause breaks.
 *
 * The rule under test (D120, restated):
 *
 * > **Field control frees everyone** (D21, unchanged): a win with no active enemy left
 * > auto-frees every captured player unit and recruits every declared captive.
 * > **Without field control, POSITION decides** — and position is computed exactly once, by
 * > {@link callExfil}, which stamps `captured` on every off-exfil member of the exfil cohort.
 * > Everything downstream reads `captured` only.
 *
 * Pure logic: no Phaser, no DOM, no `Math.random`.
 */

const STATS = { speed: 10, maxHp: 24, attack: 9, defense: 2, moveRange: 4, sightRadius: 5, attackRange: 1 };

function spec(id: string, side: "player" | "enemy", col: number, row: number, extra: Partial<UnitSpec> = {}): UnitSpec {
  return { id, name: id, side, pos: { col, row }, ...STATS, ...extra };
}

/** The exfil mouth of the synthetic prison — the right-hand column. */
const EXIT = [{ col: 7, row: 0 }, { col: 7, row: 1 }];

/**
 * A synthetic prison shaped like the finale: a dual-OR (`eliminate-all` **or** `extraction`)
 * encounter with two `role: "prisoner"` captives and a live garrison. Built in-core (no
 * content-JSON dependency) so the resolution rules are tested against the *shape*, not one map.
 */
function prison(): AuthoredEncounter {
  return {
    id: "synthetic-prison",
    name: "Synthetic Prison",
    cols: 8,
    rows: 3,
    blocked: [],
    playerSpawns: [{ col: 0, row: 0 }, { col: 0, row: 1 }, { col: 0, row: 2 }],
    enemies: [
      { templateId: "bandit-thug", pos: { col: 4, row: 0 }, id: "guard-a" },
      { templateId: "bandit-thug", pos: { col: 4, row: 2 }, id: "guard-b" },
    ],
    captives: [
      { spec: spec("wisp", "player", 1, 0, { role: "prisoner" }), pos: { col: 1, row: 0 }, release: { kind: "lockpick" } },
      { spec: spec("bram", "player", 1, 2, { role: "prisoner" }), pos: { col: 1, row: 2 }, release: { kind: "lockpick" } },
    ],
    objectives: [
      { id: "storm", kind: "eliminate-all", required: true, label: "Clear the garrison" },
      { id: "extract", kind: "extraction", required: true, label: "Walk the prisoners out", span: EXIT, escort: { role: "prisoner" } },
    ],
    reward: { gold: 100, materials: [], xp: 40 },
  };
}

/** A plain elimination encounter that carries a captive but **no** exfil objective (the E1 shape). */
function plainCamp(): AuthoredEncounter {
  return {
    id: "synthetic-camp",
    name: "Synthetic Camp",
    cols: 8,
    rows: 3,
    blocked: [],
    playerSpawns: [{ col: 0, row: 0 }, { col: 0, row: 1 }, { col: 0, row: 2 }],
    enemies: [{ templateId: "bandit-thug", pos: { col: 4, row: 0 }, id: "guard-a" }],
    captives: [{ spec: spec("cook", "player", 6, 0), pos: { col: 6, row: 0 } }],
    objectives: [],
    reward: { gold: 100, materials: [], xp: 40 },
  };
}

function oneNodeMap(authoredId: string): OverworldMap {
  const nodes: Record<string, MapNode> = {
    start: { id: "start", layer: 0, index: 0, kind: "rest", edges: ["fight"] },
    fight: { id: "fight", layer: 1, index: 0, kind: "combat", edges: [], authoredId },
  };
  return { seed: "exfil", layers: 2, nodes, startId: "start", finalIds: ["fight"], order: ["start", "fight"] };
}

const PARTY: UnitSpec[] = [
  spec("cinder", "player", 0, 0, { jobId: "soldier", primaryJob: "soldier", isLord: true }),
  spec("nyx", "player", 0, 1, { jobId: "thief", primaryJob: "thief" }),
];

let expeditionSeq = 0;
/** A one-fight run sitting on `enc`, already positioned and staged. */
function stagedRun(enc: AuthoredEncounter): RunLoop {
  const id = `exfil-fixture-${expeditionSeq++}`;
  const exp: AuthoredExpedition = registerExpedition({
    id,
    name: id,
    seed: "exfil",
    map: oneNodeMap(enc.id),
    encounters: { [enc.id]: enc },
    bundle: { party: PARTY, purse: 100, supplies: {}, storageCap: 6, morale: 2, difficultyId: "normal" },
  });
  const loop = new RunLoop(createRunFromExpedition(exp));
  loop.choose("fight");
  loop.startEncounter();
  loop.beginBattle();
  return loop;
}

/** Every enemy down — the field is held. */
function clearTheField(loop: RunLoop): void {
  for (const u of loop.staged!.battle.units) if (u.side === "enemy") u.alive = false;
}

const unitIn = (loop: RunLoop, id: string): Unit => loop.staged!.battle.units.find((u) => u.id === id)!;
const questFor = (loop: RunLoop, id: string) => loop.run.rescueQuests.find((q) => q.unitId === id);

// ===========================================================================
// 1. REGRESSION — the behaviour this change must NOT move.
// ===========================================================================

describe("REGRESSION — an eliminate-all win still auto-rescues exactly as before (D21)", () => {
  it("a captured party member is FREED and rescued by a field-control win, never questered", () => {
    const loop = stagedRun(prison());
    // The closing net took Nyx during deployment — the shipped D21 case.
    captureUnit(unitIn(loop, "nyx"));
    clearTheField(loop);

    const res = loop.resolve();
    expect(res.result).toBe("win");
    expect(res.rescued).toContain("nyx");
    expect(res.rescueQuests.map((q) => q.unitId)).not.toContain("nyx");
    expect(loop.run.rescueQuests).toEqual([]);
    // Freed means fieldable again — the roster unit is un-bound, not merely reported.
    expect(loop.run.party.find((u) => u.id === "nyx")!.captured).toBe(false);
  });

  it("a captive still LOCKED IN ITS CELL is recruited by a field-control win (the E1 Cook guarantee, D52)", () => {
    const loop = stagedRun(plainCamp());
    expect(unitIn(loop, "cook").captured).toBe(true); // never reached; still bound
    clearTheField(loop);

    const res = loop.resolve();
    expect(res.result).toBe("win");
    expect(loop.run.party.some((u) => u.id === "cook")).toBe(true);
    expect(res.rescued).toContain("cook");
    expect(loop.run.rescueQuests).toEqual([]);
  });

  it("the same holds on a dual-OR encounter won FRONTALLY — prisoners in cells still come home", () => {
    const loop = stagedRun(prison());
    // Nobody was freed and nobody walked anywhere: the garrison simply fell.
    expect(unitIn(loop, "wisp").captured).toBe(true);
    expect(unitIn(loop, "bram").captured).toBe(true);
    clearTheField(loop);

    const res = loop.resolve();
    expect(res.result).toBe("win");
    expect(loop.run.party.map((u) => u.id)).toEqual(expect.arrayContaining(["wisp", "bram"]));
    expect(loop.run.rescueQuests).toEqual([]);
  });

  // "the shipped Hollow Mill E1 is byte-identical" moved to
  // `content/hollow-mill-expedition.test.ts` (D122) — it plays node `e1`, whose body is now
  // `content/levels/e1-skirmish.json`, and `core/` may never import `content/`. The synthetic
  // cases above still pin the D21 clause itself, on fixtures this file owns.

  it("an encounter with NO exfil objective is untouched: no Go-now control exists at all", () => {
    const loop = stagedRun(plainCamp());
    expect(canCallExfil(loop.staged!)).toBe(false);
    expect(callExfil(loop.staged!)).toBeUndefined();
  });

  it("a LOSS still turns a captured party member into a rescue quest, not a death (D9)", () => {
    const loop = stagedRun(prison());
    const nyx = unitIn(loop, "nyx");
    captureUnit(nyx);
    unitIn(loop, "cinder").alive = false; // no player standing ⇒ wipe

    const res = loop.resolve();
    expect(res.result).toBe("wipe");
    expect(res.rescueQuests.map((q) => q.unitId)).toContain("nyx");
  });
});

describe("heldTheField — the D21 field-control predicate", () => {
  it("is exactly 'no active enemy remains', so every eliminate-all win holds the field", () => {
    const loop = stagedRun(prison());
    expect(heldTheField(loop.staged!.battle.units)).toBe(false);
    clearTheField(loop);
    expect(heldTheField(loop.staged!.battle.units)).toBe(true);
  });

  it("a fled enemy (D84 escaped) counts as off the field — the win still auto-rescues", () => {
    const loop = stagedRun(prison());
    for (const u of loop.staged!.battle.units) if (u.side === "enemy") u.escaped = true;
    expect(heldTheField(loop.staged!.battle.units)).toBe(true);
  });
});

// ===========================================================================
// 2. G1 — the extraction met-condition covers captives AND the surviving party.
// ===========================================================================

describe("G1 — extraction does not resolve out from under a party still crossing", () => {
  const extraction = (loop: RunLoop) => loop.staged!.objectives.find((o) => o.spec.kind === "extraction")!;

  it("stays pending while a party unit is off the exfil site, even with every prisoner out", () => {
    const loop = stagedRun(prison());
    for (const id of ["wisp", "bram"]) {
      const p = unitIn(loop, id);
      freeCaptive(p);
      p.pos = { ...EXIT[0] };
    }
    // Cinder and Nyx are still mid-corridor.
    expect(extraction(loop).status()).toBe("pending");
  });

  it("…and is met the moment the last party unit steps onto a mouth", () => {
    const loop = stagedRun(prison());
    for (const id of ["wisp", "bram", "cinder", "nyx"]) {
      const u = unitIn(loop, id);
      freeCaptive(u);
      u.pos = { ...EXIT[1] };
    }
    expect(extraction(loop).status()).toBe("met");
  });

  it("a DOWNED party member does not block the extraction (only the living must walk out)", () => {
    const loop = stagedRun(prison());
    for (const id of ["wisp", "bram", "nyx"]) {
      const u = unitIn(loop, id);
      freeCaptive(u);
      u.pos = { ...EXIT[0] };
    }
    unitIn(loop, "cinder").alive = false;
    expect(extraction(loop).status()).toBe("met");
  });

  it("a still-cuffed prisoner keeps it PENDING, never failed — the frontal path stays open", () => {
    const loop = stagedRun(prison());
    const nyx = unitIn(loop, "nyx");
    const cinder = unitIn(loop, "cinder");
    for (const u of [nyx, cinder]) u.pos = { ...EXIT[0] };
    const wisp = unitIn(loop, "wisp");
    freeCaptive(wisp);
    wisp.pos = { ...EXIT[1] };
    // bram is still in his cell.
    expect(extraction(loop).status()).toBe("pending");
  });

  it("a unit that FLED the field (D84) neither blocks extraction nor is left behind", () => {
    const loop = stagedRun(prison());
    for (const id of ["wisp", "bram", "cinder"]) {
      const u = unitIn(loop, id);
      freeCaptive(u);
      u.pos = { ...EXIT[0] };
    }
    const nyx = unitIn(loop, "nyx");
    nyx.escaped = true; // ran off the map edge — already away, not a straggler
    expect(extraction(loop).status()).toBe("met");
  });

  it("a mid-fight SWAYED enemy (D30/D62 flips side to player) can never block the extraction", () => {
    const loop = stagedRun(prison());
    for (const id of ["wisp", "bram", "cinder", "nyx"]) {
      const u = unitIn(loop, id);
      freeCaptive(u);
      u.pos = { ...EXIT[0] };
    }
    // The Noble's bribe turns a guard coat mid-fight; it stands deep in the prison.
    unitIn(loop, "guard-a").side = "player";
    // The exfil cohort was snapshotted at staging: a turncoat is not one of yours.
    expect(extraction(loop).status()).toBe("met");
  });
});

// ===========================================================================
// 3. G2 — the "Go now" call.
// ===========================================================================

describe("G2 — Go now resolves extraction on demand, from what is true at the call", () => {
  it("is refused when nobody stands on an exfil site (the call can never manufacture a wipe)", () => {
    const loop = stagedRun(prison());
    expect(canCallExfil(loop.staged!)).toBe(false);
    expect(callExfil(loop.staged!)).toBeUndefined();
  });

  it("captives out ⇒ an extraction WIN, with the garrison still standing", () => {
    const loop = stagedRun(prison());
    for (const id of ["wisp", "bram", "nyx"]) {
      const u = unitIn(loop, id);
      freeCaptive(u);
      u.pos = { ...EXIT[0] };
    }
    unitIn(loop, "cinder").pos = { col: 3, row: 1 }; // the rearguard, still inside

    const call = callExfil(loop.staged!)!;
    expect(call.result).toBe("win");
    expect(call.leftBehind.map((u) => u.id)).toEqual(["cinder"]);
    expect(loop.staged!.battle.units.some((u) => u.side === "enemy" && u.alive)).toBe(true);
  });

  it("captives NOT out ⇒ a survivable RETREAT (objective-failure), not a win and not a wipe", () => {
    const loop = stagedRun(prison());
    for (const id of ["cinder", "nyx"]) unitIn(loop, id).pos = { ...EXIT[0] };
    // Both prisoners are still in their cells — the party is calling it off.
    const call = callExfil(loop.staged!)!;
    expect(call.result).toBe("objective-failure");
    expect(loop.resolve().result).toBe("objective-failure");
  });

  it("the call is sticky and idempotent — a second press changes nothing", () => {
    const loop = stagedRun(prison());
    unitIn(loop, "cinder").pos = { ...EXIT[0] };
    const first = callExfil(loop.staged!)!;
    const second = callExfil(loop.staged!)!;
    expect(first.result).toBe("objective-failure");
    expect(second.result).toBe("objective-failure");
    expect(second.leftBehind).toEqual([]); // already marked
  });

  it("the left-behind marking is LOGGED (it routes through Battle.apply, so replay/undo see it)", () => {
    const loop = stagedRun(prison());
    unitIn(loop, "cinder").pos = { ...EXIT[0] };
    callExfil(loop.staged!);
    const log = loop.staged!.battle.log;
    expect(log.filter((a) => a.kind === "capture").map((a) => (a as { unit: string }).unit)).toContain("nyx");
  });
});

// ===========================================================================
// 4. G3 — the left-behind consequence, on BOTH populations.
// ===========================================================================

describe("G3a — a left-behind PARTY unit ends up captured and is NOT auto-freed", () => {
  it("on an extraction win: questered by name, and it does not come home", () => {
    const loop = stagedRun(prison());
    for (const id of ["wisp", "bram", "nyx"]) {
      const u = unitIn(loop, id);
      freeCaptive(u);
      u.pos = { ...EXIT[0] };
    }
    unitIn(loop, "cinder").pos = { col: 3, row: 1 };
    callExfil(loop.staged!);

    const res = loop.resolve();
    expect(res.result).toBe("win");
    expect(res.rescued).not.toContain("cinder");
    expect(questFor(loop, "cinder")).toBeDefined();
    expect(questFor(loop, "cinder")!.unitName).toBe("cinder");
    // Still bound on the roster ⇒ excluded from combatParty: he did not walk home.
    expect(loop.run.party.find((u) => u.id === "cinder")!.captured).toBe(true);
  });

  it("a unit that IS on the mouth walks out free — the same call, the other side of the line", () => {
    const loop = stagedRun(prison());
    for (const id of ["wisp", "bram", "nyx"]) {
      const u = unitIn(loop, id);
      freeCaptive(u);
      u.pos = { ...EXIT[0] };
    }
    unitIn(loop, "cinder").pos = { col: 3, row: 1 };
    callExfil(loop.staged!);
    loop.resolve();
    expect(loop.run.party.find((u) => u.id === "nyx")!.captured).toBe(false);
    expect(questFor(loop, "nyx")).toBeUndefined();
  });
});

describe("G3c — a left-behind CAPTIVE is not recruited, and is recorded on BOTH outcomes", () => {
  it("on an extraction WIN: the prisoner in the cell does not join the party", () => {
    const loop = stagedRun(prison());
    // Only Wisp was picked out. Bram is still locked in.
    const wisp = unitIn(loop, "wisp");
    freeCaptive(wisp);
    wisp.pos = { ...EXIT[0] };
    for (const id of ["cinder", "nyx"]) unitIn(loop, id).pos = { ...EXIT[1] };

    // With Bram still cuffed the extraction goal cannot be met — this is the retreat shape.
    const call = callExfil(loop.staged!)!;
    expect(call.result).toBe("objective-failure");

    const res = loop.resolve();
    expect(loop.run.party.some((u) => u.id === "bram")).toBe(false);
    expect(res.rescueQuests.map((q) => q.unitId)).toContain("bram");
    expect(questFor(loop, "bram")!.unitName).toBe("bram");
    // …while the one you did get out comes home.
    expect(loop.run.party.some((u) => u.id === "wisp")).toBe(true);
  });

  it("a FREED captive left off the mouth is left behind too — freeing is not saving", () => {
    const loop = stagedRun(prison());
    const wisp = unitIn(loop, "wisp");
    const bram = unitIn(loop, "bram");
    freeCaptive(wisp);
    freeCaptive(bram);
    wisp.pos = { ...EXIT[0] };
    bram.pos = { col: 3, row: 2 }; // out of the cell but not out of the building
    for (const id of ["cinder", "nyx"]) unitIn(loop, id).pos = { ...EXIT[1] };

    expect(callExfil(loop.staged!)!.result).toBe("objective-failure");
    loop.resolve();
    expect(loop.run.party.some((u) => u.id === "bram")).toBe(false);
    expect(questFor(loop, "bram")).toBeDefined();
    expect(loop.run.party.some((u) => u.id === "wisp")).toBe(true);
  });

  it("an extraction WIN leaves only party behind — every prisoner is out and recruited", () => {
    const loop = stagedRun(prison());
    for (const id of ["wisp", "bram"]) {
      const u = unitIn(loop, id);
      freeCaptive(u);
      u.pos = { ...EXIT[0] };
    }
    unitIn(loop, "nyx").pos = { ...EXIT[1] };
    unitIn(loop, "cinder").pos = { col: 3, row: 1 };

    expect(callExfil(loop.staged!)!.result).toBe("win");
    const res = loop.resolve();
    expect(loop.run.party.map((u) => u.id)).toEqual(expect.arrayContaining(["wisp", "bram"]));
    expect(res.rescueQuests.map((q) => q.unitId)).toEqual(["cinder"]);
  });

  it("closes the documented seam limitation: a captive no longer VANISHES on a survivable loss", () => {
    const loop = stagedRun(prison());
    unitIn(loop, "cinder").pos = { ...EXIT[0] };
    callExfil(loop.staged!);
    const res = loop.resolve();
    expect(res.result).toBe("objective-failure");
    // Both prisoners stayed in their cells — neither recruited, but neither silently lost.
    expect(loop.run.party.some((u) => u.id === "wisp" || u.id === "bram")).toBe(false);
    expect(res.rescueQuests.map((q) => q.unitId).sort()).toEqual(["bram", "nyx", "wisp"]);
  });

  it("a DOWNED captive is neither recruited nor called a rescue (a corpse is not a quest)", () => {
    const loop = stagedRun(prison());
    const bram = unitIn(loop, "bram");
    freeCaptive(bram);
    bram.alive = false;
    const wisp = unitIn(loop, "wisp");
    freeCaptive(wisp);
    wisp.pos = { ...EXIT[0] };
    for (const id of ["cinder", "nyx"]) unitIn(loop, id).pos = { ...EXIT[1] };

    callExfil(loop.staged!);
    const res = loop.resolve();
    expect(loop.run.party.some((u) => u.id === "bram")).toBe(false);
    expect(res.rescueQuests.map((q) => q.unitId)).not.toContain("bram");
  });
});

// ===========================================================================
// 5. The record (G3b) — RescueQuest extended, no new flag namespace.
// ===========================================================================

describe("G3b — the record rides run.rescueQuests and names the unit", () => {
  it("accumulates on the run, carries the unit's NAME, and mounts no retrieval node (inert)", () => {
    const run: RunState = createRun("rq", { party: [createUnit(PARTY[0])], difficultyId: "normal" });
    expect(run.rescueQuests).toEqual([]);

    const loop = stagedRun(prison());
    unitIn(loop, "cinder").pos = { ...EXIT[0] };
    callExfil(loop.staged!);
    loop.resolve();

    const quest = questFor(loop, "nyx")!;
    expect(quest).toMatchObject({ unitId: "nyx", unitName: "nyx" });
    expect(quest.nights).toBeGreaterThanOrEqual(0);
    // Inert: nothing on the run turns a quest into a node.
    expect(loop.run.map.order).toEqual(["start", "fight"]);
  });
});
