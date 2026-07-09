/**
 * R1 (#115) — snapshot drift tripwires.
 *
 * The three hand-maintained snapshot field lists — `snapshotUnit`/`restoreUnit`
 * (`turn.ts`), `cloneOverworldEconomy` (`overworld-actions.ts`), and
 * `EntityRegistry.snapshot` (`entities.ts`) — historically drifted silently: a
 * new mutable field that nobody added to the list made undo **half-restore**
 * with no error (`Unit` gained `escaped`/`concealed`/`dugIn`/`standingOrder`/…
 * across D65–D84 and each had to be remembered by hand).
 *
 * These tests make that drift **fail loudly, by field name**:
 *  - every enumerable own-property of each snapshotted shape must be classified
 *    (snapshotted, or on the explicit deliberately-not-snapshotted allowlist) —
 *    a **new, unlisted field fails the classification test with its name**;
 *  - every snapshotted field round-trips through mutate → snapshot → re-mutate →
 *    restore, compared **per key** so a miscopied field also fails by name.
 *
 * When one of these fails: decide the new field's bucket, update the production
 * field list if it's mutable, and extend the lists here — in the same commit.
 *
 * Pure logic: no Phaser, no DOM.
 */
import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import { snapshotUnit, restoreUnit } from "./battle-undo";
import {
  createOverworldEconomy,
  cloneOverworldEconomy,
  type OverworldState,
} from "./overworld-state";
import { EntityRegistry, makeTrap, makeConcealedTrap } from "./entities";
import { EventBus } from "./event-bus";

// --- Unit — snapshotUnit / restoreUnit (battle-undo.ts) ----------------------

/**
 * The fields {@link snapshotUnit} captures (a logged action can change them, so
 * undo must restore them). Must match `UnitSnapshot` in `battle-undo.ts` exactly.
 */
const UNIT_SNAPSHOT_KEYS = [
  "pos",
  "hp",
  "ct",
  "alive",
  "side",
  "captured",
  "escaped",
  "standingOrder",
  "dugIn",
  "hidden",
  "concealed",
  "statuses",
  "counters",
  "cooldowns",
] as const;

type UnitSnapshotKey = (typeof UNIT_SNAPSHOT_KEYS)[number];

/**
 * The fields **deliberately not** snapshotted — the explicit allowlist that
 * distinguishes "mutable field missed" (a bug) from "immutable field correctly
 * skipped" (a decision). A new `Unit` field lands in **neither** bucket and
 * fails the classification test with its name.
 */
const UNIT_UNSNAPSHOTTED_KEYS = [
  // Immutable identity — set at creation, never reassigned.
  "id",
  "name",
  "jobId",
  // Job configuration — battle actions never change what jobs a unit holds.
  "primaryJob",
  "heldJobs",
  "loadoutSlots",
  // Base stats — combat reads them (deltas ride statuses / the gearStamp).
  "maxHp",
  "speed",
  "attack",
  "defense",
  "moveRange",
  "sightRadius",
  "attackRange",
  "awareness",
  "intelligence",
  // Progression — the current contract keeps earned XP/levels across undo (an
  // undone `placeTrap` refunds the kit, not the levels it granted).
  "level",
  "xp",
  "jobLevels",
  // Overworld-only state — combat never writes it (D29 for fatigue; D65 memory
  // is written by node events between battles).
  "fatigue",
  "memory",
  // Flags & anchors fixed for the whole battle.
  "isLord",
  "authored",
  "thief",
  "post",
  "role",
  // Loadout — equip/unequip is an overworld verb; the gearStamp is applied at
  // staging and reverted between battles, never by a logged combat action.
  "equipment",
  "gearStamp",
  // Stamped once at Battle construction (stampPassives), constant in-battle.
  "passives",
] as const;

/** A Unit with **every** declared field present as an enumerable own-property. */
function makeFullUnit(): Unit {
  const unit = createUnit({
    id: "u1",
    side: "player",
    pos: { col: 0, row: 0 },
    name: "Trip Wire",
    speed: 10,
    maxHp: 30,
    attack: 8,
    defense: 3,
    moveRange: 4,
    sightRadius: 6,
    attackRange: 2,
    jobId: "medic",
    primaryJob: "medic",
    heldJobs: ["medic"],
    jobLevels: { medic: { level: 2, xp: 5 } },
    loadoutSlots: 2,
    awareness: 3,
    intelligence: 2,
    fatigue: 1,
    level: 3,
    xp: 40,
    isLord: true,
    authored: true,
    thief: false,
    standingOrder: "hold", // also sets `post`
    role: "sapper",
    memory: { met: true },
    equipment: { weapon: "iron-sword" },
  });
  // The one field createUnit leaves unset (stamped later by gear-condition).
  unit.gearStamp = { stats: { attack: 1 } };
  return unit;
}

/**
 * Two distinct mutations per snapshotted field — `a` is the state the snapshot
 * captures, `b` overwrites it (in place where possible, to prove the snapshot
 * holds **copies**, not shared references). Keys must equal UNIT_SNAPSHOT_KEYS.
 */
const UNIT_MUTATIONS: Record<UnitSnapshotKey, { a: (u: Unit) => void; b: (u: Unit) => void }> = {
  pos: { a: (u) => (u.pos = { col: 3, row: 1 }), b: (u) => (u.pos = { col: 5, row: 2 }) },
  hp: { a: (u) => (u.hp = 7), b: (u) => (u.hp = 3) },
  ct: { a: (u) => (u.ct = 42), b: (u) => (u.ct = 88) },
  alive: { a: (u) => (u.alive = false), b: (u) => (u.alive = true) },
  side: { a: (u) => (u.side = "player"), b: (u) => (u.side = "enemy") },
  captured: { a: (u) => (u.captured = true), b: (u) => (u.captured = false) },
  escaped: { a: (u) => (u.escaped = true), b: (u) => (u.escaped = false) },
  standingOrder: { a: (u) => (u.standingOrder = "hold"), b: (u) => (u.standingOrder = "defend") },
  dugIn: { a: (u) => (u.dugIn = true), b: (u) => (u.dugIn = false) },
  hidden: { a: (u) => (u.hidden = true), b: (u) => (u.hidden = false) },
  concealed: { a: (u) => (u.concealed = true), b: (u) => (u.concealed = false) },
  statuses: {
    a: (u) => (u.statuses = [{ id: "guarded", name: "Guarded", duration: 2, data: { reduction: 4 } }]),
    // In place: edit the nested payload AND push — a shallow snapshot would alias both.
    b: (u) => {
      u.statuses[0].data!.reduction = 99;
      u.statuses.push({ id: "slowed", name: "Slowed", duration: 1 });
    },
  },
  counters: {
    a: (u) => (u.counters = { meter: 2 }),
    b: (u) => {
      u.counters.meter = 9;
      u.counters.extra = 1;
    },
  },
  cooldowns: {
    a: (u) => (u.cooldowns = { "med-heal": 120 }),
    b: (u) => {
      u.cooldowns["med-heal"] = 0;
      u.cooldowns.strike = 80;
    },
  },
};

describe("Unit snapshot tripwire (#115)", () => {
  it("every Unit field is classified — a new field must pick a bucket", () => {
    const unit = makeFullUnit();
    const snapshotted = new Set<string>(UNIT_SNAPSHOT_KEYS);
    const skipped = new Set<string>(UNIT_UNSNAPSHOTTED_KEYS);
    for (const key of Object.keys(unit)) {
      expect(
        snapshotted.has(key) || skipped.has(key),
        `Unit."${key}" is unclassified — if a logged action can change it, add it to ` +
          `snapshotUnit/restoreUnit (turn.ts) AND UNIT_SNAPSHOT_KEYS + UNIT_MUTATIONS here; ` +
          `if it is immutable in-battle, add it to UNIT_UNSNAPSHOTTED_KEYS with a reason (#115)`,
      ).toBe(true);
      expect(
        snapshotted.has(key) && skipped.has(key),
        `Unit."${key}" is in BOTH buckets — pick one`,
      ).toBe(false);
    }
    // No stale entries: every classified key must exist on a fully-populated Unit.
    const live = new Set(Object.keys(unit));
    for (const key of [...snapshotted, ...skipped]) {
      expect(live.has(key), `"${key}" is classified here but no longer a Unit field — drop it`).toBe(true);
    }
  });

  it("the mutation table covers exactly the snapshotted fields", () => {
    expect(Object.keys(UNIT_MUTATIONS).sort()).toEqual([...UNIT_SNAPSHOT_KEYS].sort());
  });

  it("snapshotUnit → restoreUnit round-trips every snapshotted field, by name", () => {
    const unit = makeFullUnit();
    for (const key of UNIT_SNAPSHOT_KEYS) UNIT_MUTATIONS[key].a(unit);
    const expected = Object.fromEntries(
      UNIT_SNAPSHOT_KEYS.map((key) => [key, structuredClone(unit[key])]),
    );
    const snap = snapshotUnit(unit);

    // Overwrite every field again — each mutation must actually change the value,
    // or the round-trip below would vacuously pass for that field.
    for (const key of UNIT_SNAPSHOT_KEYS) {
      UNIT_MUTATIONS[key].b(unit);
      expect(
        structuredClone(unit[key]),
        `UNIT_MUTATIONS."${key}".b did not change the field — fix the mutation pair`,
      ).not.toEqual(expected[key]);
    }

    restoreUnit(unit, snap);
    for (const key of UNIT_SNAPSHOT_KEYS) {
      expect(
        unit[key],
        `restoreUnit lost Unit."${key}" — snapshotUnit/restoreUnit (turn.ts) miss or miscopy it (#115)`,
      ).toEqual(expected[key]);
    }
  });
});

// --- OverworldState — cloneOverworldEconomy (overworld-actions.ts) ---------

/** Every OverworldState field; all are cloned (no allowlist — the shape is all-mutable). */
const ECONOMY_KEYS = [
  "cooldowns",
  "scouted",
  "campUses",
  "nodeFlags",
  "primedFlags",
  "interestPerStep",
  "debt",
  "protection",
  "influence",
  "restStreak",
] as const;

/** An economy with every field set away from its default. */
function makeFullEconomy(): OverworldState {
  const eco = createOverworldEconomy();
  eco.cooldowns.survey = 2;
  eco.scouted.n3 = 1;
  eco.campUses["cook-stew"] = 1;
  eco.nodeFlags["market-opened:n3"] = true;
  eco.primedFlags["savvy-barter"] = true;
  eco.interestPerStep = 3;
  eco.debt = 50;
  eco.protection = 1;
  eco.influence = 4;
  eco.restStreak = 2;
  return eco;
}

describe("OverworldState clone tripwire (#115)", () => {
  it("every economy field is listed — a new field must be added to the clone and here", () => {
    const keys = Object.keys(createOverworldEconomy());
    const listed = new Set<string>(ECONOMY_KEYS);
    for (const key of keys) {
      expect(
        listed.has(key),
        `OverworldState."${key}" is unlisted — add it to cloneOverworldEconomy ` +
          `(overworld-actions.ts) AND to ECONOMY_KEYS + makeFullEconomy here (#115)`,
      ).toBe(true);
    }
    for (const key of ECONOMY_KEYS) {
      expect(keys, `"${key}" is listed here but no longer an OverworldState field — drop it`).toContain(key);
    }
  });

  it("cloneOverworldEconomy copies every field, by name, deeply", () => {
    const eco = makeFullEconomy();
    // Every field must be non-default, or a dropped field would clone vacuously.
    const fresh = createOverworldEconomy();
    for (const key of ECONOMY_KEYS) {
      expect(eco[key], `makeFullEconomy leaves "${key}" at its default — set it`).not.toEqual(fresh[key]);
    }
    const copy = cloneOverworldEconomy(eco);
    for (const key of ECONOMY_KEYS) {
      expect(copy[key], `cloneOverworldEconomy drops "${key}" (#115)`).toEqual(eco[key]);
    }
    // Deep: mutating the original's nested records must not leak into the copy.
    eco.cooldowns.survey = 9;
    eco.scouted.n3 = 9;
    eco.campUses["cook-stew"] = 9;
    eco.nodeFlags.other = true;
    eco.primedFlags.other = true;
    expect(copy.cooldowns.survey).toBe(2);
    expect(copy.scouted.n3).toBe(1);
    expect(copy.campUses["cook-stew"]).toBe(1);
    expect(copy.nodeFlags.other).toBeUndefined();
    expect(copy.primedFlags.other).toBeUndefined();
  });
});

// --- Field entities — EntityRegistry.snapshot (entities.ts) ------------------

/** The mutable entity flags the registry snapshot captures (`EntityFlags`, entities.ts). */
const ENTITY_RESTORED_FLAGS = ["sprung", "revealed"] as const;

/**
 * Entity fields deliberately **not** in the snapshot: fixed at construction
 * (entities never move or change owner mid-battle) or behaviour, not state.
 */
const ENTITY_FIXED_KEYS = [
  "id",
  "pos",
  "owner",
  "materialId",
  "recoverable",
  "concealment",
  "onUnitEnterTile",
  "onUnitLeaveTile",
] as const;

describe("EntityRegistry snapshot tripwire (#115)", () => {
  it("every shipped entity field is classified — a new mutable flag must join the snapshot", () => {
    const shapes = {
      "makeTrap(RecoverableEntity)": makeTrap("t", { col: 1, row: 1 }, "player", 5),
      "makeConcealedTrap(ConcealedTrap)": makeConcealedTrap("c", { col: 2, row: 2 }, "enemy", 5, 3),
    };
    const restored = new Set<string>(ENTITY_RESTORED_FLAGS);
    const fixed = new Set<string>(ENTITY_FIXED_KEYS);
    for (const [shape, entity] of Object.entries(shapes)) {
      for (const key of Object.keys(entity)) {
        expect(
          restored.has(key) || fixed.has(key),
          `${shape}."${key}" is unclassified — if it mutates in-battle, add it to ` +
            `EntityFlags + EntityRegistry.snapshot/restore (entities.ts) AND ` +
            `ENTITY_RESTORED_FLAGS here; else add it to ENTITY_FIXED_KEYS (#115)`,
        ).toBe(true);
      }
    }
  });

  it("snapshot → restore round-trips membership and every flag, by name", () => {
    const registry = new EntityRegistry(new EventBus());
    const plain = makeTrap("plain", { col: 1, row: 1 }, "player", 5);
    const hidden = makeConcealedTrap("hidden", { col: 2, row: 2 }, "enemy", 5, 3);
    registry.register(plain);
    registry.register(hidden);
    const snap = registry.snapshot();

    // Flip every restored flag, drop one entity, add another.
    plain.sprung = true;
    hidden.sprung = true;
    hidden.revealed = true;
    registry.remove("plain");
    registry.register(makeTrap("late", { col: 3, row: 3 }, "player", 5));

    registry.restore(snap);
    expect(
      registry.all().map((e) => e.id).sort(),
      "restore must reconcile membership back to the checkpoint",
    ).toEqual(["hidden", "plain"]);
    expect(plain.sprung, `restore lost "sprung" (#115)`).toBe(false);
    expect(hidden.sprung, `restore lost "sprung" (#115)`).toBe(false);
    expect(hidden.revealed, `restore lost "revealed" (#115)`).toBe(false);
  });
});
