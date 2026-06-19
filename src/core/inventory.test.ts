import { describe, it, expect } from "vitest";
import {
  createInventory,
  addItem,
  removeItem,
  slotsUsed,
  slotsFree,
  canAdd,
  countOf,
  slotsFor,
  getMaterial,
  saleValueOf,
  MATERIALS,
} from "./inventory";

describe("inventory (slotted stacks, party-wide — D14)", () => {
  it("computes slots from slotCost and stackSize", () => {
    const trapKit = MATERIALS["trap-kit"]; // stackSize 1, slotCost 1
    expect(slotsFor(trapKit, 0)).toBe(0);
    expect(slotsFor(trapKit, 1)).toBe(1);
    expect(slotsFor(trapKit, 3)).toBe(3);

    // A hypothetical stacking material: 6/stack, 1 slot/stack.
    const arrows = { id: "a", name: "A", stackSize: 6, slotCost: 1, recoverable: true };
    expect(slotsFor(arrows, 6)).toBe(1);
    expect(slotsFor(arrows, 7)).toBe(2); // rounds up to 2 stacks
  });

  it("enforces the storage cap (the provisioning constraint, D6)", () => {
    const inv = createInventory(3);
    expect(addItem(inv, "trap-kit", 2)).toBe(true);
    expect(slotsUsed(inv)).toBe(2);
    expect(slotsFree(inv)).toBe(1);

    expect(canAdd(inv, "trap-kit", 1)).toBe(true);
    expect(canAdd(inv, "trap-kit", 2)).toBe(false); // would be 4 > cap 3
    expect(addItem(inv, "trap-kit", 2)).toBe(false); // refused
    expect(countOf(inv, "trap-kit")).toBe(2); // unchanged

    expect(addItem(inv, "trap-kit", 1)).toBe(true); // exactly fills the cap
    expect(slotsFree(inv)).toBe(0);
    expect(addItem(inv, "rune-reagent", 1)).toBe(false); // no room
  });

  it("removes carried items (placing them in Deployment)", () => {
    const inv = createInventory(6, { "trap-kit": 2 });
    expect(removeItem(inv, "trap-kit", 1)).toBe(true);
    expect(countOf(inv, "trap-kit")).toBe(1);
    expect(removeItem(inv, "trap-kit", 5)).toBe(false); // can't remove more than held
    expect(removeItem(inv, "trap-kit", 1)).toBe(true);
    expect(countOf(inv, "trap-kit")).toBe(0);
  });

  it("marks rune reagent as consumed (non-recoverable), trap kit as recoverable", () => {
    expect(getMaterial("trap-kit")!.recoverable).toBe(true);
    expect(getMaterial("rune-reagent")!.recoverable).toBe(false);
  });

  it("defines a sell-only valuables/loot class with pure gold value (D61)", () => {
    const v = getMaterial("valuables")!;
    expect(v.loot).toBe(true);
    expect(v.saleValue).toBeGreaterThan(0);
    // Pure value: no combat function (no damage, not medical).
    expect(v.damage).toBeUndefined();
    expect(v.medical).toBeUndefined();
  });

  it("gives functional materials a sale value too, and saleValueOf reads it (0 if none)", () => {
    expect(saleValueOf(MATERIALS["trap-kit"])).toBeGreaterThan(0);
    expect(saleValueOf(MATERIALS.salve)).toBeGreaterThan(0);
    // A hypothetical valueless material sells for 0 (not sellable).
    expect(saleValueOf({ id: "x", name: "X", stackSize: 1, slotCost: 1, recoverable: false })).toBe(0);
  });
});
