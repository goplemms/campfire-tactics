import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import {
  VESSELS,
  mustGetVessel,
  createCaravan,
  caravanCapacity,
  slotsRemaining,
  assignMember,
  unassignMember,
  memberRefusal,
  lockGear,
  gearRefusal,
  unlockGear,
  loadSupply,
  loadPurse,
  committedMemberIds,
  committedGearIds,
  resetCaravan,
} from "./caravan";

let nextId = 0;
function unit(name: string): Unit {
  return createUnit({
    id: `${name}-${nextId++}`,
    side: "player",
    pos: { col: -1, row: -1 },
    name,
    jobId: "soldier",
    speed: 10,
    maxHp: 24,
    attack: 8,
    defense: 2,
    moveRange: 4,
    sightRadius: 5,
  });
}

describe("caravan — uniform slots capped at vessel capacity (D25)", () => {
  it("any character fits any slot, up to the vessel's capacity", () => {
    const c = createCaravan("c1", "scout-cart");
    expect(caravanCapacity(c)).toBe(VESSELS["scout-cart"].capacity);
    expect(slotsRemaining(c)).toBe(2);

    assignMember(c, unit("Rook"));
    assignMember(c, unit("Vale"));
    expect(c.party.length).toBe(2);
    expect(slotsRemaining(c)).toBe(0);
  });

  it("a non-combat pick genuinely consumes a slot a fighter could have taken", () => {
    const c = createCaravan("c1", "scout-cart");
    const chef = unit("Pip");
    const fighter = unit("Rook");
    assignMember(c, chef);
    assignMember(c, unit("Vale"));
    // Full now — the fighter is locked out: bringing the chef cost a warrior.
    expect(memberRefusal(c, fighter)).toMatch(/no free slots/i);
    expect(() => assignMember(c, fighter)).toThrow();
  });

  it("storage is a per-caravan property drawn from the vessel", () => {
    const cart = createCaravan("c1", "scout-cart");
    const train = createCaravan("c2", "supply-train");
    expect(cart.storageCap).toBe(mustGetVessel("scout-cart").storageCap);
    expect(train.storageCap).toBe(mustGetVessel("supply-train").storageCap);
    expect(train.storageCap).toBeGreaterThan(cart.storageCap);
  });
});

describe("caravan — the lock: no double-committed person/gear (D25/D26)", () => {
  it("a person committed to one caravan can't be loaded into a second", () => {
    const a = createCaravan("a", "supply-train");
    const b = createCaravan("b", "scout-cart");
    const rook = unit("Rook");
    assignMember(a, rook, [b]);

    expect(committedMemberIds([a, b]).has(rook.id)).toBe(true);
    expect(memberRefusal(b, rook, [a])).toMatch(/committed to another caravan/i);
    expect(() => assignMember(b, rook, [a])).toThrow();
  });

  it("a piece of gear can't be locked into two caravans (one good sword once)", () => {
    const a = createCaravan("a", "supply-train");
    const b = createCaravan("b", "scout-cart");
    lockGear(a, "enchanted-blade", [b]);

    expect(committedGearIds([a, b]).has("enchanted-blade")).toBe(true);
    expect(gearRefusal(b, "enchanted-blade", [a])).toMatch(/locked to another caravan/i);
    expect(() => lockGear(b, "enchanted-blade", [a])).toThrow();
  });

  it("unassigning / unlocking frees the person/gear for another caravan", () => {
    const a = createCaravan("a", "scout-cart");
    const b = createCaravan("b", "scout-cart");
    const rook = unit("Rook");
    assignMember(a, rook, [b]);
    expect(unassignMember(a, rook)).toBe(true);
    expect(memberRefusal(b, rook, [a])).toBeNull();

    lockGear(a, "sword", [b]);
    expect(unlockGear(a, "sword")).toBe(true);
    expect(gearRefusal(b, "sword", [a])).toBeNull();
  });

  it("can't assemble onto a dispatched caravan", () => {
    const c = createCaravan("c", "scout-cart");
    assignMember(c, unit("Rook"));
    c.dispatched = true;
    expect(memberRefusal(c, unit("Vale"))).toMatch(/dispatched/i);
    expect(gearRefusal(c, "sword")).toMatch(/dispatched/i);
  });
});

describe("caravan — purse, supplies and reset (D34)", () => {
  it("loadPurse floors and clamps; loadSupply accumulates", () => {
    const c = createCaravan("c", "scout-cart");
    loadPurse(c, 50.7);
    expect(c.purse).toBe(50);
    loadPurse(c, -5);
    expect(c.purse).toBe(0);

    loadSupply(c, "trap-kit", 2);
    loadSupply(c, "trap-kit", 1);
    expect(c.supplies["trap-kit"]).toBe(3);
  });

  it("resetCaravan returns it to empty/assembling", () => {
    const c = createCaravan("c", "scout-cart");
    assignMember(c, unit("Rook"));
    lockGear(c, "sword");
    loadSupply(c, "trap-kit", 1);
    loadPurse(c, 40);
    c.dispatched = true;

    resetCaravan(c);
    expect(c.party).toEqual([]);
    expect(c.gear).toEqual([]);
    expect(c.supplies).toEqual({});
    expect(c.purse).toBe(0);
    expect(c.dispatched).toBe(false);
  });
});
