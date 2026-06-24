import { describe, it, expect } from "vitest";
import { createUnit, remember, recalls, recall, forget, type Unit, type UnitSpec } from "./units";

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

describe("per-unit memory — the D65 run-scoped flag bag", () => {
  it("a fresh unit starts with an empty memory bag", () => {
    expect(unit().memory).toEqual({});
  });

  it("remember writes a flag (default true); recalls + recall read it back", () => {
    const u = unit();
    remember(u, "met-traveler");
    expect(recalls(u, "met-traveler")).toBe(true);
    expect(recall(u, "met-traveler")).toBe(true);
  });

  it("remember stores richer string/number values for linked state", () => {
    const u = unit();
    remember(u, "trust", 3);
    remember(u, "guild", "thieves");
    expect(recall(u, "trust")).toBe(3);
    expect(recall(u, "guild")).toBe("thieves");
    expect(recalls(u, "trust")).toBe(true);
  });

  it("an unwritten flag is not recalled; recall is undefined", () => {
    const u = unit();
    expect(recalls(u, "never")).toBe(false);
    expect(recall(u, "never")).toBeUndefined();
  });

  it("recalls is truthy-semantics; recall preserves a falsy stored value (presence)", () => {
    const u = unit();
    remember(u, "debt", 0);
    expect(recalls(u, "debt")).toBe(false); // 0 is falsy — the gate reads it as not-set
    expect(recall(u, "debt")).toBe(0); // but the value is genuinely stored
  });

  it("forget removes a flag (idempotent)", () => {
    const u = unit();
    remember(u, "flag");
    forget(u, "flag");
    expect(recalls(u, "flag")).toBe(false);
    expect(recall(u, "flag")).toBeUndefined();
    expect(() => forget(u, "flag")).not.toThrow(); // idempotent
  });

  it("createUnit seeds memory from the spec and clones it (no shared reference)", () => {
    const seed = { joined: true };
    const u = unit({ memory: seed });
    expect(recall(u, "joined")).toBe(true);
    // Mutating the unit's bag must not leak back into the authored spec.
    remember(u, "extra", 1);
    expect(seed).toEqual({ joined: true });
  });

  it("memory is per-unit — two units do not share a bag", () => {
    const a = unit({ id: "a" });
    const b = unit({ id: "b" });
    remember(a, "secret");
    expect(recalls(a, "secret")).toBe(true);
    expect(recalls(b, "secret")).toBe(false);
  });
});
