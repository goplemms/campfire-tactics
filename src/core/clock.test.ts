import { describe, it, expect } from "vitest";
import { CTClock, ACT_COST, MOVE_COST, sideSeed, byReadiest, tickUntilReady, TURN_THRESHOLD } from "./clock";
import { EventBus } from "./event-bus";
import { createUnit, type Unit } from "./units";

function unit(id: string, speed: number, side: "player" | "enemy" = "player"): Unit {
  return createUnit({
    id,
    side,
    pos: { col: 0, row: 0 },
    speed,
    maxHp: 10,
    attack: 5,
    defense: 0,
    moveRange: 3,
    sightRadius: 4,
  });
}

describe("CTClock", () => {
  it("orders turns by Speed — the faster unit acts first and more often", () => {
    const fast = unit("fast", 20);
    const slow = unit("slow", 10);
    const clock = new CTClock([fast, slow]);

    // Fast reaches the threshold first.
    expect(clock.advanceToNextActor()).toBe(fast);
    clock.spend(fast, { acted: true });

    // Over a longer run, the fast unit takes roughly twice as many turns.
    let fastTurns = 0;
    let slowTurns = 0;
    for (let i = 0; i < 30; i++) {
      const actor = clock.advanceToNextActor();
      if (actor === fast) fastTurns++;
      else slowTurns++;
      clock.spend(actor!, { acted: true });
    }
    expect(fastTurns).toBeGreaterThan(slowTurns);
  });

  it("spends more CT for Act than for Move (movers come back up sooner)", () => {
    const u = unit("u", 10);
    u.ct = 100;
    const clock = new CTClock([u]);

    clock.spend(u, { acted: true });
    expect(u.ct).toBe(100 - ACT_COST);

    u.ct = 100;
    clock.spend(u, { moved: true });
    expect(u.ct).toBe(100 - MOVE_COST);
    expect(MOVE_COST).toBeLessThan(ACT_COST);
  });

  it("seeds initiative from each side's summed Speed (D11)", () => {
    const p1 = unit("p1", 12, "player");
    const p2 = unit("p2", 8, "player");
    const e1 = unit("e1", 20, "enemy");
    const units = [p1, p2, e1];

    // Sum, not average: the player fielded two units (12 + 8 = 20).
    expect(sideSeed(units, "player")).toBe(20);
    expect(sideSeed(units, "enemy")).toBe(20);

    const clock = new CTClock(units);
    clock.seedInitiative();
    expect(p1.ct).toBe(20);
    expect(p2.ct).toBe(20);
    expect(e1.ct).toBe(20);

    // From an equal seed, the fastest single unit (e1, Speed 20) acts first.
    expect(clock.advanceToNextActor()).toBe(e1);
  });

  it("resolves a scheduled effect at the correct CT and emits chargeResolved", () => {
    const u = unit("u", 10);
    const bus = new EventBus();
    const clock = new CTClock([u], bus);

    let resolvedAt = -1;
    const resolvedIds: string[] = [];
    bus.on("chargeResolved", ({ id }) => resolvedIds.push(id));

    // A charge of speed 25 fills 100 over exactly 4 ticks.
    clock.schedule({
      id: "frost",
      speed: 25,
      run: () => {
        resolvedAt = clock.time;
      },
    });
    expect(clock.pendingEffects()).toBe(1);

    clock.tick(); // gauge 25
    clock.tick(); // gauge 50
    clock.tick(); // gauge 75
    expect(resolvedAt).toBe(-1);
    clock.tick(); // gauge 100 → resolves
    expect(resolvedAt).toBe(4);
    expect(resolvedIds).toEqual(["frost"]);
    expect(clock.pendingEffects()).toBe(0);
  });

  // #149: a tile-mode charge (target + targetTile) arms a default target-moved fizzle; a homing
  // charge (no targetTile) resolves on the target wherever it moved. The clock owns the seam.
  it("a tile-mode charge whiffs (chargeFizzled) when the target leaves the captured tile", () => {
    const prey = unit("prey", 10, "enemy");
    prey.pos = { col: 3, row: 3 };
    const bus = new EventBus();
    const clock = new CTClock([prey], bus);
    let resolved = false;
    const fizzled: string[] = [];
    bus.on("chargeFizzled", ({ id }) => fizzled.push(id));

    clock.schedule({ id: "ground-shot", speed: 25, target: prey, targetTile: { col: 3, row: 3 }, run: () => { resolved = true; } });
    prey.pos = { col: 4, row: 3 }; // sidesteps before the charge fills
    for (let i = 0; i < 4; i++) clock.tick(); // 25·4 = 100

    expect(resolved).toBe(false); // whiffed — run never called
    expect(fizzled).toEqual(["ground-shot"]);
  });

  it("a tile-mode charge lands when the target holds the captured tile", () => {
    const prey = unit("prey", 10, "enemy");
    prey.pos = { col: 3, row: 3 };
    const clock = new CTClock([prey]);
    let resolved = false;
    clock.schedule({ id: "ground-shot", speed: 25, target: prey, targetTile: { col: 3, row: 3 }, run: () => { resolved = true; } });
    for (let i = 0; i < 4; i++) clock.tick();
    expect(resolved).toBe(true);
  });

  it("a unit-mode (homing) charge — no targetTile — resolves even after the target moves (Mend's shape)", () => {
    const ally = unit("ally", 10);
    ally.pos = { col: 3, row: 3 };
    const clock = new CTClock([ally]);
    let resolved = false;
    clock.schedule({ id: "mend", speed: 25, target: ally, run: () => { resolved = true; } }); // no targetTile → homing
    ally.pos = { col: 9, row: 9 }; // the ally repositions
    for (let i = 0; i < 4; i++) clock.tick();
    expect(resolved).toBe(true); // homed — follows the unit
  });
});

// The shared CT stepping engine (D63 unification, Phase 2) — the single comparator
// and tick-until-ready loop the one CTClock is built on (combat + the deploy front).
describe("shared clock engine", () => {
  it("byReadiest orders by CT desc, then Speed desc, then id", () => {
    const a = { id: "a", ct: 100, speed: 10 };
    const b = { id: "b", ct: 120, speed: 5 };
    const c = { id: "c", ct: 100, speed: 12 };
    const d = { id: "d", ct: 100, speed: 10 }; // ties a on ct+speed → id breaks it
    expect([a, b, c, d].sort(byReadiest).map((x) => x.id)).toEqual(["b", "c", "a", "d"]);
  });

  it("tickUntilReady advances until an actor crosses the threshold", () => {
    const actor = { ct: 0, speed: 30 };
    let ticks = 0;
    const ready = tickUntilReady(
      () => actor.ct >= TURN_THRESHOLD,
      () => true,
      () => {
        actor.ct += actor.speed;
        ticks += 1;
      },
    );
    expect(ready).toBe(true);
    expect(ticks).toBe(4); // 30·4 = 120 ≥ 100
  });

  it("tickUntilReady reports a stall when the timeline can't progress", () => {
    let ticked = false;
    const ready = tickUntilReady(
      () => false,
      () => false, // nothing can act
      () => { ticked = true; },
    );
    expect(ready).toBe(false);
    expect(ticked).toBe(false); // never even ticks
  });
});
