/**
 * **The known-run-flag registry (step 2 of the playtest launcher).**
 *
 * Two jobs here. First the registry contract + the fail-loud guard a tool calls on human input.
 * Second, and more valuable: a **drift guard**. The registry is a hand-declared list of literals,
 * so it can rot away from the content that actually uses flags. These tests walk the shipped
 * content and assert the two directions of coverage — every flag content *sets* is registered,
 * and every registered flag is one content actually names. A flag added to an encounter's grants
 * without a registry row would otherwise be invisible to the launcher's picker.
 *
 * Pure logic: no Phaser, no DOM, no `Math.random`.
 */

import { describe, it, expect } from "vitest";
import {
  RUN_FLAGS,
  getRunFlag,
  runFlagIds,
  isKnownRunFlag,
  assertKnownRunFlags,
  runFlagBag,
  registerRunFlags,
} from "./run-flags";
import { SIDE_DOOR_INTEL } from "./the-rescue";
import { LEVELS } from "../content/levels";

// ===========================================================================
// 1. The registry contract (D114).
// ===========================================================================

describe("the run-flag registry follows the D114 registry shape", () => {
  it("every key is its record's own id", () => {
    for (const [key, def] of Object.entries(RUN_FLAGS)) expect(key).toBe(def.id);
  });

  it("getRunFlag returns undefined on a miss, not a throw", () => {
    expect(getRunFlag("side-door-intel")?.label).toBe("Side-door intel");
    expect(getRunFlag("no-such-flag")).toBeUndefined();
  });

  it("every row is populated — a picker row with no label or provenance is useless", () => {
    for (const def of Object.values(RUN_FLAGS)) {
      expect(def.id, "id").toBeTruthy();
      expect(def.label, `label for ${def.id}`).toBeTruthy();
      expect(def.description, `description for ${def.id}`).toBeTruthy();
      expect(def.setBy, `setBy for ${def.id}`).toBeTruthy();
      expect(def.readBy, `readBy for ${def.id}`).toBeTruthy();
    }
  });

  it("registerRunFlags refuses a duplicate id and an empty id", () => {
    const row = { label: "l", description: "d", setBy: "s", readBy: "r" };
    expect(() => registerRunFlags([{ id: "a", ...row }, { id: "a", ...row }])).toThrow(/duplicate flag id "a"/);
    expect(() => registerRunFlags([{ id: "", ...row }])).toThrow(/empty id/);
  });
});

// ===========================================================================
// 2. Fail loud — the whole reason this module exists.
// ===========================================================================

describe("assertKnownRunFlags refuses what would otherwise fail silently", () => {
  it("accepts the known flags", () => {
    expect(() => assertKnownRunFlags({ "side-door-intel": true, "medic-freed": false })).not.toThrow();
    expect(() => assertKnownRunFlags({})).not.toThrow();
  });

  it("refuses a near-miss typo — the exact failure the zone filter cannot report", () => {
    // `buildSpawnZones` drops a gated zone when the flag is unset, so "side-door-inter" and
    // "flag absent" are indistinguishable there: the side door would simply never appear.
    expect(() => assertKnownRunFlags({ "side-door-inter": true })).toThrow(/unknown flag "side-door-inter"/);
  });

  it("names EVERY unknown key at once, and lists what was available", () => {
    const boom = () => assertKnownRunFlags({ nope: true, alsoNope: true });
    expect(boom).toThrow(/unknown flags "nope", "alsoNope"/);
    expect(boom).toThrow(/known: side-door-intel, medic-freed/);
  });

  it("carries the caller's context into the message", () => {
    expect(() => assertKnownRunFlags({ bad: true }, "launcher")).toThrow(/^launcher: unknown flag/);
  });

  it("isKnownRunFlag agrees with the registry, and is not fooled by prototype keys", () => {
    expect(isKnownRunFlag("side-door-intel")).toBe(true);
    expect(isKnownRunFlag("nope")).toBe(false);
    expect(isKnownRunFlag("toString")).toBe(false);
    expect(isKnownRunFlag("constructor")).toBe(false);
  });
});

describe("runFlagBag turns a choice into a validated StageOptions.flags bag", () => {
  it("sets exactly the ids given", () => {
    expect(runFlagBag([SIDE_DOOR_INTEL])).toEqual({ "side-door-intel": true });
    expect(runFlagBag([])).toEqual({});
  });

  it("throws on an unknown id rather than returning a bag that does nothing", () => {
    expect(() => runFlagBag(["side-door-intell"])).toThrow(/unknown flag/);
  });

  it("is idempotent on a repeated id", () => {
    expect(runFlagBag([SIDE_DOOR_INTEL, SIDE_DOOR_INTEL])).toEqual({ "side-door-intel": true });
  });
});

// ===========================================================================
// 3. DRIFT — the registry vs what content actually uses.
// ===========================================================================

describe("the registry does not drift from shipped content", () => {
  it("SIDE_DOOR_INTEL's constant equals the registered literal", () => {
    // The registry holds literals on purpose (importing the-rescue.ts here would drag its
    // module-load registerExpedition side effect along), so this is the pin that keeps them equal.
    expect(isKnownRunFlag(SIDE_DOOR_INTEL)).toBe(true);
    expect(SIDE_DOOR_INTEL).toBe("side-door-intel");
  });

  it("every flag a content level GRANTS is registered", () => {
    const granted = Object.values(LEVELS)
      .map((l) => l.grants?.flag)
      .filter((f): f is string => typeof f === "string");
    expect(granted.length).toBeGreaterThan(0); // the sweep must actually find something
    for (const flag of granted) {
      expect(isKnownRunFlag(flag), `level grants unregistered flag "${flag}"`).toBe(true);
    }
  });

  it("every flag a content level's spawn zone REQUIRES is registered", () => {
    const required = Object.values(LEVELS)
      .flatMap((l) => l.spawnZones ?? [])
      .map((z) => z.requiresFlag)
      .filter((f): f is string => typeof f === "string");
    expect(required.length).toBeGreaterThan(0);
    for (const flag of required) {
      expect(isKnownRunFlag(flag), `spawn zone requires unregistered flag "${flag}"`).toBe(true);
    }
  });

  it("the gated zone is genuinely reachable through the registry — set it and it unions in", () => {
    // Proves the registry's id is the *working* key, not merely a matching string.
    const rescue = LEVELS["the-rescue"];
    const gated = (rescue.spawnZones ?? []).filter((z) => z.requiresFlag !== undefined);
    expect(gated.length).toBeGreaterThan(0);
    for (const z of gated) expect(runFlagBag([z.requiresFlag!])[z.requiresFlag!]).toBe(true);
  });

  it("no registered flag is a stale invention — each is named by content or documented as observe-only", () => {
    const usedByContent = new Set<string>([
      ...Object.values(LEVELS).map((l) => l.grants?.flag),
      ...Object.values(LEVELS).flatMap((l) => (l.spawnZones ?? []).map((z) => z.requiresFlag)),
    ].filter((f): f is string => typeof f === "string"));
    for (const id of runFlagIds()) {
      // `medic-freed` is granted from TS (`hollow-mill.ts`), not a content JSON, and nothing gates
      // on it — so it is legitimately absent from the JSON sweep. Any OTHER unused id is drift.
      if (usedByContent.has(id)) continue;
      expect(["medic-freed"], `registered flag "${id}" is used nowhere`).toContain(id);
    }
  });
});
