/**
 * **The launch-target resolver (step 3 of the playtest launcher).**
 *
 * Two things under test. The **fail-loud** contract, which the brief owes explicitly: an
 * unlaunchable target must refuse with a specific reason, never boot a blank board. And the
 * **route semantics** for expedition nodes, which is where the real design content sits — the
 * route determines which flags get earned, and the canonical-looking route is the unreliable one.
 *
 * Also pins the shape claim the brief names as the main design risk: the target descriptor holds
 * no draft state, so the launcher is a sibling of the draft rather than a field on it.
 *
 * Pure logic: no Phaser, no DOM.
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  resolveLaunchTarget,
  launchTargetLabel,
  levelTargets,
  nodeTargets,
  routesTo,
  preferredRoute,
  type LaunchTarget,
} from "./launch-target";
import { THE_RESCUE, SIDE_DOOR_INTEL } from "../core/the-rescue";
import { getNode, traverseRoute, runFlagBag, registerExpedition, type AuthoredEncounter } from "../core";
import { LEVELS } from "../content/levels";
import { injectContentNodes } from "../content/authored-nodes";

// The D116 injection seam the real boot runs (`main.ts`): The Rescue's finale body lives in
// content JSON, so importing the expedition registers the MAP while leaving the body absent.
beforeAll(() => { injectContentNodes(); });

const RESCUE_MAP = THE_RESCUE.map;

/** A minimal playable encounter — stands in for a converted editor draft. */
const draftEncounter = (): AuthoredEncounter => ({
  id: "draft-probe",
  name: "Draft Probe",
  cols: 6,
  rows: 6,
  blocked: [],
  playerSpawns: [{ col: 0, row: 0 }],
  enemies: [{ templateId: "bandit-thug", pos: { col: 4, row: 4 } }],
  objectives: [],
  reward: { gold: 10, materials: [], xp: 10 },
});

// ===========================================================================
// 1. The three target kinds resolve.
// ===========================================================================

describe("the three launch targets resolve", () => {
  it("a draft resolves from the encounter the CALLER supplies — no draft state in the descriptor", () => {
    const target: LaunchTarget = { kind: "draft" };
    // The whole descriptor is `{ kind: "draft" }`: it carries no board, no draft, no editor state.
    // That is the "sibling surface, not a draft field" shape the brief asked for.
    expect(Object.keys(target)).toEqual(["kind"]);
    const r = resolveLaunchTarget(target, { draftEncounter: draftEncounter() });
    expect(r.kind).toBe("encounter");
    expect(r.kind === "encounter" && r.encounter.id).toBe("draft-probe");
  });

  it("a content level resolves by id", () => {
    const r = resolveLaunchTarget({ kind: "level", levelId: "the-rescue" });
    expect(r.kind).toBe("encounter");
    expect(r.kind === "encounter" && r.encounter.id).toBe("the-rescue");
  });

  it("an expedition node resolves to an expedition + a route", () => {
    const r = resolveLaunchTarget({ kind: "node", expeditionId: THE_RESCUE.id, nodeId: "finale" });
    expect(r.kind).toBe("node");
    if (r.kind !== "node") throw new Error("unreachable");
    expect(r.expedition.id).toBe(THE_RESCUE.id);
    expect(r.route[0]).toBe(RESCUE_MAP.startId);
    expect(r.route[r.route.length - 1]).toBe("finale");
    expect(r.nodeId).toBe("finale");
  });

  it("every level is offerable, and every offered level resolves", () => {
    const targets = levelTargets();
    expect(targets.length).toBe(Object.keys(LEVELS).length);
    for (const t of targets) expect(() => resolveLaunchTarget(t)).not.toThrow();
  });

  it("every offered node resolves — the picker never lists a dead row", () => {
    const targets = nodeTargets(THE_RESCUE.id);
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) expect(() => resolveLaunchTarget(t)).not.toThrow();
  });

  it("labels are stable and name the thing", () => {
    expect(launchTargetLabel({ kind: "draft" })).toBe("Current draft");
    expect(launchTargetLabel({ kind: "level", levelId: "the-rescue" })).toContain("The Rescue");
    expect(launchTargetLabel({ kind: "node", expeditionId: "the-rescue", nodeId: "finale" })).toBe(
      "the-rescue → finale",
    );
  });
});

// ===========================================================================
// 2. FAIL LOUD — the brief owes this explicitly.
// ===========================================================================

describe("an unlaunchable target refuses, with a reason", () => {
  it("a draft target with no draft supplied", () => {
    expect(() => resolveLaunchTarget({ kind: "draft" })).toThrow(/no draft encounter supplied/);
  });

  it("an unplayable draft names the validation issues instead of booting a blank board", () => {
    const broken = { ...draftEncounter(), cols: 0, enemies: [] };
    expect(() => resolveLaunchTarget({ kind: "draft" }, { draftEncounter: broken })).toThrow(/not playable/);
  });

  it("an unknown level id, listing what exists", () => {
    const boom = () => resolveLaunchTarget({ kind: "level", levelId: "the-recsue" });
    expect(boom).toThrow(/no content level "the-recsue"/);
    expect(boom).toThrow(/the-rescue/); // names the real ids
  });

  it("an unregistered expedition", () => {
    expect(() => resolveLaunchTarget({ kind: "node", expeditionId: "no-such-exp", nodeId: "x" })).toThrow(
      /no registered expedition "no-such-exp"/,
    );
  });

  it("an unknown node id", () => {
    expect(() => resolveLaunchTarget({ kind: "node", expeditionId: THE_RESCUE.id, nodeId: "finaly" })).toThrow(
      /finaly/,
    );
  });

  it("a pinned route that is not a real forward walk", () => {
    const bad = (route: string[]) =>
      resolveLaunchTarget({ kind: "node", expeditionId: THE_RESCUE.id, nodeId: "finale", route });
    expect(() => bad([])).toThrow(/route is empty/);
    expect(() => bad(["sideDoor", "finale"])).toThrow(/must start at "start"/);
    expect(() => bad(["start", "finale"])).toThrow(/not a forward edge/);
    expect(() => bad(["start", "sideDoor"])).toThrow(/not the requested node/);
  });

  it("a valid pinned route is honoured verbatim", () => {
    const r = resolveLaunchTarget({
      kind: "node",
      expeditionId: THE_RESCUE.id,
      nodeId: "finale",
      route: ["start", "sideDoor", "finale"],
    });
    expect(r.kind === "node" && r.route).toEqual(["start", "sideDoor", "finale"]);
  });
});

// ===========================================================================
// 3. Route semantics — the route IS a flag lever, and the obvious one is unreliable.
// ===========================================================================

describe("route choice, and why the default avoids the canonical route", () => {
  it("the finale has TWO routes, and only one passes the intel-granting fight", () => {
    const routes = routesTo(RESCUE_MAP, "finale");
    expect(routes).toHaveLength(2);
    const viaSideDoor = routes.find((r) => r.includes("sideDoor"))!;
    const viaFrontal = routes.find((r) => r.includes("frontal"))!;
    expect(viaSideDoor).toEqual(["start", "sideDoor", "finale"]);
    expect(viaFrontal).toEqual(["start", "frontal", "finale"]);

    // `sideDoor` is the node whose authored body grants the intel — and it is a COMBAT, so
    // `traverseRoute` must WIN it with the auto-pilot for the flag to land. `frontal` is a rest.
    expect(getNode(RESCUE_MAP, "sideDoor").kind).toBe("combat");
    expect(getNode(RESCUE_MAP, "frontal").kind).toBe("rest");
    expect(getNode(RESCUE_MAP, "sideDoor").provides).toBe(SIDE_DOOR_INTEL);
  });

  it("preferredRoute picks the route with the FEWEST auto-played combats — the reproducible one", () => {
    // Reaching a state is the tool's job; re-earning it by winning a bot fight is not. The
    // launcher forces the flag instead (step 2's runFlagBag).
    expect(preferredRoute(RESCUE_MAP, "finale")).toEqual(["start", "frontal", "finale"]);
  });

  it("preferredRoute is a TOTAL order — the same target always resolves to the same walk", () => {
    const a = resolveLaunchTarget({ kind: "node", expeditionId: THE_RESCUE.id, nodeId: "finale" });
    const b = resolveLaunchTarget({ kind: "node", expeditionId: THE_RESCUE.id, nodeId: "finale" });
    expect(a.kind === "node" && a.route).toEqual(b.kind === "node" ? b.route : null);
    for (const nodeId of RESCUE_MAP.order) {
      expect(preferredRoute(RESCUE_MAP, nodeId)).toEqual(preferredRoute(RESCUE_MAP, nodeId));
    }
  });

  it("every preferred route is a real forward walk ending at its node", () => {
    for (const nodeId of RESCUE_MAP.order) {
      const route = preferredRoute(RESCUE_MAP, nodeId);
      expect(route, nodeId).toBeDefined();
      expect(route![0]).toBe(RESCUE_MAP.startId);
      expect(route![route!.length - 1]).toBe(nodeId);
      for (let i = 1; i < route!.length; i++) {
        expect(getNode(RESCUE_MAP, route![i - 1]).edges).toContain(route![i]);
      }
    }
  });

  it("the start node resolves to a one-hop route (nothing auto-played at all)", () => {
    expect(preferredRoute(RESCUE_MAP, "start")).toEqual(["start"]);
  });

  it("an unreachable node has no route and is not offered", () => {
    const orphaned = {
      ...RESCUE_MAP,
      nodes: { ...RESCUE_MAP.nodes, island: { id: "island", layer: 1, index: 9, kind: "rest" as const, edges: [] } },
      order: [...RESCUE_MAP.order, "island"],
    };
    expect(routesTo(orphaned, "island")).toEqual([]);
    expect(preferredRoute(orphaned, "island")).toBeUndefined();
    expect(nodeTargets(THE_RESCUE.id).some((t) => t.kind === "node" && t.nodeId === "island")).toBe(false);
  });
});

// ===========================================================================
// 4. COMPOSITION — the resolved route really walks, and step 2's flags reach the board.
// ===========================================================================

describe("a resolved node target actually walks, and forced flags reach staging", () => {
  it("lands positioned AT the finale, pre-resolution, without playing it", () => {
    const r = resolveLaunchTarget({ kind: "node", expeditionId: THE_RESCUE.id, nodeId: "finale" });
    if (r.kind !== "node") throw new Error("unreachable");
    const arrival = traverseRoute(r.expedition, r.route);
    expect(arrival.targetId).toBe("finale");
    expect(arrival.run.mapNodeId).toBe("finale");
    expect(arrival.run.over).toBe(false);
  });

  it("the reproducible route earns NO intel — so the side door is absent until forced", () => {
    const r = resolveLaunchTarget({ kind: "node", expeditionId: THE_RESCUE.id, nodeId: "finale" });
    if (r.kind !== "node") throw new Error("unreachable");
    const { run, loop } = traverseRoute(r.expedition, r.route);
    expect(run.flags[SIDE_DOOR_INTEL]).toBeUndefined(); // frontal is a rest — nothing granted

    loop.startEncounter();
    expect(loop.staged!.battle.spawnZones.map((z) => z.id)).toEqual(["front-gate"]);
  });

  it("forcing the flag on the walked run DOES union the side door in (steps 2+3 compose)", () => {
    const r = resolveLaunchTarget({ kind: "node", expeditionId: THE_RESCUE.id, nodeId: "finale" });
    if (r.kind !== "node") throw new Error("unreachable");
    const { run, loop } = traverseRoute(r.expedition, r.route);

    // What the launcher will do: validate the chosen ids, then set them on the walked run
    // BEFORE startEncounter, which reads run.flags at stage time.
    Object.assign(run.flags, runFlagBag([SIDE_DOOR_INTEL]));
    loop.startEncounter();

    expect(loop.staged!.battle.spawnZones.map((z) => z.id)).toEqual(["front-gate", "side-door"]);
  });
});

describe("a node whose body is not registered refuses BEFORE the walk (D116)", () => {
  it("names the node, the authoredId, and points at the injection seam", () => {
    // The real failure this prevents: The Rescue's finale body is injected from content JSON, so
    // an un-injected catalog previously walked the whole route and then died inside runEncounter
    // complaining about a "dangling id" — after building the state you wanted.
    const exp = registerExpedition({
      id: "dangling-probe",
      name: "Dangling Probe",
      seed: "probe",
      map: {
        seed: "probe",
        layers: 2,
        startId: "start",
        finalIds: ["fight"],
        order: ["start", "fight"],
        nodes: {
          start: { id: "start", layer: 0, index: 0, kind: "rest", edges: ["fight"] },
          fight: { id: "fight", layer: 1, index: 0, kind: "combat", edges: [], authoredId: "no-such-body" },
        },
      },
      encounters: {},
      bundle: { party: [], purse: 100, supplies: {}, storageCap: 6, difficultyId: "normal" },
    });

    const boom = () => resolveLaunchTarget({ kind: "node", expeditionId: exp.id, nodeId: "fight" });
    expect(boom).toThrow(/binds authoredId "no-such-body"/);
    expect(boom).toThrow(/injectContentNodes/);
  });

  it("…while a node with a resolvable body passes the same guard", () => {
    expect(() => resolveLaunchTarget({ kind: "node", expeditionId: THE_RESCUE.id, nodeId: "finale" })).not.toThrow();
  });
});
