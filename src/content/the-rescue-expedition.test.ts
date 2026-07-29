import { describe, it, expect, beforeEach } from "vitest";
import {
  THE_RESCUE,
  RESCUE_FINALE_ID,
  SIDE_DOOR_INTEL,
  SIDE_DOOR_ID,
  RunLoop,
  createRunFromExpedition,
  dumpRun,
  restoreRun,
  loadExpedition,
  validateExpedition,
  resolveAuthored,
  getAuthoredNode,
  clearInjectedNodes,
  registerExpedition,
  type AuthoredExpedition,
} from "../core";
import { LEVELS } from "./levels";
import { injectContentNodes } from "./authored-nodes";

// The D116 build/CI guard, run with injection LIVE (real content JSON → real core catalog):
// The Rescue's finale body is stored as `content/levels/the-rescue.json`, injected into core,
// and resolved + validated by the load pipeline. A broken variant must fail loud — the guard a
// dangling id or an unsatisfied flank prerequisite can never get past into a player's session.

describe("The Rescue expedition — injected finale + validated load pipeline (D116)", () => {
  beforeEach(() => clearInjectedNodes());

  it("ships NO inline bodies — the finale is resolved purely from the injected catalog", () => {
    expect(THE_RESCUE.encounters).toBeUndefined();
    expect(THE_RESCUE.map.nodes.finale.authoredId).toBe(RESCUE_FINALE_ID);
  });

  it("without injection, the load pipeline fails loud (injection is load-bearing)", () => {
    expect(() => loadExpedition(THE_RESCUE)).toThrow(/no encounter|is invalid/i);
  });

  it("injectContentNodes() carries the content JSON into core, and loadExpedition then passes", () => {
    const ids = injectContentNodes();
    expect(ids).toContain(RESCUE_FINALE_ID);
    // The injected body IS the glob-loaded, D98-validated level (one store, not a copy).
    expect(getAuthoredNode(RESCUE_FINALE_ID)).toBe(LEVELS[RESCUE_FINALE_ID]);
    expect(resolveAuthored(THE_RESCUE, RESCUE_FINALE_ID)).toBe(LEVELS[RESCUE_FINALE_ID]);
    expect(validateExpedition(THE_RESCUE)).toEqual([]);
    expect(() => loadExpedition(THE_RESCUE)).not.toThrow();
  });

  it("the finale's flank prerequisite is satisfied — the side-door provider sits upstream", () => {
    injectContentNodes();
    expect(THE_RESCUE.map.nodes.finale.requires).toBe(SIDE_DOOR_INTEL);
    expect(THE_RESCUE.map.nodes.sideDoor.provides).toBe(SIDE_DOOR_INTEL);
    expect(validateExpedition(THE_RESCUE)).toEqual([]); // provider reachable upstream of the finale
  });

  it("a dangling finale id fails loud even with the catalog injected (a typo can't ship)", () => {
    injectContentNodes();
    const broken: AuthoredExpedition = registerExpedition({
      ...THE_RESCUE,
      id: "the-rescue-typo",
      map: {
        ...THE_RESCUE.map,
        nodes: { ...THE_RESCUE.map.nodes, finale: { ...THE_RESCUE.map.nodes.finale, authoredId: "the-rescuu" } },
      },
    });
    expect(() => loadExpedition(broken)).toThrow(/the-rescuu/);
  });

  it("an unsatisfiable flank prerequisite fails loud (the provider removed)", () => {
    injectContentNodes();
    const broken: AuthoredExpedition = registerExpedition({
      ...THE_RESCUE,
      id: "the-rescue-no-provider",
      map: {
        ...THE_RESCUE.map,
        nodes: { ...THE_RESCUE.map.nodes, sideDoor: { ...THE_RESCUE.map.nodes.sideDoor, provides: undefined } },
      },
    });
    expect(() => loadExpedition(broken)).toThrow(new RegExp(`requires "${SIDE_DOOR_INTEL}"`));
  });
});

/**
 * D119 — the intel gate, end to end. Two wirings, neither sufficient alone: the map node's
 * `provides` only *validates* that the opportunity sits upstream (above); `grants.flag` on the
 * provider's authored **body** is what actually sets the run flag, and staging is what turns
 * that flag into a second spawn zone. This walks the whole chain on the real content.
 */
describe("The Rescue — the side-door intel gate (D118/D119)", () => {
  beforeEach(() => clearInjectedNodes());

  const finale = () => LEVELS[RESCUE_FINALE_ID];
  const sideZone = () => finale().spawnZones!.find((z) => z.id === "side-door")!;

  it("the provider node is a COMBAT node whose body carries the grant (the only flag write path)", () => {
    injectContentNodes();
    const node = THE_RESCUE.map.nodes.sideDoor;
    // A "rest" node cannot set a flag: `applyGrant` fires from `applyRewards`, i.e. on an
    // authored *combat* win. `provides` on a rest node would validate and grant nothing.
    expect(node.kind).toBe("combat");
    expect(node.authoredId).toBe(SIDE_DOOR_ID);
    expect(resolveAuthored(THE_RESCUE, SIDE_DOOR_ID)?.grants?.flag).toBe(SIDE_DOOR_INTEL);
  });

  it("the finale's side-door zone is gated on the SAME constant the provider grants", () => {
    injectContentNodes();
    // The flag bag is an untyped Record<string, boolean>, so a spelling slip between the JSON
    // and the TS constant fails **silently** (the zone simply never appears). Pin them equal.
    expect(sideZone().requiresFlag).toBe(SIDE_DOOR_INTEL);
    expect(resolveAuthored(THE_RESCUE, SIDE_DOOR_ID)?.grants?.flag).toBe(sideZone().requiresFlag);
  });

  it("the side zone is authored TIGHT — the doorway only, covering no lever", () => {
    // Load-bearing, not cosmetic (D119): `pullLever` carries no phase gate and the garrison is
    // frozen during deploy, so a zone drawn over `winch-wall` (17,6) would make the infiltration
    // seal a FREE turn-1 slam. Tight means reaching it costs a step onto unprotected ground.
    const zone = sideZone();
    expect(zone.tiles).toEqual([{ col: 18, row: 5 }]);
    expect(zone.cap).toBe(1);
    const levers = finale().levers ?? [];
    for (const lever of levers) {
      expect(zone.tiles.some((t) => t.col === lever.pos.col && t.row === lever.pos.row), `zone covers lever ${lever.id}`).toBe(false);
    }
    // …and the winch is genuinely off-zone but within a step or two (the trade, not a trek).
    const winch = levers.find((l) => l.id === "winch-wall")!;
    const d = Math.abs(winch.pos.col - zone.tiles[0].col) + Math.abs(winch.pos.row - zone.tiles[0].row);
    expect(d).toBe(2);
  });

  it("winning the provider sets the flag, and the finale then stages BOTH entrances", () => {
    injectContentNodes();
    const run = createRunFromExpedition(loadExpedition(THE_RESCUE));
    const loop = new RunLoop(run);

    expect(run.flags[SIDE_DOOR_INTEL]).toBeUndefined();
    loop.choose("sideDoor");
    loop.startEncounter();
    loop.beginBattle();
    // Clear the wall patrol outright — the graded classifier then reads `win`, and the win is
    // what fires `applyGrant`. (No AI walk: the flag path is what's under test, not combat.)
    for (const u of loop.staged!.battle.units) if (u.side === "enemy") u.alive = false;
    const result = loop.resolve();
    expect(result.result).toBe("win");
    expect(run.flags[SIDE_DOOR_INTEL]).toBe(true);

    loop.choose("finale");
    const battle = loop.startEncounter();
    expect(battle.spawnZones.map((z) => z.id)).toEqual(["front-gate", "side-door"]);
    // …and the party still defaults to the front gate, side door EMPTY (the move, not a swap).
    const front = battle.spawnZones.find((z) => z.id === "front-gate")!;
    const players = battle.units.filter((u) => u.side === "player" && !u.captured);
    expect(players.length).toBeGreaterThan(0);
    for (const u of players) expect(front.tiles.some((t) => t.col === u.pos.col && t.row === u.pos.row)).toBe(true);
  });

  it("skipping the provider degrades gracefully — the finale stages the front gate ALONE", () => {
    injectContentNodes();
    const run = createRunFromExpedition(loadExpedition(THE_RESCUE));
    const loop = new RunLoop(run);
    loop.choose("frontal");
    loop.playCurrentNode(); // the rest node — no fight, no grant
    loop.choose("finale");
    const battle = loop.startEncounter();
    expect(run.flags[SIDE_DOOR_INTEL]).toBeUndefined();
    expect(battle.spawnZones.map((z) => z.id)).toEqual(["front-gate"]);
    // No second zone ⇒ the entrance verb can never surface ⇒ D118's degradation, by construction.
    expect(battle.spawnZones.length).toBe(1);
  });

  it("the flag round-trips a repro dump, so a restored run stages the same zones", () => {
    injectContentNodes();
    const run = createRunFromExpedition(loadExpedition(THE_RESCUE));
    run.flags[SIDE_DOOR_INTEL] = true;
    run.mapNodeId = "finale";
    const before = new RunLoop(run).startEncounter().spawnZones;

    const restored = restoreRun(dumpRun(run)); // the full-fidelity capture (`test:e2e:repro`'s path)
    expect(restored.flags[SIDE_DOOR_INTEL]).toBe(true);
    const after = new RunLoop(restored).startEncounter().spawnZones;
    expect(after).toEqual(before); // same flags ⇒ byte-identical zones, not just the same count
    expect(after.map((z) => z.id)).toEqual(["front-gate", "side-door"]);
  });
});
