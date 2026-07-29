import { describe, it, expect } from "vitest";
import { createUnit, type Unit, type UnitSpec } from "./units";
import { TileGrid } from "./grid";
import { Battle } from "./turn";
import type { EncounterDef } from "./generation";
import type { AuthoredEncounter } from "./authored";
import type { ArmedObjective, ObjectiveStatus, ObjectiveSpec } from "./objectives";
import {
  stageEncounter,
  encounterOutcome,
  isAuthoredEncounter,
  type StagedEncounter,
} from "./staging";

function player(id: string, over: Partial<UnitSpec> = {}): Unit {
  return createUnit({
    id, side: "player", pos: { col: 0, row: 0 },
    speed: 10, maxHp: 20, attack: 6, defense: 2, moveRange: 3, sightRadius: 5, attackRange: 1, ...over,
  });
}

const PROCEDURAL: EncounterDef = {
  index: 0,
  kind: "open-field",
  cols: 8,
  rows: 6,
  blocked: [],
  enemies: [
    { id: "thug", name: "Thug", side: "enemy", pos: { col: 6, row: 2 }, speed: 9, maxHp: 18, attack: 6, defense: 2, moveRange: 3, sightRadius: 4, attackRange: 1 },
  ],
  reward: { gold: 50, materials: [] },
};

const AUTHORED: AuthoredEncounter = {
  id: "set-piece",
  name: "A Set-Piece",
  cols: 8,
  rows: 6,
  blocked: [{ col: 4, row: 1 }],
  playerSpawns: [{ col: 2, row: 2 }, { col: 2, row: 3 }],
  enemies: [{ templateId: "bandit-thug", pos: { col: 6, row: 2 } }],
  reward: { gold: 80, materials: [] },
  objectives: [
    { id: "gate", kind: "closing-gate", required: true, label: "Hold", speed: 5, span: [], driver: { id: "drv" } },
  ],
};

describe("stageEncounter — one shape for both sources (D50)", () => {
  it("stages a procedural source: auto-edge placement + default elimination goal", () => {
    const roster = [player("a"), player("b")];
    const staged = stageEncounter(PROCEDURAL, roster);
    // Both sides on the board.
    expect(staged.battle.units.filter((u) => u.side === "player")).toHaveLength(2);
    expect(staged.battle.units.filter((u) => u.side === "enemy")).toHaveLength(1);
    // Auto home edge: the left columns (0/1).
    for (const u of roster) expect(u.pos.col).toBeLessThanOrEqual(1);
    // Default elimination goal injected.
    expect(staged.objectives).toHaveLength(1);
    expect(staged.objectives[0].spec.kind).toBe("eliminate-all");
  });

  it("stages an authored source: honors playerSpawns + arms its objectives (+ default goal)", () => {
    const roster = [player("a"), player("b")];
    const staged = stageEncounter(AUTHORED, roster);
    expect(roster[0].pos).toEqual({ col: 2, row: 2 });
    expect(roster[1].pos).toEqual({ col: 2, row: 3 });
    // The default goal is injected ahead of the authored closing-gate.
    expect(staged.objectives.map((o) => o.spec.kind)).toEqual(["eliminate-all", "closing-gate"]);
  });

  it("revealHidden blows the ambush: hidden bodies stage visible (D10)", () => {
    const withAmbush: AuthoredEncounter = {
      ...AUTHORED,
      enemies: [
        { templateId: "bandit-thug", pos: { col: 6, row: 2 } },
        { templateId: "bandit-cutthroat", pos: { col: 6, row: 4 }, hidden: true },
      ],
    };
    // Default (unscouted): the ambush body stays hidden until the fight reveals it.
    const blind = stageEncounter(withAmbush, [player("a")]);
    expect(blind.battle.units.some((u) => u.side === "enemy" && u.hidden)).toBe(true);
    // Scouted to full intel: no enemy starts hidden — the surprise is gone.
    const scouted = stageEncounter(withAmbush, [player("a")], { revealHidden: true });
    expect(scouted.battle.units.some((u) => u.side === "enemy" && u.hidden)).toBe(false);
    expect(scouted.battle.units.filter((u) => u.side === "enemy")).toHaveLength(2);
  });

  it("resets combat-scoped transient state on the placed roster", () => {
    const u = player("a", { hp: 20 });
    u.ct = 99;
    u.captured = true;
    stageEncounter(PROCEDURAL, [u]);
    expect(u.ct).toBe(0);
    expect(u.captured).toBe(false);
    expect(u.statuses).toEqual([]);
  });

  it("isAuthoredEncounter discriminates the union", () => {
    expect(isAuthoredEncounter(AUTHORED)).toBe(true);
    expect(isAuthoredEncounter(PROCEDURAL)).toBe(false);
  });

  it("stages an on-board captive (D52): player-side + bound, off the clock, not the roster", () => {
    const captive: UnitSpec = {
      id: "pip", name: "Pip", side: "player", pos: { col: 0, row: 0 },
      speed: 8, maxHp: 18, attack: 4, defense: 1, moveRange: 3, sightRadius: 4, attackRange: 1,
    };
    const withCaptive: AuthoredEncounter = { ...AUTHORED, captives: [{ spec: captive, pos: { col: 7, row: 1 } }] };
    const roster = [player("a")];
    const staged = stageEncounter(withCaptive, roster);

    const pip = staged.battle.units.find((u) => u.id === "pip")!;
    expect(pip).toBeDefined();
    expect(pip.side).toBe("player"); // forced player-side
    expect(pip.captured).toBe(true); // bound — survives the roster reset (it's not in the roster)
    expect(pip.authored).toBe(true); // an authored cast member → joins permanently when freed
    expect(pip.pos).toEqual({ col: 7, row: 1 }); // at its declared (captor's-corner) tile
    // The roster passed in is unchanged in size — the captive is NOT one of the roster units.
    expect(roster.some((u) => u.id === "pip")).toBe(false);
    // Off the clock: the captive never takes a turn (the active-participant predicate skips it).
    staged.battle.seed();
    expect(pip.ct).toBe(0);
    const handed: string[] = [];
    for (let i = 0; i < 12; i++) {
      const a = staged.battle.nextActor();
      if (!a) break;
      handed.push(a.id);
      a.ct = 0; // drain so the loop advances to the next actor
    }
    expect(handed).not.toContain("pip");
  });
});

// --- encounterOutcome truth table (D50/D51) ---------------------------------

function fakeObjective(
  required: boolean,
  status: ObjectiveStatus,
  kind: ObjectiveSpec["kind"] = "eliminate-all",
): ArmedObjective {
  return { spec: { id: `${kind}:${status}`, kind, required, label: status }, status: () => status, progress: () => undefined };
}

function staged(players: Unit[], enemies: Unit[], objectives: ArmedObjective[]): StagedEncounter {
  const battle = new Battle(new TileGrid(8, 6, []), [...players, ...enemies]);
  return { battle, objectives, source: PROCEDURAL };
}

describe("encounterOutcome (D50/D51)", () => {
  const hero = () => player("hero");
  const foe = () => createUnit({ id: "foe", side: "enemy", pos: { col: 6, row: 2 }, speed: 9, maxHp: 10, attack: 4, defense: 1, moveRange: 2, sightRadius: 4, attackRange: 1 });

  it("win: all required met, players standing", () => {
    const s = staged([hero()], [], [fakeObjective(true, "met")]);
    expect(encounterOutcome(s)).toBe("win");
  });

  it("objective-failure: a required CONSTRAINT failed (enemies may still stand)", () => {
    // Only a constraint (closing-gate) can fail into objective-failure; a goal never fails (D97).
    const s = staged([hero()], [foe()], [fakeObjective(true, "failed", "closing-gate")]);
    expect(encounterOutcome(s)).toBe("objective-failure");
  });

  it("wipe: no combat-capable player remains (precedence over a failed constraint)", () => {
    const down = hero();
    down.alive = false;
    const s = staged([down], [foe()], [fakeObjective(true, "failed", "closing-gate")]);
    expect(encounterOutcome(s)).toBe("wipe");
  });

  it("pending: a required goal is still undecided", () => {
    const s = staged([hero()], [foe()], [fakeObjective(true, "pending")]);
    expect(encounterOutcome(s)).toBeUndefined();
  });

  it("C2: an all-OPTIONAL authored goal doesn't stage into a turn-one trivial win", () => {
    // A live enemy + a single optional eliminate-all goal must NOT win vacuously: staging injects
    // the default REQUIRED goal, so the field must actually be cleared first.
    const trivial: AuthoredEncounter = {
      ...AUTHORED,
      objectives: [{ id: "bonus", kind: "eliminate-all", required: false, label: "optional" }],
    };
    const s = stageEncounter(trivial, [player("hero")]);
    expect(s.objectives.some((o) => o.spec.required && o.spec.kind === "eliminate-all")).toBe(true);
    expect(encounterOutcome(s)).toBeUndefined(); // pending — a foe still stands
  });

  it("an optional failure does NOT downgrade a win", () => {
    const s = staged([hero()], [], [fakeObjective(true, "met"), fakeObjective(false, "failed", "closing-gate")]);
    expect(encounterOutcome(s)).toBe("win");
  });

  // --- OR-victory: goals are OR'd, constraints AND'd (D97/C2) ----------------

  it("OR-victory: ANY required goal met wins, even with a sibling goal unmet", () => {
    // Two goals (frontal eliminate-all + extraction). Extraction met, elimination still pending.
    const s = staged([hero()], [foe()], [
      fakeObjective(true, "pending", "eliminate-all"),
      fakeObjective(true, "met", "extraction"),
    ]);
    expect(encounterOutcome(s)).toBe("win");
  });

  it("OR-victory: no goal met yet ⇒ still pending", () => {
    const s = staged([hero()], [foe()], [
      fakeObjective(true, "pending", "eliminate-all"),
      fakeObjective(true, "pending", "extraction"),
    ]);
    expect(encounterOutcome(s)).toBeUndefined();
  });

  it("a goal met but a required constraint still pending ⇒ not yet a win", () => {
    // eliminate-all met, but the closing-gate constraint hasn't resolved — constraints AND.
    const s = staged([hero()], [], [
      fakeObjective(true, "met", "eliminate-all"),
      fakeObjective(true, "pending", "closing-gate"),
    ]);
    expect(encounterOutcome(s)).toBeUndefined();
  });

  it("a goal met AND every constraint met ⇒ win", () => {
    const s = staged([hero()], [], [
      fakeObjective(true, "met", "extraction"),
      fakeObjective(true, "met", "closing-gate"),
    ]);
    expect(encounterOutcome(s)).toBe("win");
  });
});

// --- D119: authored spawn zones through the staging seam ---------------------

/**
 * The finale's shape in miniature: a multi-tile primary mouth plus a one-tile, flag-gated
 * side door. The gate is the *whole* graceful-degradation mechanism (D118) — no flag, no
 * zone, no entrance verb — so it is tested from the staging seam the game actually uses.
 */
const ZONED: AuthoredEncounter = {
  ...AUTHORED,
  id: "two-mouths",
  spawnZones: [
    { id: "front", label: "the Front Gate", primary: true, cap: 4, tiles: [{ col: 1, row: 5 }, { col: 2, row: 5 }, { col: 3, row: 5 }] },
    { id: "side", label: "the Side Door", cap: 1, requiresFlag: "side-door-intel", tiles: [{ col: 7, row: 0 }] },
  ],
};

describe("stageEncounter × authored spawn zones (D119)", () => {
  it("defaults the WHOLE party to the primary zone — the side door stages EMPTY", () => {
    const roster = [player("a"), player("b"), player("c")];
    const staged = stageEncounter(ZONED, roster, { flags: { "side-door-intel": true } });
    expect(roster.map((u) => u.pos)).toEqual([{ col: 1, row: 5 }, { col: 2, row: 5 }, { col: 3, row: 5 }]);
    // The defect this replaces: `placeParty` index-mapped party[i]→playerSpawns[i], so the
    // encounter's first authored spawn went to whoever was first in the roster.
    expect(roster.some((u) => u.pos.col === 7 && u.pos.row === 0)).toBe(false);
    expect(staged.battle.spawnZones.map((z) => z.id)).toEqual(["front", "side"]);
  });

  it("the flag is what unions the side door in — unset ⇒ the primary entrance alone", () => {
    const withIntel = stageEncounter(ZONED, [player("a")], { flags: { "side-door-intel": true } });
    expect(withIntel.battle.spawnZones.map((z) => z.id)).toEqual(["front", "side"]);

    const without = stageEncounter(ZONED, [player("a")], { flags: {} });
    expect(without.battle.spawnZones.map((z) => z.id)).toEqual(["front"]);

    const noFlagsAtAll = stageEncounter(ZONED, [player("a")]);
    expect(noFlagsAtAll.battle.spawnZones.map((z) => z.id)).toEqual(["front"]);
  });

  it("a spelling slip in the flag degrades silently to primary-only — hence the constant", () => {
    // The flag bag is an untyped Record<string, boolean>; this is the failure mode the
    // exported SIDE_DOOR_INTEL constant (and the JSON pin test) exist to prevent.
    const typo = stageEncounter(ZONED, [player("a")], { flags: { "side-door-inter": true } });
    expect(typo.battle.spawnZones.map((z) => z.id)).toEqual(["front"]);
  });

  it("is deterministic — same encounter + same flags ⇒ identical zones and placement", () => {
    const a = [player("a"), player("b")];
    const b = [player("a"), player("b")];
    const flags = { "side-door-intel": true };
    const s1 = stageEncounter(ZONED, a, { flags });
    const s2 = stageEncounter(ZONED, b, { flags });
    expect(s1.battle.spawnZones).toEqual(s2.battle.spawnZones);
    expect(a.map((u) => u.pos)).toEqual(b.map((u) => u.pos));
  });

  it("an explicit playerSpawns override still wins (the scenario/level harnesses)", () => {
    const roster = [player("a")];
    stageEncounter(ZONED, roster, { flags: { "side-door-intel": true }, playerSpawns: [{ col: 5, row: 2 }] });
    expect(roster[0].pos).toEqual({ col: 5, row: 2 });
  });

  it("fails loud when flag-filtering would leave no primary zone", () => {
    const headless: AuthoredEncounter = {
      ...ZONED,
      spawnZones: [{ id: "side", label: "the Side Door", primary: true, cap: 1, requiresFlag: "never-set", tiles: [{ col: 7, row: 0 }] }],
    };
    expect(() => stageEncounter(headless, [player("a")], { flags: {} })).toThrow(/none is primary/);
  });

  it("REGRESSION — an encounter that declares NO zones stages exactly as before", () => {
    const roster = [player("a"), player("b")];
    const staged = stageEncounter(AUTHORED, roster, { flags: { "side-door-intel": true } });
    expect(staged.battle.spawnZones).toEqual([]); // ⇒ the scene falls back to the campfire
    expect(roster.map((u) => u.pos)).toEqual([{ col: 2, row: 2 }, { col: 2, row: 3 }]); // authored spawns, index-mapped
  });
});
