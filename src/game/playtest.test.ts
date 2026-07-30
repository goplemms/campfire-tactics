/**
 * **The playtest kit registry (step 1 of the playtest launcher).**
 *
 * The load-bearing guard here is the **regression** block: the five shipped squads were
 * hand-built `UnitSpec[]` literals and are now *derived* from {@link PLAYTEST_KITS}. Three live
 * consumers ride their exact shape — the editor's soft-play picker, `#scene=…?party=<name>` and
 * `#level` — and `e2e-editor-playtest` selects `"Vanguard (5)"` **by value** and asserts it
 * fields 5 bodies. So the derivation must be byte-identical, not merely equivalent.
 *
 * Unit ids matter beyond identity: `resolveFrontTurn` breaks capture-order ties on
 * `a.id.localeCompare(b.id)`, so a renamed body could move a deploy outcome.
 *
 * Pure logic — no Phaser, no DOM (this module is thin glue over the core).
 */

import { describe, it, expect } from "vitest";
import {
  PLAYTEST_KITS,
  PLAYTEST_PARTIES,
  DEFAULT_PLAYTEST_PARTY,
  playtestPartyNames,
  getPartyKit,
  registerKits,
  buildPlaytest,
  type PartyKitDef,
} from "./playtest";
import { createUnit, unitHasCapability, getEquipment, primaryJobOf, type AuthoredEncounter } from "../core";

/** The stat block every body starts from — mirrored here so a drift in `BASE` fails loudly. */
const BASE = { speed: 11, maxHp: 26, attack: 8, defense: 3, moveRange: 4, sightRadius: 5, attackRange: 1 };

/** Exactly what `body(job, n)` used to build, key-for-key. */
const legacyBody = (job: string, n: number) => ({
  id: `test-${job}-${n}`,
  side: "player",
  pos: { col: 0, row: 0 },
  jobId: job,
  primaryJob: job,
  ...BASE,
});

// ===========================================================================
// 1. REGRESSION — the five shipped squads must not move.
// ===========================================================================

describe("REGRESSION — the five shipped squads derive byte-identical specs", () => {
  const SHIPPED: Record<string, ReturnType<typeof legacyBody>[]> = {
    "Standard (3)": [legacyBody("soldier", 1), legacyBody("hunter", 1), legacyBody("medic", 1)],
    "Vanguard (5)": [
      legacyBody("heavy-knight", 1),
      legacyBody("soldier", 1),
      legacyBody("hunter", 1),
      legacyBody("scout", 1),
      legacyBody("medic", 1),
    ],
    "Skirmishers (4)": [legacyBody("scout", 1), legacyBody("hunter", 1), legacyBody("hunter", 2), legacyBody("medic", 1)],
    "Infiltration (3)": [legacyBody("thief", 1), legacyBody("scout", 1), legacyBody("medic", 1)],
    "Solo (1)": [legacyBody("soldier", 1)],
  };

  for (const [name, expected] of Object.entries(SHIPPED)) {
    it(`${name} — same bodies, same ids, same order, same keys`, () => {
      expect(PLAYTEST_PARTIES[name]).toEqual(expected);
      // toEqual ignores key *order* but not key *presence*: pin the key set too, so an
      // accidental `jobLevels: undefined` (or a stray field) is caught rather than tolerated.
      expect(PLAYTEST_PARTIES[name].map((s) => Object.keys(s).sort())).toEqual(
        expected.map((s) => Object.keys(s).sort()),
      );
    });
  }

  it("the five keep their names, order and the default — the picker's public interface", () => {
    expect(playtestPartyNames().slice(0, 5)).toEqual([
      "Standard (3)",
      "Vanguard (5)",
      "Skirmishers (4)",
      "Infiltration (3)",
      "Solo (1)",
    ]);
    expect(DEFAULT_PLAYTEST_PARTY).toBe("Standard (3)");
    expect(PLAYTEST_PARTIES[DEFAULT_PLAYTEST_PARTY]).toBeDefined();
  });

  it("Vanguard (5) still fields exactly 5 — the count e2e-editor-playtest asserts", () => {
    expect(PLAYTEST_PARTIES["Vanguard (5)"]).toHaveLength(5);
  });

  it("every squad's name states its true body count", () => {
    // The names encode counts, so a kit edit that desyncs them would ship a lying picker.
    for (const [name, party] of Object.entries(PLAYTEST_PARTIES)) {
      const claimed = Number(/\((\d+)/.exec(name)?.[1]);
      expect(party).toHaveLength(claimed);
    }
  });
});

// ===========================================================================
// 2. The registry contract (D114) — keys off `.id`, lookup misses, fail-loud.
// ===========================================================================

describe("the kit registry follows the D114 registry shape", () => {
  it("every key is its record's own id — never a hand-duplicated literal", () => {
    for (const [key, kit] of Object.entries(PLAYTEST_KITS)) expect(key).toBe(kit.id);
  });

  it("getPartyKit returns undefined on a miss, not a throw", () => {
    expect(getPartyKit("Standard (3)")?.id).toBe("Standard (3)");
    expect(getPartyKit("no-such-kit")).toBeUndefined();
  });

  it("PLAYTEST_PARTIES covers exactly the kits — no orphan either way", () => {
    expect(Object.keys(PLAYTEST_PARTIES)).toEqual(Object.keys(PLAYTEST_KITS));
  });

  it("an unknown squad name fails LOUD, and names what was available", () => {
    const enc: AuthoredEncounter = {
      id: "kit-probe",
      name: "Kit Probe",
      cols: 6,
      rows: 6,
      blocked: [],
      playerSpawns: [{ col: 0, row: 0 }],
      enemies: [{ templateId: "bandit-thug", pos: { col: 4, row: 4 } }],
      objectives: [],
      reward: { gold: 10, materials: [], xp: 10 },
    };
    expect(() => buildPlaytest(enc, "Vangaurd (5)")).toThrow(/no party "Vangaurd \(5\)"/);
    expect(() => buildPlaytest(enc, "Vangaurd (5)")).toThrow(/Vanguard \(5\)/); // lists the real ones
  });
});

// ===========================================================================
// 3. The new declarable fields actually reach the built unit.
// ===========================================================================

describe("a kit can declare job levels, equipment and stats (the step-1 substance)", () => {
  it("the probe kit exists and is sized to the finale's primary-zone TILES, not its cap", () => {
    // 5 tiles / cap 6 — placement ignores the cap and stacks overflow on the last tile, so a
    // 6-body kit would start two bodies on one tile.
    expect(PLAYTEST_PARTIES["Finale probe (5)"]).toHaveLength(5);
  });

  it("job levels survive into the built unit (D39 → createUnit)", () => {
    const spec = PLAYTEST_PARTIES["Finale probe (5)"].find((s) => s.jobId === "thief")!;
    expect(spec.jobLevels).toEqual({ scout: { level: 5, xp: 0 }, thief: { level: 2, xp: 0 } });
    expect(createUnit(spec).jobLevels).toEqual({ scout: { level: 5, xp: 0 }, thief: { level: 2, xp: 0 } });
  });

  it("equipment survives, and every declared item is REGISTERED (not silently worthless)", () => {
    const geared = PLAYTEST_PARTIES["Finale probe (5)"].find((s) => s.equipment !== undefined)!;
    expect(createUnit(geared).equipment).toEqual(geared.equipment);
    for (const kit of Object.values(PLAYTEST_KITS)) {
      for (const b of kit.bodies) {
        for (const id of Object.values(b.equipment ?? {})) {
          // `equipmentDelta` skips an unknown id, so an unregistered item is a lie, not an error.
          expect(getEquipment(id as string), `unregistered equipment "${id}" in "${kit.id}"`).toBeDefined();
        }
      }
    }
  });

  it("stat overrides layer on BASE — declared keys win, undeclared keys keep the floor", () => {
    const t = PLAYTEST_PARTIES["Finale probe (5)"].find((s) => s.jobId === "thief")!;
    expect(t.speed).toBe(14); // overridden
    expect(t.moveRange).toBe(5); // overridden
    expect(t.defense).toBe(BASE.defense); // untouched → BASE
  });

  it("the probe kit can actually open the cells — a Thief, read off the effective primary", () => {
    // Only one job carries `lockpick: true`; without it the finale's sneaking route is unplayable.
    const units = PLAYTEST_PARTIES["Finale probe (5)"].map(createUnit);
    const pickers = units.filter((u) => unitHasCapability(u, "lockpick"));
    expect(pickers).toHaveLength(1);
    expect(primaryJobOf(pickers[0])).toBe("thief");
    expect(units.length - pickers.length).toBeGreaterThanOrEqual(2); // …and bodies left to distract
  });

  it("count expands in declaration order, numbering ids per job", () => {
    expect(PLAYTEST_PARTIES["Skirmishers (4)"].map((s) => s.id)).toEqual([
      "test-scout-1",
      "test-hunter-1",
      "test-hunter-2",
      "test-medic-1",
    ]);
  });

  it("ids are unique within every kit (the capture-order tiebreak reads them)", () => {
    for (const [name, party] of Object.entries(PLAYTEST_PARTIES)) {
      expect(new Set(party.map((s) => s.id)).size, `duplicate id in "${name}"`).toBe(party.length);
    }
  });
});

// ===========================================================================
// 4. Load-time validation — the registry refuses to ship a lying kit.
// ===========================================================================

describe("registerKits fails loud (validated at load, not at launch)", () => {
  // Drives the REAL registry builder — the same function that runs at module load — rather than
  // a restatement of its rules, so these cases fail if the implementation drifts.
  const build = (...kits: PartyKitDef[]) => () => registerKits(kits);

  it("refuses an empty kit", () => {
    expect(build({ id: "Empty", bodies: [] })).toThrow(/declares no bodies/);
  });

  it("refuses a zero/negative count", () => {
    expect(build({ id: "Zero", bodies: [{ job: "soldier", count: 0 }] })).toThrow(/count < 1/);
  });

  it("refuses an unregistered equipment id — the silent-typo class", () => {
    expect(build({ id: "Ghost", bodies: [{ job: "soldier", equipment: { weapon: "wayfarers-blade" } }] })).toThrow(
      /unknown item "wayfarers-blade"/,
    );
  });

  it("refuses a duplicate kit id", () => {
    expect(build({ id: "Twin", bodies: [{ job: "soldier" }] }, { id: "Twin", bodies: [{ job: "medic" }] })).toThrow(
      /duplicate kit id "Twin"/,
    );
  });

  it("accepts a valid kit, keyed off its id", () => {
    expect(Object.keys(registerKits([{ id: "Fine", bodies: [{ job: "soldier", count: 2 }] }]))).toEqual(["Fine"]);
  });

  it("the SHIPPED registry passes its own validation (it loaded, and every kit is non-empty)", () => {
    for (const kit of Object.values(PLAYTEST_KITS)) expect(kit.bodies.length).toBeGreaterThan(0);
  });
});
