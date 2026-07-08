import { describe, it, expect } from "vitest";
import { recoverMaterials } from "./resolution";
import { makeTrap, makeConcealedTrap } from "./entities";
import { createInventory, countOf } from "./inventory";
import { createUnit, type Unit } from "./units";

/** A party member for the sweep gate (D82) — the Scout is trap-trained. */
function member(jobId: string, over: Partial<Parameters<typeof createUnit>[0]> = {}): Unit {
  return createUnit({
    id: `${jobId}-1`, side: "player", pos: { col: 0, row: 0 },
    speed: 10, maxHp: 20, attack: 5, defense: 1, moveRange: 4, sightRadius: 5,
    jobId: jobId as Parameters<typeof createUnit>[0]["jobId"],
    ...over,
  });
}

describe("Resolution material recovery (D13)", () => {
  it("on a win, recovers unsprung recoverable entities (incl. enemy salvage)", () => {
    const inv = createInventory(8);
    const unsprung = makeTrap("t1", { col: 2, row: 2 }, "player", 12);
    const sprung = makeTrap("t2", { col: 3, row: 3 }, "player", 12);
    sprung.sprung = true;
    const enemySnare = makeTrap("e1", { col: 5, row: 5 }, "enemy", 8); // salvage

    const result = recoverMaterials([unsprung, sprung, enemySnare], "player", inv);

    // Two unsprung kits recovered (yours + the enemy's salvage); the sprung one isn't.
    expect(result.recovered.sort()).toEqual(["trap-kit", "trap-kit"]);
    expect(countOf(inv, "trap-kit")).toBe(2);
  });

  it("recovers nothing on a loss or flee", () => {
    const inv = createInventory(8);
    const unsprung = makeTrap("t1", { col: 2, row: 2 }, "player", 12);
    expect(recoverMaterials([unsprung], "enemy", inv).recovered).toEqual([]);
    expect(recoverMaterials([unsprung], undefined, inv).recovered).toEqual([]);
    expect(countOf(inv, "trap-kit")).toBe(0);
  });

  it("never recovers a consumed (non-recoverable) material even unsprung", () => {
    const inv = createInventory(8);
    const rune = makeTrap("r1", { col: 1, row: 1 }, "player", 20, {
      materialId: "rune-reagent",
      recoverable: false,
    });
    expect(recoverMaterials([rune], "player", inv).recovered).toEqual([]);
    expect(countOf(inv, "rune-reagent")).toBe(0);
  });
});

describe("the snare sweep (D82) — a win clears the field, gated on a trap-trained survivor", () => {
  /** Two concealed enemy snares — one spotted, one still hidden — plus a sprung one. */
  function snareField() {
    const hidden = makeConcealedTrap("h", { col: 3, row: 1 }, "enemy", 22, 5);
    const spotted = makeConcealedTrap("s", { col: 4, row: 2 }, "enemy", 24, 5);
    spotted.revealed = true;
    const sprung = makeConcealedTrap("x", { col: 5, row: 3 }, "enemy", 24, 5);
    sprung.sprung = true;
    return [hidden, spotted, sprung];
  }

  it("a standing trap-trained survivor sweeps every unsprung snare — hidden or spotted alike", () => {
    const inv = createInventory(8);
    const result = recoverMaterials(snareField(), "player", inv, [member("scout")]);
    // Both unsprung snares sweep (no rooting around for the hidden one); sprung is spent.
    expect(result.swept).toBe(2);
    expect(result.recovered).toEqual(["trap-kit", "trap-kit"]);
    expect(countOf(inv, "trap-kit")).toBe(2);
  });

  it("no trap-trained member aboard → the snares stay in the dirt", () => {
    const inv = createInventory(8);
    const result = recoverMaterials(snareField(), "player", inv, [member("soldier"), member("hunter")]);
    expect(result.swept).toBe(0);
    expect(result.recovered).toEqual([]);
  });

  it("a downed or captured sweeper doesn't count — 'awake and able' means active", () => {
    const inv = createInventory(8);
    const downed = member("scout");
    downed.alive = false;
    const bound = member("scout", { id: "scout-2" });
    bound.captured = true;
    const result = recoverMaterials(snareField(), "player", inv, [downed, bound, member("soldier")]);
    expect(result.swept).toBe(0);
    expect(result.recovered).toEqual([]);
  });

  it("the sweep is win-only, like all recovery", () => {
    const inv = createInventory(8);
    expect(recoverMaterials(snareField(), "enemy", inv, [member("scout")]).swept).toBe(0);
    expect(countOf(inv, "trap-kit")).toBe(0);
  });

  it("the sweep rides alongside generic recovery, counted separately", () => {
    const inv = createInventory(8);
    const own = makeTrap("t1", { col: 2, row: 2 }, "player", 12); // recoverable=true
    const result = recoverMaterials([own, ...snareField()], "player", inv, [member("scout")]);
    expect(result.recovered).toHaveLength(3); // your kit + the two swept snares
    expect(result.swept).toBe(2); // only the snares count as swept
  });
});
