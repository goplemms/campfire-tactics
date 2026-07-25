/**
 * The tag system (D117) — unit coverage of the mechanism + the three shipped tags.
 *
 * M1 ships the surface and its inhabitants; the behavioral proof (a garrison unit
 * peeling to the door only while not `in-combat`) is the M4 finale e2e, since the
 * only production consumer of `in-combat` is the M3 planner reorder. Here we prove
 * `hasTag` resolves each provenance correctly and `in-combat`'s five clauses each
 * independently gate. The Speed-anchored window (R2) lives in the caller's
 * `exchangedDamageSince` (the Battle's log scan), so it is exercised there (M2/M3),
 * not here — this suite drives that query as a stub.
 */
import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import {
  TAGS,
  getTag,
  hasTag,
  IN_COMBAT,
  NON_COMBATANT,
  GARRISON,
  type TagContext,
} from "./tags";

function unit(over: Partial<Parameters<typeof createUnit>[0]> & { id: string; side: "player" | "enemy" }): Unit {
  return createUnit({
    pos: { col: 0, row: 0 },
    speed: 10,
    maxHp: 20,
    attack: 6,
    defense: 2,
    moveRange: 4,
    sightRadius: 6,
    ...over,
  });
}

/** A TagContext with an explicit "who exchanged damage with whom" edge set. */
function ctxOf(units: Unit[], exchanged: Array<[string, string]> = []): TagContext {
  const has = (a: string, b: string) => exchanged.some(([x, y]) => x === a && y === b);
  return {
    units,
    // Symmetric: an exchange is mutual (dealt-or-received).
    exchangedDamageSince: (a, b) => has(a, b) || has(b, a),
  };
}

describe("tags — registry integrity (D114)", () => {
  it("every TAGS entry keys off its own id", () => {
    for (const [key, def] of Object.entries(TAGS)) expect(def.id).toBe(key);
  });

  it("getTag returns the def or undefined", () => {
    expect(getTag(IN_COMBAT)?.provenance).toBe("derived");
    expect(getTag(NON_COMBATANT)?.provenance).toBe("intrinsic");
    expect(getTag(GARRISON)?.provenance).toBe("intrinsic");
    expect(getTag("no-such-tag")).toBeUndefined();
  });

  it("derived tags carry a derive fn; intrinsic tags do not", () => {
    for (const def of Object.values(TAGS)) {
      if (def.provenance === "derived") expect(typeof def.derive).toBe("function");
      else expect(def.derive).toBeUndefined();
    }
  });
});

describe("tags — hasTag resolution", () => {
  it("intrinsic tags read Unit.tags", () => {
    const guard = unit({ id: "g", side: "enemy", tags: [GARRISON] });
    const captive = unit({ id: "c", side: "player", tags: [NON_COMBATANT] });
    const plain = unit({ id: "p", side: "player" });
    expect(hasTag(guard, GARRISON, ctxOf([guard]))).toBe(true);
    expect(hasTag(guard, NON_COMBATANT, ctxOf([guard]))).toBe(false);
    expect(hasTag(captive, NON_COMBATANT, ctxOf([captive]))).toBe(true);
    expect(hasTag(plain, GARRISON, ctxOf([plain]))).toBe(false);
  });

  it("intrinsic reads do not require a ctx", () => {
    const captive = unit({ id: "c", side: "player", tags: [NON_COMBATANT] });
    expect(hasTag(captive, NON_COMBATANT)).toBe(true);
  });

  it("an unknown tag id throws (fail-loud)", () => {
    const u = unit({ id: "u", side: "player" });
    expect(() => hasTag(u, "bogus", ctxOf([u]))).toThrow(/unknown tag/);
  });

  it("a derived tag without a ctx throws", () => {
    const u = unit({ id: "u", side: "player" });
    expect(() => hasTag(u, IN_COMBAT)).toThrow(/requires a TagContext/);
  });
});

describe("tags — in-combat (derived, five clauses)", () => {
  // Adjacent player U and enemy E that traded blows: the fully-satisfied baseline.
  const base = () => {
    const u = unit({ id: "u", side: "player", pos: { col: 1, row: 1 }, attack: 6, attackRange: 1 });
    const e = unit({ id: "e", side: "enemy", pos: { col: 2, row: 1 }, attack: 6 });
    return { u, e };
  };

  it("true when all five clauses hold", () => {
    const { u, e } = base();
    expect(hasTag(u, IN_COMBAT, ctxOf([u, e], [["u", "e"]]))).toBe(true);
  });

  it("clause 1 — no damage exchanged ⇒ false (proximity alone never engages)", () => {
    const { u, e } = base();
    expect(hasTag(u, IN_COMBAT, ctxOf([u, e], []))).toBe(false);
  });

  it("clause 2 — a captured/dead foe is not targetable ⇒ false", () => {
    const { u, e } = base();
    e.captured = true;
    expect(hasTag(u, IN_COMBAT, ctxOf([u, e], [["u", "e"]]))).toBe(false);
    e.captured = false;
    e.alive = false;
    expect(hasTag(u, IN_COMBAT, ctxOf([u, e], [["u", "e"]]))).toBe(false);
  });

  it("clause 3 — a non-combatant foe does not confer in-combat ⇒ false (R3)", () => {
    const { u, e } = base();
    (e as { tags: readonly string[] }).tags = [NON_COMBATANT];
    expect(hasTag(u, IN_COMBAT, ctxOf([u, e], [["u", "e"]]))).toBe(false);
  });

  it("clause 4 — a foe beyond striking distance ⇒ false", () => {
    const { u, e } = base();
    e.pos = { col: 5, row: 1 }; // 4 tiles away, attackRange 1
    expect(hasTag(u, IN_COMBAT, ctxOf([u, e], [["u", "e"]]))).toBe(false);
  });

  it("clause 4 — a ranged U reaches a distant foe ⇒ true", () => {
    const { u, e } = base();
    u.attackRange = 4;
    e.pos = { col: 5, row: 1 };
    expect(hasTag(u, IN_COMBAT, ctxOf([u, e], [["u", "e"]]))).toBe(true);
  });

  it("clause 5 — U with no attack cannot be in combat ⇒ false", () => {
    const { u, e } = base();
    u.attack = 0;
    expect(hasTag(u, IN_COMBAT, ctxOf([u, e], [["u", "e"]]))).toBe(false);
  });

  it("a captured/inactive U is never in combat", () => {
    const { u, e } = base();
    u.captured = true;
    expect(hasTag(u, IN_COMBAT, ctxOf([u, e], [["u", "e"]]))).toBe(false);
  });

  it("engages if ANY qualifying enemy matches (not all)", () => {
    const u = unit({ id: "u", side: "player", pos: { col: 1, row: 1 }, attackRange: 1 });
    const near = unit({ id: "near", side: "enemy", pos: { col: 2, row: 1 } }); // adjacent, traded
    const far = unit({ id: "far", side: "enemy", pos: { col: 8, row: 1 } }); // out of reach
    expect(hasTag(u, IN_COMBAT, ctxOf([u, near, far], [["u", "near"]]))).toBe(true);
  });

  it("an allied unit never counts (only enemies engage)", () => {
    const u = unit({ id: "u", side: "player", pos: { col: 1, row: 1 }, attackRange: 1 });
    const ally = unit({ id: "a", side: "player", pos: { col: 2, row: 1 } });
    expect(hasTag(u, IN_COMBAT, ctxOf([u, ally], [["u", "a"]]))).toBe(false);
  });
});
