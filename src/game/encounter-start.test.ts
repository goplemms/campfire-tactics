/**
 * **Encounter start** — the one value the Launch tab, the `#launch` link and the builder share.
 *
 * Under test: the link round-trips (what the Launch tab copies is what `#launch` boots), every
 * malformed lever refuses by name, and the build honours the party setup on both launch shapes —
 * a kit for a level, the arrival party for a node — with a node seed acting as the route salt.
 *
 * Pure logic: no Phaser, no DOM.
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  buildEncounterStart,
  defaultEncounterStart,
  describePartySetup,
  encounterStartQuery,
  formatUnitTweaks,
  launchTargetKey,
  parseEncounterStart,
  parseLaunchTargetKey,
  parseUnitTweaks,
  type EncounterStart,
} from "./encounter-start";
import { THE_HOLLOW_MILL } from "../core";
import { injectContentNodes } from "../content/authored-nodes";

beforeAll(() => { injectContentNodes(); });

const SUSTAIN = ["start", "e1", "camp2", "snares", "market", "wagon", "restCamp", "finale"];

describe("target keys", () => {
  it("round-trip every target shape and reject junk", () => {
    for (const key of ["draft", "level:the-rescue", "node:hollow-mill:finale"]) {
      expect(launchTargetKey(parseLaunchTargetKey(key)!)).toBe(key);
    }
    for (const bad of ["", "level:", "node:hollow-mill", "node:a:b:c", "scene:x"]) {
      expect(parseLaunchTargetKey(bad)).toBeUndefined();
    }
  });
});

describe("unit tweak text", () => {
  it("parses level, hp, a stat and a slot (an empty slot clears it), and formats back", () => {
    const units = parseUnitTweaks("rook.level=7; rook.weapon=wayfarer-blade\nedrin.hp=50; vale.speed=16; vale.armor=");
    expect(units).toEqual({
      rook: { level: 7, equipment: { weapon: "wayfarer-blade" } },
      edrin: { hpPct: 50 },
      vale: { stats: { speed: 16 }, equipment: { armor: "" } },
    });
    expect(parseUnitTweaks(formatUnitTweaks(units))).toEqual(units);
    expect(parseUnitTweaks("  ;  ")).toEqual({});
  });

  it("refuses a malformed entry, naming it", () => {
    expect(() => parseUnitTweaks("rook level 7")).toThrow(/tweak "rook level 7": expected unit.field=value/);
    expect(() => parseUnitTweaks("rook.level=high")).toThrow(/level needs a number/);
    expect(() => parseUnitTweaks("rook.luck=3")).toThrow(/unknown field "luck"/);
  });
});

describe("the #launch link", () => {
  it("round-trips a full start", () => {
    const start: EncounterStart = {
      target: { kind: "node", expeditionId: "hollow-mill", nodeId: "finale", route: SUSTAIN },
      kit: defaultEncounterStart().kit,
      flags: ["side-door-intel"],
      seed: "3",
      party: { level: 5, hpPct: 80, units: { rook: { level: 7, equipment: { weapon: "wayfarer-blade" } } } },
    };
    expect(parseEncounterStart(encounterStartQuery(start))).toEqual(start);
  });

  it("writes only what differs from the defaults", () => {
    const start = { ...defaultEncounterStart(), target: { kind: "level", levelId: "the-rescue" } as const };
    expect(encounterStartQuery(start)).toBe("target=level%3Athe-rescue");
  });

  it("refuses a missing or editor-only target, a stray route, a non-number and an unknown parameter", () => {
    expect(() => parseEncounterStart("level=5")).toThrow(/missing target/);
    expect(() => parseEncounterStart("target=draft")).toThrow(/only exists inside the editor/);
    expect(() => parseEncounterStart("target=level:the-rescue&route=a,b")).toThrow(/route only applies to a node/);
    expect(() => parseEncounterStart("target=level:the-rescue&level=five")).toThrow(/level must be a number/);
    expect(() => parseEncounterStart("target=level:the-rescue&lvl=5")).toThrow(/unknown parameter "lvl"/);
  });
});

describe("buildEncounterStart", () => {
  it("a level target fields the kit, re-levelled", () => {
    const { run, label } = buildEncounterStart({
      ...defaultEncounterStart(),
      target: { kind: "level", levelId: "the-rescue" },
      kit: "Vanguard (5)",
      party: { level: 4 },
    });
    expect(run.party).toHaveLength(5);
    expect(run.party.every((u) => u.level === 4)).toBe(true);
    expect(label).toMatch(/Vanguard \(5\)/);
  });

  it("a node target fields the arrival party, re-levelled and tweaked, flags forced on", () => {
    const { run } = buildEncounterStart({
      ...defaultEncounterStart(),
      target: { kind: "node", expeditionId: "hollow-mill", nodeId: "finale", route: SUSTAIN },
      flags: ["side-door-intel"],
      party: { level: 6, units: { sela: { level: 2, hpPct: 100 } } },
    });
    expect(run.mapNodeId).toBe("finale");
    expect(run.flags["side-door-intel"]).toBe(true);
    const sela = run.party.find((u) => u.id === "sela")!;
    expect(sela.level).toBe(2);
    expect(sela.hp).toBe(sela.maxHp);
    expect(run.party.filter((u) => u.id !== "sela").every((u) => u.level === 6)).toBe(true);
  });

  it("a node seed is the route salt: a whole number reaches the run, anything else refuses", () => {
    const node = { kind: "node", expeditionId: THE_HOLLOW_MILL.id, nodeId: "finale", route: SUSTAIN } as const;
    const salted = buildEncounterStart({ ...defaultEncounterStart(), target: node, seed: "7" });
    const plain = buildEncounterStart({ ...defaultEncounterStart(), target: node });
    expect(String(salted.run.seed)).not.toBe(String(plain.run.seed));
    expect(() => buildEncounterStart({ ...defaultEncounterStart(), target: node, seed: "probe" })).toThrow(/whole number/);
  });

  it("a tweak naming a unit the party doesn't have refuses, listing the party", () => {
    expect(() =>
      buildEncounterStart({
        ...defaultEncounterStart(),
        target: { kind: "level", levelId: "the-rescue" },
        party: { units: { nyx: { level: 3 } } },
      }),
    ).toThrow(/no party unit "nyx" \(party: test-soldier-1, test-hunter-1, test-medic-1\)/);
  });

  it("describes a setup for the status line", () => {
    expect(describePartySetup({})).toBe("party as is");
    expect(describePartySetup({ level: 5, hpPct: 100, units: { rook: { level: 7 } } })).toBe("level 5 · hp 100% · rook.level=7");
  });
});
