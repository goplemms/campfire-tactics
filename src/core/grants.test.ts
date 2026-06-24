import { describe, it, expect } from "vitest";
import { createUnit, remember, type Unit, type UnitSpec } from "./units";
import type { RunState } from "./run";
import type { MapNode } from "./overworld";
import type { JobId } from "./jobs";
import {
  evalPredicate,
  eligibleGrants,
  applyGrant,
  type Predicate,
  type Grant,
  type PredicateCtx,
} from "./grants";

// Throwaway fixture job ids — never real class content; addHeldJob/jobLevel never
// resolve them through `getJob`, so a fake id cast to JobId is enough.
const TIER1 = "fixture-tier1" as JobId;
const TIER2 = "fixture-tier2" as JobId;

function unit(spec: Partial<UnitSpec> = {}): Unit {
  return createUnit({
    id: "u",
    side: "player",
    pos: { col: -1, row: -1 },
    speed: 10,
    maxHp: 24,
    attack: 8,
    defense: 2,
    moveRange: 4,
    sightRadius: 5,
    ...spec,
  });
}

function node(kind: MapNode["kind"], id = "n1"): MapNode {
  return { id, layer: 1, index: 0, kind, edges: [] } as MapNode;
}

function ctx(opts: { items?: Record<string, number>; nodeId?: string; node?: MapNode } = {}): PredicateCtx {
  const run = {
    inventory: { storageCap: 6, counts: opts.items ?? {} },
    mapNodeId: opts.nodeId ?? "current",
  } as unknown as RunState;
  return { run, node: opts.node };
}

const ALWAYS: Predicate = { kind: "all", of: [] }; // default-open base

describe("grant seam — predicates (D65)", () => {
  it("jobLevel gates on the unit's job level (the default prestige floor)", () => {
    const u = unit({ jobLevels: { [TIER1]: { level: 2, xp: 0 } } });
    expect(evalPredicate({ kind: "jobLevel", job: TIER1, min: 3 }, u, ctx())).toBe(false);
    expect(evalPredicate({ kind: "jobLevel", job: TIER1, min: 2 }, u, ctx())).toBe(true);
  });

  it("jobLevel reads 1 for an untrained job", () => {
    expect(evalPredicate({ kind: "jobLevel", job: TIER1, min: 2 }, unit(), ctx())).toBe(false);
    expect(evalPredicate({ kind: "jobLevel", job: TIER1, min: 1 }, unit(), ctx())).toBe(true);
  });

  it("charLevel gates on the character level", () => {
    const u = unit({ level: 4 });
    expect(evalPredicate({ kind: "charLevel", min: 5 }, u, ctx())).toBe(false);
    expect(evalPredicate({ kind: "charLevel", min: 4 }, u, ctx())).toBe(true);
  });

  it("holdsItem reads the run inventory (the Master-Seal pattern)", () => {
    const present = ctx({ items: { "master-seal": 1 } });
    expect(evalPredicate({ kind: "holdsItem", item: "master-seal" }, unit(), present)).toBe(true);
    expect(evalPredicate({ kind: "holdsItem", item: "absent" }, unit(), present)).toBe(false);
    expect(evalPredicate({ kind: "holdsItem", item: "x" }, unit(), ctx({ items: { x: 0 } }))).toBe(false);
  });

  it("atNode matches the supplied node, else run.mapNodeId", () => {
    expect(evalPredicate({ kind: "atNode", node: "guild" }, unit(), ctx({ nodeId: "guild" }))).toBe(true);
    expect(evalPredicate({ kind: "atNode", node: "guild" }, unit(), ctx({ nodeId: "road" }))).toBe(false);
    expect(evalPredicate({ kind: "atNode", node: "special" }, unit(), ctx({ node: node("event", "special") }))).toBe(true);
  });

  it("atNodeKind matches the node kind", () => {
    expect(evalPredicate({ kind: "atNodeKind", nodeKind: "event" }, unit(), ctx({ node: node("event") }))).toBe(true);
    expect(evalPredicate({ kind: "atNodeKind", nodeKind: "combat" }, unit(), ctx({ node: node("event") }))).toBe(false);
  });

  it("unitId matches identity (special prestige for select characters)", () => {
    const hero = unit({ id: "hero" });
    expect(evalPredicate({ kind: "unitId", id: "hero" }, hero, ctx())).toBe(true);
    expect(evalPredicate({ kind: "unitId", id: "other" }, hero, ctx())).toBe(false);
  });

  it("remembers reads the unit's memory bag (linked events)", () => {
    const u = unit();
    remember(u, "met-guild");
    expect(evalPredicate({ kind: "remembers", flag: "met-guild" }, u, ctx())).toBe(true);
    expect(evalPredicate({ kind: "remembers", flag: "never" }, u, ctx())).toBe(false);
  });

  it("all/any compose, and an empty all is default-open (true)", () => {
    expect(evalPredicate(ALWAYS, unit(), ctx())).toBe(true);
    expect(evalPredicate({ kind: "any", of: [] }, unit(), ctx())).toBe(false);

    const u = unit({ level: 5, jobLevels: { [TIER1]: { level: 3, xp: 0 } } });
    const floorAndLevel: Predicate = {
      kind: "all",
      of: [
        { kind: "jobLevel", job: TIER1, min: 3 },
        { kind: "charLevel", min: 5 },
      ],
    };
    expect(evalPredicate(floorAndLevel, u, ctx())).toBe(true);

    const eitherOr: Predicate = {
      kind: "any",
      of: [
        { kind: "charLevel", min: 99 },
        { kind: "unitId", id: "u" },
      ],
    };
    expect(evalPredicate(eitherOr, u, ctx())).toBe(true);
  });
});

describe("grant seam — eligibility + addHeldJob effect (D65)", () => {
  it("eligibleGrants filters by predicate", () => {
    const u = unit({ jobLevels: { [TIER1]: { level: 2, xp: 0 } } });
    const grants: Grant[] = [
      { when: { kind: "jobLevel", job: TIER1, min: 2 }, then: { kind: "addHeldJob", job: TIER2 } },
      { when: { kind: "jobLevel", job: TIER1, min: 5 }, then: { kind: "addHeldJob", job: TIER2 } },
    ];
    const eligible = eligibleGrants(u, grants, ctx());
    expect(eligible).toHaveLength(1);
    expect(eligible[0].when).toEqual({ kind: "jobLevel", job: TIER1, min: 2 });
  });

  it("addHeldJob is the breadth half — adds a held job, idempotently", () => {
    const u = unit({ jobId: "soldier" }); // heldJobs starts ["soldier"]
    const grant: Grant = { when: ALWAYS, then: { kind: "addHeldJob", job: TIER2 } };
    const run = {} as RunState;

    const res = applyGrant(grant, u, run);
    expect(res).toEqual({ kind: "addHeldJob", ok: true, job: TIER2 });
    expect(u.heldJobs).toContain(TIER2);

    applyGrant(grant, u, run); // idempotent — no duplicate
    expect(u.heldJobs.filter((j) => j === TIER2)).toHaveLength(1);
  });
});
