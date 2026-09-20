import { describe, it, expect } from "vitest";
import { planEnemyTurn, reachableTiles, forecastEnemyAction, threatenedTiles } from "./ai";
import { Battle } from "./turn";
import { TileGrid } from "./grid";
import { isAdjacent } from "./combat";
import { applyStatus, immobilized } from "./status";
import { createUnit, type Side, type Unit } from "./units";
import { makeGate, applyGatesToGrid } from "./gates";

function at(id: string, side: Side, col: number, row: number, moveRange = 3): Unit {
  return createUnit({
    id,
    side,
    pos: { col, row },
    speed: 10,
    maxHp: 10,
    attack: 5,
    defense: 0,
    moveRange,
    sightRadius: 6,
  });
}

describe("planEnemyTurn", () => {
  it("moves toward the nearest enemy and attacks when it reaches adjacency", () => {
    const grid = new TileGrid(8, 1);
    const enemy = at("e", "enemy", 0, 0);
    const player = at("p", "player", 4, 0);
    const plan = planEnemyTurn(enemy, [enemy, player], grid);

    // From col 0 toward col 4: closes to col 3 (moveRange 3), adjacent to player.
    expect(plan.destination).toEqual({ col: 3, row: 0 });
    expect(plan.target).toBe(player);
    expect(isAdjacent(plan.destination, player.pos)).toBe(true);
    // Every step is a legal walkable tile.
    for (const step of plan.path) expect(grid.isWalkable(step)).toBe(true);
  });

  it("attacks without moving when already adjacent", () => {
    const grid = new TileGrid(8, 1);
    const enemy = at("e", "enemy", 3, 0);
    const player = at("p", "player", 4, 0);
    const plan = planEnemyTurn(enemy, [enemy, player], grid);
    expect(plan.path).toEqual([]);
    expect(plan.target).toBe(player);
  });

  it("picks the nearer of two enemies", () => {
    const grid = new TileGrid(10, 1);
    const enemy = at("e", "enemy", 5, 0);
    const near = at("near", "player", 7, 0);
    const far = at("far", "player", 0, 0);
    const plan = planEnemyTurn(enemy, [enemy, near, far], grid);
    expect(plan.target ?? near).toBe(near);
    expect(plan.destination).toEqual({ col: 6, row: 0 });
  });

  it("batters a destructible door when walled off from every foe (D103)", () => {
    // A 1-row corridor: the enemy at col 0, the player at col 4, a locked destructible door at col 2
    // sealing the only route. No terrain path exists → the guard closes on the door and breaks it.
    const grid = new TileGrid(5, 1);
    const door = makeGate("door", { col: 2, row: 0 }, [{ kind: "destructible", hp: 20 }]);
    applyGatesToGrid(grid, [door]); // blocks (2,0)
    const enemy = at("e", "enemy", 0, 0);
    const player = at("p", "player", 4, 0);
    const plan = planEnemyTurn(enemy, [enemy, player], grid, { gates: [door] });
    expect(plan.gateTarget?.id).toBe("door"); // targets the seal, not a (blocked) foe
    expect(plan.target).toBeNull();
    expect(plan.destination).toEqual({ col: 1, row: 0 }); // moved adjacent to the door to hit it
  });

  it("does NOT break a door it can simply walk around (the condition isn't always true)", () => {
    // The door at (2,1) blocks that tile, but rows 0 and 2 are open — a route around exists, so the
    // guard advances toward the foe and ignores the door entirely.
    const grid = new TileGrid(6, 3);
    const door = makeGate("door", { col: 2, row: 1 }, [{ kind: "destructible", hp: 20 }]);
    applyGatesToGrid(grid, [door]);
    const enemy = at("e", "enemy", 0, 1);
    const player = at("p", "player", 4, 1);
    const plan = planEnemyTurn(enemy, [enemy, player], grid, { gates: [door] });
    expect(plan.gateTarget).toBeUndefined(); // a path around exists → no door-break
  });

  // --- M2(c): the living-keyholder key-drive (D108) --------------------------

  it("a keyholder walled off from every foe KEYS its gate instead of battering", () => {
    const grid = new TileGrid(5, 1);
    const gate = makeGate("cell", { col: 2, row: 0 }, [{ kind: "keyholder", tag: { role: "captain" } }]);
    applyGatesToGrid(grid, [gate]); // blocks (2,0); the keyed gate isn't breakable
    const warden = { ...at("warden", "enemy", 0, 0), role: "captain" };
    const player = at("p", "player", 4, 0);
    const plan = planEnemyTurn(warden, [warden, player], grid, { gates: [gate] });
    expect(plan.gateTarget?.id).toBe("cell");
    expect(plan.gateAct).toBe("key");
    expect(plan.destination).toEqual({ col: 1, row: 0 }); // moved adjacent to turn the key
  });

  it("a NON-keyholder walled off by a keyed (non-breakable) gate has no gate drive", () => {
    const grid = new TileGrid(5, 1);
    const gate = makeGate("cell", { col: 2, row: 0 }, [{ kind: "keyholder", tag: { role: "captain" } }]);
    applyGatesToGrid(grid, [gate]);
    const grunt = at("g", "enemy", 0, 0); // no role → not the keyholder; the gate isn't breakable
    const player = at("p", "player", 4, 0);
    const plan = planEnemyTurn(grunt, [grunt, player], grid, { gates: [gate] });
    expect(plan.gateTarget).toBeUndefined();
  });

  it("a keyholder still BATTERS a breakable gate (gateAct 'attack')", () => {
    const grid = new TileGrid(5, 1);
    const door = makeGate("door", { col: 2, row: 0 }, [{ kind: "destructible", hp: 20 }]);
    applyGatesToGrid(grid, [door]);
    const warden = { ...at("warden", "enemy", 0, 0), role: "captain" };
    const player = at("p", "player", 4, 0);
    const plan = planEnemyTurn(warden, [warden, player], grid, { gates: [door] });
    expect(plan.gateTarget?.id).toBe("door");
    expect(plan.gateAct).toBe("attack"); // breakable + not keyholder-of it → batter, unchanged
  });

  it("a keyholder with a REACHABLE foe attacks it, not the gate (wallsOff false — no priority reorder yet)", () => {
    const grid = new TileGrid(5, 1);
    const gate = makeGate("cell", { col: 3, row: 0 }, [{ kind: "keyholder", tag: { role: "captain" } }]);
    applyGatesToGrid(grid, [gate]);
    const warden = { ...at("warden", "enemy", 0, 0), role: "captain" };
    const player = at("p", "player", 1, 0); // adjacent + reachable (not behind the gate)
    const plan = planEnemyTurn(warden, [warden, player], grid, { gates: [gate] });
    expect(plan.gateTarget).toBeUndefined(); // a reachable foe → no gate drive
    expect(plan.target).toBe(player);
  });

  it("runPolicyTurn: a walled-off Warden drives to the seal and keys it open (route revealed)", () => {
    const grid = new TileGrid(5, 1);
    const gate = makeGate("cell", { col: 2, row: 0 }, [{ kind: "keyholder", tag: { role: "captain" } }]);
    const warden = { ...at("warden", "enemy", 0, 0), role: "captain" };
    const player = at("p", "player", 4, 0);
    const battle = new Battle(grid, [warden, player], { gates: [gate] });
    battle.runPolicyTurn(warden);
    expect(gate.locked).toBe(false); // keyed open by the drive
    expect(grid.isWalkable({ col: 2, row: 0 })).toBe(true); // the route to the infiltrator is revealed
  });

  it("prefers attacking a reachable foe over a door (foe > door > advance)", () => {
    // The enemy is adjacent to both a foe and a destructible door; the foe wins (not walled off).
    const grid = new TileGrid(5, 1);
    const door = makeGate("door", { col: 0, row: 0 }, [{ kind: "destructible", hp: 20 }]);
    applyGatesToGrid(grid, [door]);
    const enemy = at("e", "enemy", 1, 0);
    const player = at("p", "player", 2, 0);
    const plan = planEnemyTurn(enemy, [enemy, player], grid, { gates: [door] });
    expect(plan.target).toBe(player);
    expect(plan.gateTarget).toBeUndefined();
  });

  it("C3: does NOT batter a destructible door that doesn't open a route to a foe", () => {
    // Column 2 is a solid PERMANENT wall (rows 0-2) — the foe at col 4 is terrain-unreachable no
    // matter what. The destructible door at (1,0) is in the guard's attack range but leads nowhere:
    // breaking it doesn't reveal a path (the wall, not the door, is the blocker). The guard must not
    // waste its turns on the irrelevant door.
    const grid = new TileGrid(5, 3, [{ col: 2, row: 0 }, { col: 2, row: 1 }, { col: 2, row: 2 }]);
    const door = makeGate("door", { col: 1, row: 0 }, [{ kind: "destructible", hp: 20 }]);
    applyGatesToGrid(grid, [door]);
    const enemy = at("e", "enemy", 1, 1);
    const player = at("p", "player", 4, 1);
    const plan = planEnemyTurn(enemy, [enemy, player], grid, { gates: [door] });
    expect(plan.gateTarget).toBeUndefined();
    // The probe restores the door's block — pathing still treats it (and the wall) as impassable.
    expect(grid.isWalkable({ col: 1, row: 0 })).toBe(false);
  });

  it("still batters the door when it IS the sole blocker between the guard and a foe (C3 keeps the good case)", () => {
    // Same shape, but now the destructible door at (2,0) is the only thing sealing the corridor —
    // rows 1-2 of col 2 are permanent wall, row 0 is the door. Opening it reveals the route → batter.
    const grid = new TileGrid(5, 3, [{ col: 2, row: 1 }, { col: 2, row: 2 }]);
    const door = makeGate("door", { col: 2, row: 0 }, [{ kind: "destructible", hp: 20 }]);
    applyGatesToGrid(grid, [door]);
    const enemy = at("e", "enemy", 0, 0);
    const player = at("p", "player", 4, 0);
    const plan = planEnemyTurn(enemy, [enemy, player], grid, { gates: [door] });
    expect(plan.gateTarget?.id).toBe("door");
  });

  // --- M3: the garrison door-drive as PRIMARY, `in-combat`-gated (D108/D117) ---
  // A garrison unit's objective seal outranks attacking a reachable, un-engaged foe; `in-combat` is the
  // sole off-switch. Every case here uses the SAME board with/without the `garrison` tag or the engaged
  // flag, so the branch's scope (garrison-only) and gate (`in-combat`) are pinned by contrast.

  // A hand-built TagContext (tags.ts's narrow query interface): `engaged` stubs clause-1 history.
  const ctx = (units: Unit[], engaged: boolean) => ({ units, exchangedDamageSince: () => engaged });
  // The Warden's seal (keyholder), off-lane foe, on a 5×3 board mirroring the harness shape.
  const driveBoard = () => {
    const grid = new TileGrid(5, 3);
    const seal = makeGate("seal", { col: 3, row: 1 }, [{ kind: "keyholder", tag: { role: "captain" } }]);
    applyGatesToGrid(grid, [seal]); // blocks (3,1)
    const foe = at("p", "player", 1, 0); // adjacent to the Warden at (1,1), reachable, OFF the seal lane
    return { grid, seal, foe };
  };
  const garrisonWarden = () => ({ ...at("warden", "enemy", 1, 1), role: "captain", tags: ["garrison"] });

  it("a garrison Warden keys its seal PAST a reachable un-engaged foe (primary drive, !in-combat)", () => {
    const { grid, seal, foe } = driveBoard();
    const warden = garrisonWarden();
    const plan = planEnemyTurn(warden, [warden, foe], grid, { gates: [seal], tagContext: ctx([warden, foe], false) });
    expect(plan.gateTarget?.id).toBe("seal");
    expect(plan.gateAct).toBe("key"); // drives to the door and turns the key…
    expect(plan.target).toBeNull(); // …ignoring the adjacent infiltrator (takes a free hit by design)
    expect(plan.destination).toEqual({ col: 2, row: 1 }); // adjacent to the seal
  });

  it("the SAME Warden `in-combat` stops and fights the engager (the off-switch)", () => {
    const { grid, seal, foe } = driveBoard();
    const warden = garrisonWarden();
    const plan = planEnemyTurn(warden, [warden, foe], grid, { gates: [seal], tagContext: ctx([warden, foe], true) });
    expect(plan.target).toBe(foe); // engaged → the normal fighting loop
    expect(plan.gateTarget).toBeUndefined();
  });

  it("a NON-garrison unit on the SAME board attacks the foe, ignores the seal (blast radius contained)", () => {
    const { grid, seal, foe } = driveBoard();
    const plain = { ...at("g", "enemy", 1, 1), role: "captain" }; // keyholder-role but NOT garrison-tagged
    const plan = planEnemyTurn(plain, [plain, foe], grid, { gates: [seal], tagContext: ctx([plain, foe], false) });
    expect(plan.target).toBe(foe); // generic AI: a reachable foe wins (wallsOff false → no gate drive)
    expect(plan.gateTarget).toBeUndefined();
  });

  it("a garrison guard BATTERS its breakable seal past a reachable un-engaged foe (gateAct 'attack')", () => {
    const grid = new TileGrid(5, 3);
    const door = makeGate("door", { col: 3, row: 1 }, [{ kind: "destructible", hp: 20 }]);
    applyGatesToGrid(grid, [door]);
    const guard = { ...at("guard", "enemy", 1, 1), tags: ["garrison"] }; // garrison, non-keyholder
    const foe = at("p", "player", 1, 0);
    const plan = planEnemyTurn(guard, [guard, foe], grid, { gates: [door], tagContext: ctx([guard, foe], false) });
    expect(plan.gateTarget?.id).toBe("door");
    expect(plan.gateAct).toBe("attack");
    expect(plan.target).toBeNull();
  });

  it("an IMMOBILIZED garrison Warden does not idle at the seal — it attacks the adjacent foe (F1 guard)", () => {
    const { grid, seal, foe } = driveBoard();
    const warden = garrisonWarden();
    applyStatus(warden, immobilized(2)); // can't drive → must fall through to the fighting loop
    const plan = planEnemyTurn(warden, [warden, foe], grid, { gates: [seal], tagContext: ctx([warden, foe], false) });
    expect(plan.target).toBe(foe);
    expect(plan.gateTarget).toBeUndefined();
    expect(plan.path).toEqual([]);
  });

  it("a garrison Warden under a `hold` order holds — the drive never overrides an explicit post", () => {
    const { grid, seal, foe } = driveBoard();
    const warden = { ...garrisonWarden(), standingOrder: "hold", post: { col: 1, row: 1 } };
    const plan = planEnemyTurn(warden, [warden, foe], grid, { gates: [seal], tagContext: ctx([warden, foe], false) });
    expect(plan.gateTarget).toBeUndefined(); // hold wins → no seal-drive
  });

  // --- M3b: control-room target-priority (D108/D117, Decision G) ---------------
  // A garrison unit prefers a foe INSIDE the control-room region. Geometry gives the *generic* AI a clear
  // reason to pick the OUT foe (it's adjacent — zero move) so the CR foe (a step away) only wins when the
  // control-room bonus overcomes that move penalty — the flip is the load-bearing proof. No gates here, so
  // a garrison unit falls straight through the M3 drive branch into this scoring loop.
  const twoFoeBoard = () => {
    const grid = new TileGrid(6, 1);
    const inCr = at("cr", "player", 1, 0); // inside the region, a step away from the enemy at (3,0)
    const outCr = at("out", "player", 4, 0); // outside it, ADJACENT to the enemy (generic AI prefers this)
    const region = { cols: [0, 2] as [number, number], rows: [0, 0] as [number, number] };
    return { grid, inCr, outCr, region };
  };

  it("a garrison unit targets the foe INSIDE the control room, overcoming the generic pull to the adjacent one", () => {
    const { grid, inCr, outCr, region } = twoFoeBoard();
    const guard = { ...at("guard", "enemy", 3, 0), tags: ["garrison"] };
    const plan = planEnemyTurn(guard, [guard, inCr, outCr], grid, { controlRoom: region });
    expect(plan.target).toBe(inCr); // the CR bonus beats the free adjacent hit on the out-of-room foe
  });

  it("the SAME garrison unit with NO region targets the adjacent foe (proves the bonus is load-bearing)", () => {
    const { grid, inCr, outCr } = twoFoeBoard();
    const guard = { ...at("guard", "enemy", 3, 0), tags: ["garrison"] };
    const plan = planEnemyTurn(guard, [guard, inCr, outCr], grid, {}); // no controlRoom
    expect(plan.target).toBe(outCr); // generic: the adjacent foe (no move) wins
  });

  it("a NON-garrison unit is unaffected by the region (blast radius contained)", () => {
    const { grid, inCr, outCr, region } = twoFoeBoard();
    const plain = at("g", "enemy", 3, 0); // no garrison tag → normal targeting
    const withRegion = planEnemyTurn(plain, [plain, inCr, outCr], grid, { controlRoom: region });
    const without = planEnemyTurn(plain, [plain, inCr, outCr], grid, {});
    expect(withRegion.target).toBe(outCr); // the region changes nothing for a generic unit…
    expect(without.target).toBe(outCr); // …it targets the adjacent foe either way
  });

  // --- #213: `non-combatant` target deprioritisation ---------------------------
  // The reading half of the tag (`tags.ts` promised it; nothing read it). Geometry again gives the
  // generic AI every reason to pick the prisoner — it is ADJACENT (zero move) *and* frail *and*
  // wounded, i.e. exactly what the squishy/lowHp weights chase — so the soldier a step away only
  // wins if `nonCombatantPenalty` outweighs all of that. The tag-on/tag-off pair is the proof.
  const escortBoard = (prisonerTags: string[], prisonerHp = 5) => {
    const grid = new TileGrid(6, 1);
    const prisoner = { ...at("wren", "player", 4, 0), tags: prisonerTags, hp: prisonerHp };
    const soldier = at("thane", "player", 1, 0); // a step away → the guard must spend movement
    const guard = { ...at("guard", "enemy", 3, 0), tags: ["garrison"] };
    return { grid, prisoner, soldier, guard };
  };

  it("deprioritizes a `non-combatant` — the guard walks past the adjacent prisoner to hit the soldier", () => {
    const { grid, prisoner, soldier, guard } = escortBoard(["non-combatant"]);
    const plan = planEnemyTurn(guard, [guard, prisoner, soldier], grid);
    expect(plan.target).toBe(soldier);
  });

  it("…and the SAME board with the tag removed targets the prisoner (the penalty is load-bearing)", () => {
    const { grid, prisoner, soldier, guard } = escortBoard([]); // untagged twin, identical stats
    const plan = planEnemyTurn(guard, [guard, prisoner, soldier], grid);
    expect(plan.target).toBe(prisoner);
  });

  it("still attacks a `non-combatant` when it is the ONLY foe in reach (a weight, not a ban)", () => {
    // `tags.ts` is explicit that a non-combatant "remains a valid *low-priority* target" — a guard
    // with nothing else to hit must not stand there idle.
    const { grid, prisoner, guard } = escortBoard(["non-combatant"]);
    const plan = planEnemyTurn(guard, [guard, prisoner], grid);
    expect(plan.target).toBe(prisoner);
  });

  it("even a KILLING blow on a prisoner loses to a plain swing at a soldier (penalty > lethalBonus)", () => {
    // The magnitude pin: at 1 hp the prisoner is a guaranteed kill (+lethalBonus 400) and maximally
    // wounded. Sizing the penalty *under* lethalBonus would flip this red — which is the whole
    // difference between "escort takes pot shots" (D118's thinned pursuit) and "escort gets picked off".
    const { grid, prisoner, soldier, guard } = escortBoard(["non-combatant"], 1);
    const plan = planEnemyTurn(guard, [guard, prisoner, soldier], grid);
    expect(plan.target).toBe(soldier);
  });

  it("does not move while immobilized but still attacks an adjacent foe", () => {
    const grid = new TileGrid(8, 1);
    const enemy = at("e", "enemy", 0, 0);
    const player = at("p", "player", 4, 0);
    applyStatus(enemy, immobilized(2));
    const plan = planEnemyTurn(enemy, [enemy, player], grid);
    expect(plan.path).toEqual([]);
    expect(plan.destination).toEqual({ col: 0, row: 0 });
    expect(plan.target).toBeNull();
  });

  it("stays put when there are no enemies left", () => {
    const grid = new TileGrid(8, 1);
    const enemy = at("e", "enemy", 2, 0);
    const plan = planEnemyTurn(enemy, [enemy], grid);
    expect(plan.path).toEqual([]);
    expect(plan.target).toBeNull();
  });
});

describe("reachableTiles (shared by the AI + the render-side move preview)", () => {
  const keys = (rs: { tile: { col: number; row: number } }[]) =>
    new Set(rs.map((r) => `${r.tile.col},${r.tile.row}`));

  it("floods every tile within the move budget, including the start tile", () => {
    const grid = new TileGrid(7, 7);
    const u = at("u", "player", 3, 3, 2);
    const reach = reachableTiles(u, [u], grid);
    const k = keys(reach);
    expect(k.has("3,3")).toBe(true); // start, cost 0
    expect(k.has("3,1")).toBe(true); // 2 straight up
    expect(k.has("2,2")).toBe(true); // 1 left + 1 up
    expect(k.has("3,0")).toBe(false); // 3 away — beyond a budget of 2
    // The Manhattan disc of radius 2 on an open board is 13 tiles.
    expect(reach.length).toBe(13);
  });

  it("routes *through* a friendly body (can't stop on it) but is blocked by a foe (D55)", () => {
    const grid = new TileGrid(7, 1);
    const u = at("u", "player", 0, 0, 5);
    const ally = at("a", "player", 2, 0); // a friendly body — passable, not a valid stop
    const base = keys(reachableTiles(u, [u, ally], grid));
    expect(base.has("1,0")).toBe(true);
    expect(base.has("2,0")).toBe(false); // occupied — can't stop here
    expect(base.has("3,0")).toBe(true); // passed *through* the ally to reach the far side
    expect(base.has("5,0")).toBe(true); // 5 tiles out, crossing the ally

    // An enemy body still blocks the lane outright.
    const foe = at("f", "enemy", 2, 0);
    const walled = keys(reachableTiles(u, [u, foe], grid));
    expect(walled.has("1,0")).toBe(true);
    expect(walled.has("3,0")).toBe(false); // can't pass through a foe

    // A Swift-style budget override only widens what the default flood would reach.
    const wide = keys(reachableTiles(u, [u], grid, 6));
    expect(wide.has("6,0")).toBe(true);
  });

  it("returns only the start tile when immobilized (budget 0)", () => {
    const grid = new TileGrid(5, 5);
    const u = at("u", "player", 2, 2, 3);
    applyStatus(u, immobilized(2));
    const reach = reachableTiles(u, [u], grid);
    expect(reach.length).toBe(1);
    expect(reach[0].tile).toEqual({ col: 2, row: 2 });
  });
});

describe("forecastEnemyAction", () => {
  it("telegraphs who an enemy will strike, from where, and for how much", () => {
    const grid = new TileGrid(8, 1);
    const enemy = at("e", "enemy", 0, 0); // atk 5
    const player = at("p", "player", 4, 0); // def 0, hp 10
    const intent = forecastEnemyAction(enemy, [enemy, player], grid);
    expect(intent?.target).toBe(player);
    expect(intent?.destination).toEqual({ col: 3, row: 0 }); // closes to adjacency
    expect(intent?.damage).toBe(5);
    expect(intent?.lethal).toBe(false);
  });

  it("flags a lethal incoming strike", () => {
    const grid = new TileGrid(8, 1);
    const enemy = at("e", "enemy", 3, 0);
    const player = createUnit({ id: "p", side: "player", pos: { col: 4, row: 0 }, speed: 10, maxHp: 4, attack: 5, defense: 0, moveRange: 3, sightRadius: 6 });
    expect(forecastEnemyAction(enemy, [enemy, player], grid)?.lethal).toBe(true);
  });

  it("returns null when the enemy would only advance (no target in reach)", () => {
    const grid = new TileGrid(12, 1);
    const enemy = at("e", "enemy", 0, 0, 2); // move 2 — can't reach
    const player = at("p", "player", 10, 0);
    expect(forecastEnemyAction(enemy, [enemy, player], grid)).toBeNull();
  });

  it("does not permanently move the enemy", () => {
    const grid = new TileGrid(8, 1);
    const enemy = at("e", "enemy", 0, 0);
    const player = at("p", "player", 4, 0);
    forecastEnemyAction(enemy, [enemy, player], grid);
    expect(enemy.pos).toEqual({ col: 0, row: 0 });
  });
});

describe("threatenedTiles", () => {
  it("marks every tile a pinned melee enemy could strike", () => {
    const grid = new TileGrid(8, 3);
    const enemy = at("e", "enemy", 3, 0, 0); // moveRange 0 → strikes from its own tile only
    const keys = new Set(threatenedTiles([enemy], grid, "player").map((t) => `${t.col},${t.row}`));
    // the diamond within attack range 1 of (3,0), clipped to the board
    expect([...keys].sort()).toEqual(["2,0", "3,0", "3,1", "4,0"]);
  });

  it("is empty when the victim side has no enemies", () => {
    const grid = new TileGrid(8, 3);
    const ally = at("a", "player", 3, 0, 0);
    expect(threatenedTiles([ally], grid, "player")).toEqual([]);
  });
});

describe("standing order: hold — the leashed guard (D81)", () => {
  /** A holder anchored to its creation tile (createUnit sets `post` from the spec pos). */
  function guard(col: number, row: number): Unit {
    return createUnit({
      id: "g", side: "enemy", pos: { col, row }, speed: 10, maxHp: 10, attack: 5,
      defense: 0, moveRange: 3, sightRadius: 6, standingOrder: "hold",
    });
  }

  it("stands its post instead of charging a distant foe", () => {
    const grid = new TileGrid(10, 1);
    const g = guard(8, 0);
    const player = at("p", "player", 0, 0);
    const plan = planEnemyTurn(g, [g, player], grid);
    expect(plan.destination).toEqual({ col: 8, row: 0 });
    expect(plan.path).toEqual([]);
    expect(plan.target).toBeNull();
  });

  it("never fights from beyond the leash, even when the foe is within raw move reach", () => {
    const grid = new TileGrid(10, 1);
    const g = guard(8, 0);
    const player = at("p", "player", 4, 0); // adjacency at col 5 = 3 from post — out of leash
    const plan = planEnemyTurn(g, [g, player], grid);
    expect(plan.target).toBeNull();
    expect(plan.destination).toEqual({ col: 8, row: 0 });
  });

  it("still fights what enters the leash", () => {
    const grid = new TileGrid(10, 1);
    const g = guard(8, 0);
    const player = at("p", "player", 6, 0);
    const plan = planEnemyTurn(g, [g, player], grid);
    expect(plan.destination).toEqual({ col: 7, row: 0 }); // inside the leash, adjacent
    expect(plan.target).toBe(player);
  });

  it("walks back toward a lost post rather than engaging where it stands", () => {
    const grid = new TileGrid(10, 1);
    const g = guard(8, 0);
    g.pos = { col: 2, row: 0 }; // displaced (a shove); the post stays (8,0)
    const player = at("p", "player", 1, 0); // adjacent — but out-of-leash tiles never fight
    const plan = planEnemyTurn(g, [g, player], grid);
    expect(plan.target).toBeNull();
    expect(plan.destination).toEqual({ col: 5, row: 0 }); // full move budget toward home
  });

  it("threatenedTiles honors the leash — the danger read never overstates a holder", () => {
    const grid = new TileGrid(10, 1);
    const g = guard(8, 0);
    const player = at("p", "player", 0, 0);
    const threat = threatenedTiles([g, player], grid, "player");
    const cols = threat.map((t) => t.col);
    // Strike-from tiles are leash-bound (cols 6–9), so threat reaches col 5, no farther.
    expect(cols).toContain(5);
    expect(cols).not.toContain(4);
  });
});
