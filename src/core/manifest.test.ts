import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import { createCamp } from "./camp";
import { createInventory } from "./inventory";
import { projectManifest, itemEffect, campReadoutLine, campChipLine } from "./manifest";
import { MATERIALS } from "./inventory";
import type { RunState } from "./run";

function mkUnit(id: string): Unit {
  return createUnit({ id, side: "player", pos: { col: 0, row: 0 }, speed: 10, maxHp: 20, attack: 5, defense: 2, moveRange: 3, sightRadius: 6 });
}

function mkRun(party: Unit[], inv = createInventory(8), gold = 0): RunState {
  return { party, inventory: inv, camp: createCamp({ gold }) } as unknown as RunState;
}

describe("projectManifest (caravan inventory projection — pure read)", () => {
  it("reports caps, free slots and the purse", () => {
    const inv = createInventory(8, { "trap-kit": 2, salve: 3 });
    const m = projectManifest(mkRun([mkUnit("a"), mkUnit("b")], inv, 150));
    expect(m.partyCount).toBe(2);
    expect(m.storageCap).toBe(8);
    expect(m.storageUsed).toBe(3); // 2 trap-kit slots + 1 salve stack slot
    expect(m.storageFree).toBe(5);
    expect(m.purse).toBe(150);
  });

  it("threads the caravan's vessel label and party capacity when known", () => {
    const m = projectManifest(mkRun([mkUnit("a")]), { vesselLabel: "Wagon", partyCapacity: 5 });
    expect(m.vesselLabel).toBe("Wagon");
    expect(m.partyCapacity).toBe(5);
  });

  it("leaves vessel/capacity undefined on a guild-less boot", () => {
    const m = projectManifest(mkRun([mkUnit("a")]));
    expect(m.vesselLabel).toBeUndefined();
    expect(m.partyCapacity).toBeUndefined();
  });

  it("groups items by category and surfaces every known material (zero included)", () => {
    const inv = createInventory(8, { "trap-kit": 1 });
    const m = projectManifest(mkRun([mkUnit("a")], inv));
    const combat = m.groups.find((g) => g.title === "Combat consumables")!;
    const healing = m.groups.find((g) => g.title === "Healing")!;
    const valuables = m.groups.find((g) => g.title === "Valuables")!;
    expect(combat.items.map((i) => i.id)).toContain("trap-kit");
    expect(combat.items.map((i) => i.id)).toContain("rune-reagent");
    expect(healing.items.map((i) => i.id)).toEqual(["salve", "stimulant", "antidote"]);
    // Pure-value items shelve apart from the functional consumables.
    expect(valuables.items.map((i) => i.id)).toContain("valuables");
    expect(valuables.items.map((i) => i.id)).toContain("wild-herbs");

    const kit = combat.items.find((i) => i.id === "trap-kit")!;
    expect(kit.count).toBe(1);
    expect(kit.slots).toBe(1);
    expect(kit.recoverable).toBe(true);

    const stim = healing.items.find((i) => i.id === "stimulant")!;
    expect(stim.count).toBe(0); // surfaced even when not carried
    expect(stim.recoverable).toBe(false);
  });

  it("derives trap effect from material damage, and labels the herbs", () => {
    expect(itemEffect(MATERIALS["trap-kit"])).toBe(`Deployable trap · ${MATERIALS["trap-kit"].damage} dmg`);
    expect(itemEffect(MATERIALS.salve)).toMatch(/restores HP/);
    expect(itemEffect(MATERIALS.antidote)).toMatch(/cleanses/);
    expect(itemEffect(MATERIALS["rune-reagent"])).toMatch(/Rune/);
  });
});

describe("campChipLine (condensed tactical HUD readout)", () => {
  const run = mkRun([mkUnit("a")], createInventory(8, { "trap-kit": 2 }), 110);

  it("keeps the mid-mission essentials — purse, morale, storage", () => {
    const line = campChipLine(run);
    expect(line).toMatch(/Purse 110g/);
    expect(line).toMatch(/Morale/);
    expect(line).toMatch(/Storage 2\/8/);
  });

  it("drops the camp-time levers the full readout carries (Kits, RP, Upkeep)", () => {
    const chip = campChipLine(run);
    expect(chip).not.toMatch(/Kits/);
    expect(chip).not.toMatch(/RP/);
    expect(chip).not.toMatch(/Upkeep/);
    // The full line still carries them — the chip is a strict demotion, not a rename.
    const full = campReadoutLine(run);
    expect(full).toMatch(/Kits/);
    expect(full).toMatch(/Upkeep/);
  });

  it("prefixes the night when asked", () => {
    expect(campChipLine(run, { night: 3 })).toMatch(/^Night 3/);
  });
});
