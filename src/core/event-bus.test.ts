import { describe, it, expect } from "vitest";
import { EventBus } from "./event-bus";
import { EntityRegistry, makeTrap, type FieldEntity } from "./entities";
import { createUnit, type Side, type Unit } from "./units";

function unit(id: string): Unit {
  return createUnit({
    id,
    side: "player",
    pos: { col: 0, row: 0 },
    speed: 10,
    maxHp: 10,
    attack: 5,
    defense: 0,
    moveRange: 3,
    sightRadius: 4,
  });
}

describe("EventBus", () => {
  it("delivers emitted events to subscribers", () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.on("turnStart", ({ unit }) => seen.push(unit.id));

    bus.emit("turnStart", { unit: unit("rook") });
    bus.emit("turnStart", { unit: unit("vale") });
    expect(seen).toEqual(["rook", "vale"]);
  });

  it("unsubscribes via the returned function", () => {
    const bus = new EventBus();
    let calls = 0;
    const off = bus.on("turnEnd", () => calls++);
    bus.emit("turnEnd", { unit: unit("a") });
    off();
    bus.emit("turnEnd", { unit: unit("a") });
    expect(calls).toBe(1);
  });

  it("isolates a throwing handler from the others", () => {
    const bus = new EventBus();
    let reached = false;
    bus.on("turnStart", () => {
      throw new Error("boom");
    });
    bus.on("turnStart", () => (reached = true));
    expect(() => bus.emit("turnStart", { unit: unit("a") })).not.toThrow();
    expect(reached).toBe(true);
  });
});

describe("EntityRegistry (the trivial trap seam)", () => {
  it("fires a registered entity when a unit enters its tile", () => {
    const bus = new EventBus();
    const registry = new EntityRegistry(bus);

    let sprung = 0;
    let forcedSeen: boolean | undefined;
    const trap: FieldEntity = {
      id: "trap-1",
      pos: { col: 2, row: 3 },
      onUnitEnterTile: ({ forced }) => {
        sprung++;
        forcedSeen = forced;
      },
    };
    registry.register(trap);

    const mover = unit("mover");
    // Enter a different tile — trap stays quiet.
    bus.emit("unitEnterTile", { unit: mover, tile: { col: 0, row: 0 } });
    expect(sprung).toBe(0);

    // Enter the trap's tile — it reacts.
    bus.emit("unitEnterTile", { unit: mover, tile: { col: 2, row: 3 } });
    expect(sprung).toBe(1);
    expect(forcedSeen).toBe(false);

    // Forced entry (D19) is flagged through to the entity.
    bus.emit("unitEnterTile", {
      unit: mover,
      tile: { col: 2, row: 3 },
      forced: true,
    });
    expect(sprung).toBe(2);
    expect(forcedSeen).toBe(true);

    expect(registry.at({ col: 2, row: 3 })).toEqual([trap]);
  });
});

describe("makeTrap (the first real field entity — Survivalist, D4)", () => {
  function foe(id: string, side: Side): Unit {
    return createUnit({
      id,
      side,
      pos: { col: 5, row: 5 },
      speed: 10,
      maxHp: 20,
      attack: 5,
      defense: 2,
      moveRange: 3,
      sightRadius: 4,
    });
  }

  it("springs once on an enemy entering the tile, dealing damage, then is spent", () => {
    const bus = new EventBus();
    const registry = new EntityRegistry(bus);
    registry.register(makeTrap("trap", { col: 5, row: 5 }, "player", 12));

    const damaged: number[] = [];
    bus.on("unitDamaged", ({ amount }) => damaged.push(amount));

    const enemy = foe("e", "enemy");
    bus.emit("unitEnterTile", { unit: enemy, tile: { col: 5, row: 5 } });
    expect(enemy.hp).toBe(8); // 20 - 12
    expect(damaged).toEqual([12]);

    // One-shot: a second entry does nothing.
    bus.emit("unitEnterTile", { unit: enemy, tile: { col: 5, row: 5 } });
    expect(enemy.hp).toBe(8);
    expect(damaged).toEqual([12]);
  });

  it("ignores the owning side (your own units don't trip your trap)", () => {
    const bus = new EventBus();
    const registry = new EntityRegistry(bus);
    registry.register(makeTrap("trap", { col: 5, row: 5 }, "player", 12));
    const ally = foe("a", "player");
    bus.emit("unitEnterTile", { unit: ally, tile: { col: 5, row: 5 } });
    expect(ally.hp).toBe(20);
  });
});
