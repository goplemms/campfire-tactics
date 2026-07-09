import { describe, it, expect } from "vitest";
import { Battle } from "./turn";
import { createUnit, medicalHerbs, marketStock } from "./index";
import { TileGrid } from "./grid";

// #135 core-leak 2: the bribe side-flip used to be a render-side type-cast
// (`(foe as unknown as {side}).side = "player"`) — invisible to the log, replay and
// undo. It is now the logged `sway` action behind `Battle.bribe`.
function twoSideBattle(): { battle: Battle; foe: ReturnType<typeof createUnit>; noble: ReturnType<typeof createUnit> } {
  const noble = createUnit({ id: "noble", side: "player", pos: { col: 0, row: 0 }, name: "Liora", jobId: "noble", speed: 8, maxHp: 18, attack: 2, defense: 1, moveRange: 3, sightRadius: 4 });
  const foe = createUnit({ id: "foe", side: "enemy", pos: { col: 3, row: 0 }, name: "Brigand", jobId: "soldier", speed: 8, maxHp: 20, attack: 6, defense: 2, moveRange: 3, sightRadius: 4 });
  const battle = new Battle(new TileGrid(6, 6), [noble, foe]);
  return { battle, foe, noble };
}

describe("Battle.bribe (the logged sway verb)", () => {
  it("flips the enemy to the player side and emits unitSwayed with the briber", () => {
    const { battle, foe, noble } = twoSideBattle();
    const swayed: { unit: string; by?: string }[] = [];
    battle.bus.on("unitSwayed", ({ unit, by }) => swayed.push({ unit: unit.id, by: by?.id }));
    expect(foe.side).toBe("enemy");
    battle.bribe(foe, noble);
    expect(foe.side).toBe("player");
    expect(swayed).toEqual([{ unit: "foe", by: "noble" }]);
  });

  it("appends a `sway` action to the log (replay can reconstruct the defection)", () => {
    const { battle, foe, noble } = twoSideBattle();
    battle.bribe(foe, noble);
    const last = battle.log[battle.log.length - 1];
    expect(last).toEqual({ kind: "sway", target: "foe", unit: "noble" });
  });

  it("undo restores the pre-sway side (side is snapshotted)", () => {
    const { battle, foe, noble } = twoSideBattle();
    battle.beginUndo();
    battle.bribe(foe, noble);
    expect(foe.side).toBe("player");
    battle.undo();
    expect(foe.side).toBe("enemy");
  });
});

describe("core-owned item tables (medicalHerbs / marketStock)", () => {
  it("medicalHerbs are the three medical materials in registry order", () => {
    expect(medicalHerbs()).toEqual(["salve", "stimulant", "antidote"]);
  });
  it("marketStock is trap kits plus the medical herbs", () => {
    expect(marketStock()).toEqual(["trap-kit", "salve", "stimulant", "antidote"]);
  });
});
