import { describe, it, expect } from "vitest";
import { createUnit, isActive, type Side, type Unit } from "./units";
import { TileGrid } from "./grid";
import { Battle, replay } from "./turn";
import { planEnemyTurn, edgeDistance, threatenedTiles } from "./ai";
import { STANDING_ORDERS, orderOf } from "./standing-orders";

function at(id: string, side: Side, col: number, row: number, over: Partial<Parameters<typeof createUnit>[0]> = {}): Unit {
  return createUnit({
    id, side, pos: { col, row },
    speed: 10, maxHp: 20, attack: 5, defense: 0, moveRange: 4, sightRadius: 8,
    ...over,
  });
}

describe("standing orders — the behavior registry (D81/D84)", () => {
  it("every transition target is a real record (the registry is closed)", () => {
    for (const def of Object.values(STANDING_ORDERS)) {
      if (def.onMeleeStruck) expect(STANDING_ORDERS[def.onMeleeStruck]).toBeDefined();
      if (def.onFoeWithin) expect(STANDING_ORDERS[def.onFoeWithin.next]).toBeDefined();
    }
  });

  it("orderOf reads the unit's record; unknown ids (the player-side defend) read undefined", () => {
    expect(orderOf(at("g", "enemy", 0, 0, { standingOrder: "hold" }))?.posture).toBe("hold");
    expect(orderOf(at("p", "player", 0, 0, { standingOrder: "defend" }))).toBeUndefined();
    expect(orderOf(at("u", "enemy", 0, 0))).toBeUndefined();
  });
});

describe("the flee posture — bolt for the map edge (D84)", () => {
  it("plans toward the nearest edge, never a fight", () => {
    const grid = new TileGrid(9, 5);
    const runner = at("r", "enemy", 4, 2, { standingOrder: "flee" });
    const foe = at("f", "player", 3, 2);
    const plan = planEnemyTurn(runner, [runner, foe], grid);
    expect(plan.target).toBeNull();
    // From centre (edge distance 2) his move-4 turn reaches an edge tile.
    expect(edgeDistance(grid, plan.destination)).toBe(0);
  });

  it("a fleeing unit threatens nothing — the danger read empties", () => {
    const grid = new TileGrid(9, 5);
    const runner = at("r", "enemy", 4, 2, { standingOrder: "flee" });
    const foe = at("f", "player", 3, 2);
    expect(threatenedTiles([runner, foe], grid, "player")).toEqual([]);
  });

  it("reaching an edge leaves the field: escaped, inactive, logged — and the exit wins the fight", () => {
    const grid = new TileGrid(9, 5);
    const runner = at("r", "enemy", 4, 2, { standingOrder: "flee" });
    const foe = at("f", "player", 0, 2);
    const battle = new Battle(grid, [runner, foe]);
    const events: string[] = [];
    battle.bus.on("unitEscaped", ({ unit }) => events.push(unit.id));
    battle.bus.on("unitDefeated", ({ unit }) => events.push(`defeated:${unit.id}`));

    battle.runPolicyTurn(runner);

    expect(runner.escaped).toBe(true);
    expect(runner.alive).toBe(true); // gone, not dead
    expect(isActive(runner)).toBe(false);
    expect(events).toEqual(["r"]); // an exit, never a defeat
    expect(battle.log.some((a) => a.kind === "escape")).toBe(true);
    // The lone survivor's exit ends the encounter as a player win.
    expect(battle.outcome()).toEqual({ over: true, winner: "player" });
  });

  it("replay reproduces the escape from the log", () => {
    const grid = new TileGrid(9, 5);
    const mk = () => [
      at("r", "enemy", 4, 2, { standingOrder: "flee", speed: 20 }),
      at("f", "player", 0, 2, { speed: 5 }),
    ];
    const battle = new Battle(grid, mk());
    battle.seed();
    const actor = battle.nextActor()!;
    expect(actor.id).toBe("r"); // the fast runner moves first
    battle.runPolicyTurn(actor);
    expect(battle.units.find((u) => u.id === "r")!.escaped).toBe(true);

    const rebuilt = replay(grid, mk(), battle.log);
    expect(rebuilt.units.find((u) => u.id === "r")!.escaped).toBe(true);
    expect(rebuilt.outcome()).toEqual({ over: true, winner: "player" });
  });
});

describe("transitions — events rewrite the order (D84)", () => {
  it("a MELEE blow breaks the skittish guard into flight (and undo takes it back)", () => {
    const grid = new TileGrid(9, 5);
    const guard = at("g", "enemy", 8, 2, { standingOrder: "hold-skittish", maxHp: 30 });
    const bruiser = at("b", "player", 7, 2);
    const battle = new Battle(grid, [guard, bruiser]);
    const moods: string[] = [];
    battle.bus.on("orderChanged", ({ unit, order }) => moods.push(`${unit.id}:${order}`));

    battle.beginUndo();
    battle.attack(bruiser, guard);
    expect(guard.standingOrder).toBe("flee");
    expect(moods).toEqual(["g:flee"]);
    // The whole moment is undoable — the panic rolls back with the blow.
    battle.undo();
    expect(guard.standingOrder).toBe("hold-skittish");
  });

  it("a RANGED hit does not spook him — melee means adjacent", () => {
    const grid = new TileGrid(9, 5);
    const guard = at("g", "enemy", 8, 2, { standingOrder: "hold-skittish", maxHp: 30 });
    const archer = at("a", "player", 5, 2, { attackRange: 3 });
    const battle = new Battle(grid, [guard, archer]);
    battle.attack(archer, guard);
    expect(guard.standingOrder).toBe("hold-skittish");
  });

  it("the wary guard is provoked by a foe pressing its post — and stays provoked (sticky)", () => {
    const grid = new TileGrid(10, 5);
    const guard = at("g", "enemy", 8, 2, { standingOrder: "hold-wary" });
    const foe = at("f", "player", 6, 2); // within the trigger range of the post
    const battle = new Battle(grid, [guard, foe]);

    battle.runPolicyTurn(guard);
    expect(guard.standingOrder).toBe("charge");

    // The foe backs way off — no bait-and-retreat reset.
    foe.pos = { col: 0, row: 4 };
    battle.runPolicyTurn(guard);
    expect(guard.standingOrder).toBe("charge");
  });

  it("an unprovoked wary guard keeps holding", () => {
    const grid = new TileGrid(10, 5);
    const guard = at("g", "enemy", 8, 2, { standingOrder: "hold-wary" });
    const foe = at("f", "player", 0, 2); // far beyond the trigger
    const battle = new Battle(grid, [guard, foe]);
    battle.runPolicyTurn(guard);
    expect(guard.standingOrder).toBe("hold-wary");
    expect(guard.pos).toEqual({ col: 8, row: 2 }); // held the post
  });
});
