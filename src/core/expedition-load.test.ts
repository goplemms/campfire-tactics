import { describe, it, expect, beforeEach } from "vitest";
import {
  injectAuthoredNodes,
  getAuthoredNode,
  injectedNodeIds,
  clearInjectedNodes,
  resolveAuthored,
  validateExpedition,
  prerequisiteProblems,
  loadExpedition,
  registerExpedition,
  createRunFromExpedition,
  runEncounter,
  type AuthoredEncounter,
  type AuthoredExpedition,
  type MapNode,
  type OverworldMap,
} from "./index";

// The D116 injection storage + load-pipeline guards: the injected catalog, resolve
// (inline OR injected, fail-loud on a miss), validate-only prerequisites (a provider
// reachable upstream on SOME path), acyclicity, and the runtime fail-loud that closes
// the resolver's silent-procedural-fallback hole.

/** A minimal encounter body — the pipeline checks *existence*, not body shape here. */
function body(id: string): AuthoredEncounter {
  return { id, name: id, cols: 3, rows: 3, blocked: [], playerSpawns: [{ col: 0, row: 0 }], enemies: [], reward: { gold: 1, materials: [], xp: 1 } };
}

function node(id: string, kind: MapNode["kind"], edges: string[], opts: Partial<MapNode> = {}): MapNode {
  return { id, layer: 0, index: 0, kind, edges, ...opts };
}

/** Assemble a well-formed-by-default map from a node list (order/layers filled in). */
function map(nodes: MapNode[], startId: string, finalIds: string[]): OverworldMap {
  const byId: Record<string, MapNode> = {};
  nodes.forEach((n) => (byId[n.id] = n));
  return { seed: "t", layers: nodes.length, nodes: byId, startId, finalIds, order: nodes.map((n) => n.id) };
}

function expedition(m: OverworldMap, extra: Partial<AuthoredExpedition> = {}): AuthoredExpedition {
  return {
    id: extra.id ?? "load-test-exp",
    name: "Load Test",
    seed: "t",
    map: m,
    bundle: { party: [], purse: 0, supplies: {}, storageCap: 4 },
    ...extra,
  };
}

beforeEach(() => clearInjectedNodes());

describe("the injected authored-node catalog (D116)", () => {
  it("injects, resolves, lists and clears bodies", () => {
    expect(getAuthoredNode("x")).toBeUndefined();
    const bx = body("x");
    injectAuthoredNodes({ x: bx });
    expect(getAuthoredNode("x")).toBe(bx);
    expect(injectedNodeIds()).toEqual(["x"]);
    clearInjectedNodes();
    expect(getAuthoredNode("x")).toBeUndefined();
  });

  it("is idempotent by reference but fails loud on a conflicting body for one id", () => {
    const bx = body("x");
    injectAuthoredNodes({ x: bx });
    expect(() => injectAuthoredNodes({ x: bx })).not.toThrow(); // same reference — no-op
    expect(() => injectAuthoredNodes({ x: body("x") })).toThrow(/conflicting bodies/); // different body
  });
});

describe("resolveAuthored — inline first, then the injected catalog (D116)", () => {
  it("prefers an inline body; falls back to the injected catalog; else undefined", () => {
    const inlineBody = body("a");
    const injected = body("b");
    injectAuthoredNodes({ a: body("a-injected"), b: injected });
    const exp = expedition(map([node("s", "rest", [])], "s", ["s"]), { encounters: { a: inlineBody } });
    expect(resolveAuthored(exp, "a")).toBe(inlineBody); // inline wins over injected
    expect(resolveAuthored(exp, "b")).toBe(injected); // injected fallback
    expect(resolveAuthored(exp, "c")).toBeUndefined(); // neither
  });
});

describe("the load pipeline — resolve (fail-loud on a dangling id) (D116)", () => {
  const m = () => map([node("s", "rest", ["f"]), node("f", "combat", [], { authoredId: "missing" })], "s", ["f"]);

  it("fails loud when an authoredId resolves to no body (inline or injected)", () => {
    const problems = validateExpedition(expedition(m()));
    expect(problems.some((p) => p.includes('authoredId "missing"'))).toBe(true);
    expect(() => loadExpedition(expedition(m()))).toThrow(/no body resolved|authoredId "missing"/);
  });

  it("resolves once the body is injected", () => {
    injectAuthoredNodes({ missing: body("missing") });
    expect(validateExpedition(expedition(m()))).toEqual([]);
    expect(() => loadExpedition(expedition(m()))).not.toThrow();
  });
});

describe("the load pipeline — validate-only prerequisites (D116)", () => {
  // start → [prov(provides F), other] → fin(requires F). Provider upstream on SOME path.
  const withProvider = () =>
    map(
      [
        node("start", "rest", ["prov", "other"]),
        node("prov", "rest", ["fin"], { provides: "F" }),
        node("other", "rest", ["fin"]),
        node("fin", "rest", [], { requires: "F" }),
      ],
      "start",
      ["fin"],
    );

  it("passes when a provider sits reachable upstream — and the skip-path stays valid (graceful fallback)", () => {
    expect(prerequisiteProblems(expedition(withProvider()))).toEqual([]);
    expect(validateExpedition(expedition(withProvider()))).toEqual([]); // the `other` skip-arm is fine
  });

  it("fails loud when no provider exists for a required flag", () => {
    const m = map([node("s", "rest", ["f"]), node("f", "rest", [], { requires: "F" })], "s", ["f"]);
    expect(prerequisiteProblems(expedition(m))).toEqual([
      expect.stringContaining('requires "F" but no provider'),
    ]);
  });

  it("fails loud when the only provider is DOWNSTREAM of the requiring node", () => {
    // start → fin(requires F) → prov(provides F): provider is not upstream.
    const m = map(
      [node("start", "rest", ["fin"]), node("fin", "rest", ["prov"], { requires: "F" }), node("prov", "rest", [], { provides: "F" })],
      "start",
      ["prov"],
    );
    expect(prerequisiteProblems(expedition(m)).length).toBe(1);
  });

  it("fails loud when the provider is PARALLEL (neither reaches the other)", () => {
    // start → [prov, fin]; prov → end, fin(requires F) → end. prov never reaches fin.
    const m = map(
      [
        node("start", "rest", ["prov", "fin"]),
        node("prov", "rest", ["end"], { provides: "F" }),
        node("fin", "rest", ["end"], { requires: "F" }),
        node("end", "rest", []),
      ],
      "start",
      ["end"],
    );
    expect(prerequisiteProblems(expedition(m)).length).toBe(1);
  });
});

describe("the load pipeline — acyclicity keeps the prereq 'upstream' check sound (D116 red-team)", () => {
  it("rejects a back-edge cycle — a provider reachable only through a loop is not genuinely upstream", () => {
    // start → A(requires F) → B(provides F) → A (back-edge). B reaches A only via the loop.
    const m = map(
      [node("start", "rest", ["A"]), node("A", "rest", ["B"], { requires: "F" }), node("B", "rest", ["A"], { provides: "F" })],
      "start",
      ["B"],
    );
    const problems = validateExpedition(expedition(m));
    expect(problems.some((p) => p.startsWith("cycle:"))).toBe(true);
  });
});

describe("runEncounter — fail-loud on an unresolved authored node (D116 red-team #1)", () => {
  it("throws rather than silently fabricating a procedural fight when the body is un-injected", () => {
    const m = map([node("s", "rest", ["f"]), node("f", "combat", [], { authoredId: "not-injected" })], "s", ["f"]);
    const exp = registerExpedition(expedition(m, { id: "fail-loud-exp" }));
    const run = createRunFromExpedition(exp);
    expect(() => runEncounter(run, exp.map.nodes.f)).toThrow(/no body resolved|not-injected/);
  });

  it("resolves cleanly once the injected catalog carries the body", () => {
    const m = map([node("s", "rest", ["f"]), node("f", "combat", [], { authoredId: "later-injected" })], "s", ["f"]);
    const exp = registerExpedition(expedition(m, { id: "resolve-exp" }));
    injectAuthoredNodes({ "later-injected": body("later-injected") });
    const run = createRunFromExpedition(exp);
    expect(runEncounter(run, exp.map.nodes.f)).toBe(getAuthoredNode("later-injected"));
  });
});
