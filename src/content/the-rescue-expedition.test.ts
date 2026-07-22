import { describe, it, expect, beforeEach } from "vitest";
import {
  THE_RESCUE,
  RESCUE_FINALE_ID,
  SIDE_DOOR_INTEL,
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
