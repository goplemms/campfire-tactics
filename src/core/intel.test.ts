import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import { streamFor } from "./rng";
import { Labels } from "./rng-labels";
import { generateEncounter } from "./generation";
import {
  intelFloor,
  readEncounter,
  intelDeployBonus,
  clampTier,
  MAX_TIER,
  TRAP_INTEL,
  intelDepthOf,
  effectiveIntelTier,
  previewNode,
  rewardBand,
} from "./intel";
import type { AuthoredEncounter } from "./authored";
import { TRAP_FIELD, E1_SKIRMISH, OUTER_YARD } from "./hollow-mill";
import { stageEncounter } from "./staging";
import { isConcealedTrap } from "./entities";
import { createRun, createRunFromExpedition } from "./run";
import { THE_HOLLOW_MILL } from "./hollow-mill";
import { getNode } from "./overworld";
import { earlyEventForNode } from "./early-events";

const AMBUSH: AuthoredEncounter = {
  id: "amb",
  name: "Ambush",
  cols: 8,
  rows: 6,
  blocked: [],
  playerSpawns: [{ col: 0, row: 0 }],
  enemies: [
    { templateId: "bandit-thug", pos: { col: 6, row: 2 } },
    { templateId: "bandit-cutthroat", pos: { col: 6, row: 4 }, hidden: true },
  ],
  reward: { gold: 50, materials: [] },
  objectives: [],
};

function member(id: string, intelligence = 0): Unit {
  return createUnit({
    id,
    side: "player",
    pos: { col: 0, row: 0 },
    intelligence,
    speed: 10,
    maxHp: 20,
    attack: 5,
    defense: 1,
    moveRange: 4,
    sightRadius: 5,
  });
}

const def = generateEncounter(streamFor("intel", Labels.enc(0)), 0);

describe("intel — lanes up the ladder (D10)", () => {
  it("Lane 1: the Intelligence stat sets a banded passive floor", () => {
    expect(intelFloor([member("a", 0)])).toBe(0);
    expect(intelFloor([member("a", 3)])).toBe(1);
    expect(intelFloor([member("a", 6)])).toBe(2);
    expect(intelFloor([member("a", 9)])).toBe(3);
    // The party reads from its highest-Intelligence member.
    expect(intelFloor([member("a", 1), member("seer", 9)])).toBe(3);
  });

});

describe("intel — banded reveals (D10)", () => {
  it("reveals types → numbers → positions as the tier rises", () => {
    expect(readEncounter(def, 0).types).toBeUndefined();

    const t1 = readEncounter(def, 1);
    expect(t1.types && t1.types.length).toBeGreaterThan(0);
    expect(t1.count).toBeUndefined();

    const t2 = readEncounter(def, 2);
    expect(t2.count).toBe(def.enemies.length);
    expect(t2.positions).toBeUndefined();

    const t3 = readEncounter(def, 3);
    expect(t3.positions && t3.positions.length).toBe(def.enemies.length);
  });

  it("Tier 3 grants starting vision (the D18 bridge); lower tiers do not", () => {
    expect(readEncounter(def, 3).grantsVision).toBe(true);
    expect(readEncounter(def, 2).grantsVision).toBe(false);
    expect(clampTier(99)).toBe(MAX_TIER);
  });
});

describe("intel — node preview for the overworld (D24)", () => {
  function party(intelligence: number): Unit[] {
    return [member("Scout", intelligence), member("Pal", 0)];
  }
  function runWith(intelligence: number) {
    return createRun("preview-seed", { party: party(intelligence), difficultyId: "normal", gold: 100 });
  }
  function firstCombatNodeId(run: ReturnType<typeof runWith>): string {
    return run.map.order.map((id) => getNode(run.map, id)).find((n) => n.kind === "combat")!.id;
  }

  it("always shows kind + encounter type; rest nodes show a recovery hint", () => {
    const run = runWith(0);
    const combatId = firstCombatNodeId(run);
    const combat = previewNode(run, combatId);
    expect(combat.kind).toBe("combat");
    expect(combat.encounterKind).toBeDefined();

    const restId = run.map.order.map((id) => getNode(run.map, id)).find((n) => n.kind === "rest")!.id;
    const rest = previewNode(run, restId);
    expect(rest.kind).toBe("rest");
    expect(rest.restHint).toBeTruthy();
    expect(rest.encounterKind).toBeUndefined();
  });

  it("is banded by the party's intel floor and reveals more at higher tiers", () => {
    const low = runWith(0); // floor tier 0
    const mid = runWith(6); // floor tier 2
    const high = runWith(9); // floor tier 3
    const id = firstCombatNodeId(low);

    const p0 = previewNode(low, id);
    const p2 = previewNode(mid, id);
    const p3 = previewNode(high, id);

    // Tier 0: type known (always), but no enemy read, no reward figure.
    expect(p0.intel?.types).toBeUndefined();
    expect(p0.rewardHint).toBeUndefined();
    // Tier 2: types + count + an approximate reward.
    expect(p2.intel?.types && p2.intel.types.length).toBeGreaterThan(0);
    expect(p2.intel?.count).toBeGreaterThan(0);
    expect(p2.rewardHint).toMatch(/g$/);
    // Tier 3: positions + starting vision; strictly more than tier 2.
    expect(p3.intel?.positions && p3.intel.positions.length).toBeGreaterThan(0);
    expect(p3.intel?.grantsVision).toBe(true);
  });

  it("a bought/divined bump raises the read above the floor", () => {
    const run = runWith(0); // floor tier 0
    const id = firstCombatNodeId(run);
    expect(previewNode(run, id).intel?.types).toBeUndefined();
    expect(previewNode(run, id, 1).intel?.types).toBeDefined(); // bumped to tier 1
  });

  it("Survey (effect B) reveals a scouted node's early event on the road (D80)", () => {
    // Find a seed with a combat node that carries an early event (thief at low standing).
    let run = runWith(0);
    let node = run.map.order.map((id) => getNode(run.map, id)).find((n) => n.kind === "combat" && earlyEventForNode(run, n) !== null);
    for (let i = 0; !node && i < 30; i++) {
      run = createRun(`early-reveal-${i}`, { party: party(0), difficultyId: "normal", gold: 100 });
      node = run.map.order.map((id) => getNode(run.map, id)).find((n) => n.kind === "combat" && earlyEventForNode(run, n) !== null);
    }
    expect(node).toBeDefined();

    // Unscouted, the road is hidden; a scouted (extraTier > 0) preview reveals the early event.
    expect(previewNode(run, node!.id).earlyEventHint).toBeUndefined();
    expect(previewNode(run, node!.id, 1).earlyEventHint).toBeTruthy();

    // A quiet combat node stays quiet even once scouted.
    const quiet = run.map.order.map((id) => getNode(run.map, id)).find((n) => n.kind === "combat" && earlyEventForNode(run, n) === null);
    if (quiet) expect(previewNode(run, quiet.id, 1).earlyEventHint).toBeUndefined();
  });

  it("reachable-node previews are stable for a seed", () => {
    const a = runWith(6);
    const b = runWith(6);
    for (const next of [...a.map.order]) {
      expect(previewNode(a, next)).toEqual(previewNode(b, next));
    }
  });

  it("reward bands are ordered (modest → good → rich)", () => {
    expect(rewardBand(10)).toBe("modest");
    expect(rewardBand(100)).toBe("good");
    expect(rewardBand(200)).toBe("rich");
  });
});

describe("intel teeth — scouting reveals the ambush and buys a deploy edge (D10)", () => {
  it("a hidden ambush body is read only at full positional intel (tier 3)", () => {
    // Up to tier 2 the hidden cutthroat is unread — only the visible thug counts.
    expect(readEncounter(AMBUSH, 1).types).toHaveLength(1);
    expect(readEncounter(AMBUSH, 2).count).toBe(1);
    expect(readEncounter(AMBUSH, 2).positions).toBeUndefined();
    // Tier 3: the scout spotted the trap — both kinds read, both positioned.
    expect(readEncounter(AMBUSH, MAX_TIER).types).toHaveLength(2);
    expect(readEncounter(AMBUSH, MAX_TIER).count).toBe(2);
    expect(readEncounter(AMBUSH, MAX_TIER).positions).toHaveLength(2);
  });

  it("intelDeployBonus scales the deploy edge with the tier earned", () => {
    expect(intelDeployBonus(0)).toEqual({ safeDepthBonus: 0, exposureMultiplier: 1 });
    expect(intelDeployBonus(2).safeDepthBonus).toBeGreaterThan(intelDeployBonus(0).safeDepthBonus);
    expect(intelDeployBonus(3).safeDepthBonus).toBeGreaterThan(intelDeployBonus(2).safeDepthBonus);
    expect(intelDeployBonus(3).exposureMultiplier).toBeLessThan(intelDeployBonus(1).exposureMultiplier);
  });
});

describe("intel — the trap lane + info lane (D83)", () => {
  it("the trap lane bands presence → count → careless marks, honestly gated", () => {
    // Tier 0: nothing — a no-intel party walks in blind.
    expect(readEncounter(TRAP_FIELD, 0).traps).toBeUndefined();
    // Tier 1: presence only.
    const t1 = readEncounter(TRAP_FIELD, 1);
    expect(t1.traps).toEqual({ present: true });
    // Tier 2: the count.
    expect(readEncounter(TRAP_FIELD, 2).traps).toEqual({ present: true, count: 5 });
    // Tier 3: the careless mark — ONLY concealment ≤ cap (one snare at 4), never the field.
    const t3 = readEncounter(TRAP_FIELD, 3);
    expect(t3.traps).toEqual({ present: true, count: 5, marked: 1 });
  });

  it("a trapless field reads an honest 'none sensed' — the lane never leaks by absence", () => {
    expect(readEncounter(E1_SKIRMISH, 1).traps).toEqual({ present: false });
    expect(readEncounter(E1_SKIRMISH, 0).traps).toBeUndefined();
  });

  it("the dug-in garrison resists the read — the Outer Yard's careful work marks NOTHING at tier 3", () => {
    const t3 = readEncounter(OUTER_YARD, 3);
    expect(t3.traps).toEqual({ present: true, count: 3, marked: 0 });
  });

  it("the info lane unlocks one rumor line per tier; the total exposes the locked ???s", () => {
    const t0 = readEncounter(TRAP_FIELD, 0);
    expect(t0.notes).toEqual([]);
    expect(t0.notesTotal).toBe(3);
    expect(readEncounter(TRAP_FIELD, 1).notes).toHaveLength(1);
    expect(readEncounter(TRAP_FIELD, 1).notes?.[0]).toMatch(/Folk around here/);
    expect(readEncounter(TRAP_FIELD, 3).notes).toHaveLength(3);
    // No rumors authored → no info box at all.
    expect(readEncounter(AMBUSH, 3).notes).toBeUndefined();
  });

  it("tier 3 stages the careless snare pre-revealed — and ONLY it (the ceiling holds)", () => {
    const party = [member("edrin"), member("vale", 9)]; // int 9 → tier-3 floor for the read
    const staged = stageEncounter(TRAP_FIELD, party, { markTrapsUpTo: TRAP_INTEL.markConcealmentMax });
    const traps = staged.battle.entities.all().filter(isConcealedTrap);
    const revealed = traps.filter((t) => t.revealed);
    expect(traps).toHaveLength(5);
    expect(revealed).toHaveLength(1);
    expect(revealed[0]?.concealment).toBe(4); // the sloppy dig; the careful work keeps its secret
  });

  it("unscouted staging marks nothing", () => {
    const staged = stageEncounter(TRAP_FIELD, [member("edrin")], {});
    expect(staged.battle.entities.all().filter(isConcealedTrap).every((t) => !t.revealed)).toBe(true);
  });
});

describe("intel — the fully-read terminal + authored-shape omission (D85)", () => {
  const run = createRunFromExpedition(THE_HOLLOW_MILL); // Vale int 7 → tier-2 floor

  it("an authored node is flagged authored with no procedural type to reveal", () => {
    const p = previewNode(run, "snares");
    expect(p.authored).toBe(true);
    expect(p.encounterKind).toBeUndefined(); // never a phantom `???` Type lane
  });

  it("intelComplete is false below MAX_TIER and true once read to the deepest tier", () => {
    expect(previewNode(run, "snares", 0).intelComplete).toBe(false); // tier 2 floor
    expect(previewNode(run, "snares", 1).intelComplete).toBe(true); // +1 Survey → tier 3
  });

  it("at the terminal the info lane is fully revealed — no locked ??? remain", () => {
    const done = previewNode(run, "snares", 1);
    expect(done.intel?.notes?.length).toBe(done.intel?.notesTotal); // every rumor read
  });

  it("a rest node carries no intel-complete signal (nothing to scout)", () => {
    expect(previewNode(run, "start").intelComplete).toBeUndefined();
  });
});

describe("intel — per-node depth caps the read (D86)", () => {
  const shallow: AuthoredEncounter = { ...AMBUSH, intelDepth: 2 };
  const deep: AuthoredEncounter = { ...AMBUSH }; // no intelDepth → full

  it("intelDepthOf reads the authored cap, defaulting to MAX_TIER", () => {
    expect(intelDepthOf(deep)).toBe(MAX_TIER);
    expect(intelDepthOf(shallow)).toBe(2);
  });

  it("effectiveIntelTier never exceeds the node's depth, however sharp the party", () => {
    expect(effectiveIntelTier(3, shallow)).toBe(2); // a tier-3 read capped to 2
    expect(effectiveIntelTier(1, shallow)).toBe(1); // below the cap: unchanged
    expect(effectiveIntelTier(3, deep)).toBe(3); // full-depth node: uncapped
  });

  it("a depth-2 read never reveals positions or blows the ambush", () => {
    // Capped to tier 2: positions (tier 3) stay hidden, and the ambush body never
    // reveals — count reads 1 (the visible thug), never the concealed cutthroat.
    const capped = readEncounter(shallow, effectiveIntelTier(3, shallow));
    expect(capped.count).toBe(1);
    expect(capped.positions).toBeUndefined();
    expect(capped.grantsVision).toBe(false);
    // …whereas the full-depth twin, read at tier 3, reveals both bodies + positions.
    const full = readEncounter(deep, effectiveIntelTier(3, deep));
    expect(full.count).toBe(2);
    expect(full.positions).toHaveLength(2);
    expect(full.grantsVision).toBe(true);
  });

  it("the Thieves' Den is authored shallow (depth 2) — fully known to a smart party, no positions", () => {
    const run = createRunFromExpedition(THE_HOLLOW_MILL); // Vale int 7 → tier-2 floor
    const den = previewNode(run, "den");
    expect(den.intelDepth).toBe(2);
    // At the tier-2 floor the den is already read to its depth — nothing to scout.
    expect(den.intelComplete).toBe(true);
    expect(den.intel?.positions).toBeUndefined(); // never learns where the thieves lurk
    // A Survey bump can't push past the cap.
    expect(previewNode(run, "den", 1).intel?.tier).toBe(2);
  });
});
