import { describe, it, expect } from "vitest";
import { createUnit, type Unit, type Side } from "./units";
import { Battle, replay } from "./turn";
import { TileGrid } from "./grid";
import { makeGate, canKeyGate, dropsKeyOnDeath, lockGateOnGrid, type GateLock } from "./gates";
import { isDroppedKey } from "./entities";

/**
 * M5 — the droppable key (D117). A keyholder gate authored `dropOnDeath` does NOT auto-open when its
 * keyholder falls; it **drops a physical key** (a field entity) at his tile that a player fetches (steps
 * onto → `carriedKey`) and turns via the shared `keyGate` Act. The `/challenge` cases (replay + undo of the
 * whole drop → pickup → use chain) are the ones that catch a save-desync — they close the file.
 */

const at = (id: string, side: Side, col: number, row: number, over: Partial<Parameters<typeof createUnit>[0]> = {}): Unit =>
  createUnit({ id, side, pos: { col, row }, speed: 10, maxHp: 10, attack: 10, defense: 0, moveRange: 4, sightRadius: 8, attackRange: 1, ...over });

// A 6×1 corridor: fetcher(0) · warden(1, keyholder, frail) · gap(2) · seal(3, blocking).
function setup(lock: GateLock = { kind: "keyholder", tag: { role: "captain" }, dropOnDeath: true }) {
  const grid = new TileGrid(6, 1);
  const seal = makeGate("seal", { col: 3, row: 0 }, [lock]);
  const fetcher = at("fetcher", "player", 0, 0);
  const warden = at("warden", "enemy", 1, 0, { role: "captain", maxHp: 5 });
  const battle = new Battle(grid, [fetcher, warden], { gates: [seal] });
  const keyOf = () => battle.entities.all().find(isDroppedKey);
  return { grid, seal, fetcher, warden, battle, keyOf };
}

describe("droppable key (M5)", () => {
  it("a `dropOnDeath` keyholder death drops a key at his tile — the gate stays LOCKED (no auto-open)", () => {
    const { battle, seal, fetcher, warden, keyOf } = setup();
    battle.attack(fetcher, warden); // 10 dmg > 5 hp → the Warden falls
    expect(warden.alive).toBe(false);
    expect(seal.locked).toBe(true); // NOT auto-opened — the door waits for its key
    const key = keyOf()!;
    expect(key).toBeDefined();
    expect(key.pos).toEqual({ col: 1, row: 0 }); // dropped at the Warden's tile
    expect(key.gates).toEqual(["seal"]);
  });

  it("a PLAIN keyholder death still auto-opens the gate (default unchanged — cell-pop)", () => {
    const { battle, seal, fetcher, warden, keyOf } = setup({ kind: "keyholder", tag: { role: "captain" } });
    battle.attack(fetcher, warden);
    expect(seal.locked).toBe(false); // popped open, exactly as before M5
    expect(keyOf()).toBeUndefined(); // no key dropped
  });

  it("dropsKeyOnDeath discriminates the authored opt-in from the default", () => {
    const drop = makeGate("d", { col: 0, row: 0 }, [{ kind: "keyholder", tag: { role: "captain" }, dropOnDeath: true }]);
    const plain = makeGate("p", { col: 0, row: 0 }, [{ kind: "keyholder", tag: { role: "captain" } }]);
    const captain = at("w", "enemy", 0, 0, { role: "captain" });
    expect(dropsKeyOnDeath(drop, captain)).toBe(true);
    expect(dropsKeyOnDeath(plain, captain)).toBe(false);
    expect(dropsKeyOnDeath(drop, at("g", "enemy", 0, 0))).toBe(false); // not the tagged keyholder
  });

  it("a player fetches the key (steps onto its tile) → `carriedKey`, and turns the seal open", () => {
    const { battle, seal, fetcher, warden, keyOf } = setup();
    battle.attack(fetcher, warden);
    // Walk the fetcher THROUGH the key tile (1,0) to the seal-adjacent tile (2,0) — one move, picks it up en route.
    battle.moveUnit(fetcher, [{ col: 1, row: 0 }, { col: 2, row: 0 }]);
    expect(fetcher.carriedKey).toEqual(["seal"]);
    expect(keyOf()!.pickedUp).toBe(true);
    expect(canKeyGate(seal, fetcher)).toBe(true); // the carrier, adjacent, may turn it
    battle.keyGate(seal, fetcher);
    expect(seal.locked).toBe(false); // opened by the fetched key
  });

  it("an ENEMY stepping onto the key does NOT pick it up (player-only fetch, M5 scope)", () => {
    const { battle, fetcher, warden, keyOf } = setup();
    const grunt = at("grunt", "enemy", 2, 0); // will walk onto the key tile
    battle.units.push(grunt);
    battle.attack(fetcher, warden);
    battle.moveUnit(grunt, [{ col: 1, row: 0 }]); // enemy enters the key tile
    expect(grunt.carriedKey).toBeUndefined();
    expect(keyOf()!.pickedUp).toBe(false);
  });

  it("a NON-carrier adjacent to the seal cannot key it (the key is the authority)", () => {
    const { battle, seal, fetcher, warden } = setup();
    battle.attack(fetcher, warden);
    const bystander = at("by", "player", 2, 0); // adjacent to the seal, but carries no key
    battle.units.push(bystander);
    expect(canKeyGate(seal, bystander)).toBe(false);
  });

  it("REPLAY reconstructs the whole drop → pickup → use chain from the command log", () => {
    const { battle, fetcher, warden } = setup();
    battle.attack(fetcher, warden); // drop (a death side-effect, re-fires on replay)
    battle.moveUnit(fetcher, [{ col: 1, row: 0 }, { col: 2, row: 0 }]); // pickup (logged move)
    battle.keyGate(battle.gates.find((g) => g.id === "seal")!, fetcher); // use (logged Act)
    // Fresh board, same log: the death re-drops the key, the move re-picks it up, the Act re-opens the gate.
    const fresh = setup();
    const replayed = replay(fresh.grid, fresh.battle.units, battle.log, { gates: [fresh.seal] });
    expect(replayed.gates.find((g) => g.id === "seal")!.locked).toBe(false);
    const carrier = replayed.units.find((u) => u.id === "fetcher")!;
    expect(carrier.carriedKey).toEqual(["seal"]);
  });

  it("UNDO reverts the pickup — `carriedKey` cleared and the key un-pocketed", () => {
    const { battle, fetcher, warden, keyOf } = setup();
    battle.attack(fetcher, warden); // drop
    battle.beginUndo();
    battle.moveUnit(fetcher, [{ col: 1, row: 0 }]); // pickup
    expect(fetcher.carriedKey).toEqual(["seal"]);
    expect(keyOf()!.pickedUp).toBe(true);
    battle.undo();
    expect(fetcher.carriedKey).toBeUndefined(); // the carry rolled back (UnitSnapshot)
    expect(keyOf()!.pickedUp).toBe(false); // the key un-pocketed (EntitySnapshot flag)
    expect(fetcher.pos).toEqual({ col: 0, row: 0 }); // and the fetcher stepped back
  });

  it("the key is REUSABLE — it persists after use, so the carrier re-opens a re-sealed gate", () => {
    const { grid, battle, seal, fetcher, warden } = setup();
    battle.attack(fetcher, warden);
    battle.moveUnit(fetcher, [{ col: 1, row: 0 }, { col: 2, row: 0 }]);
    battle.keyGate(seal, fetcher);
    expect(seal.locked).toBe(false);
    expect(fetcher.carriedKey).toEqual(["seal"]); // turning the key does NOT consume it (D117/M5)
    // A lever re-seals the door (the lever-camp) — the carrier still holds the key and turns it again.
    lockGateOnGrid(grid, seal);
    expect(canKeyGate(seal, fetcher)).toBe(true);
    battle.keyGate(seal, fetcher);
    expect(seal.locked).toBe(false); // re-opened with the same key
  });

  it("UNDO reverts the drop — the key entity vanishes and the Warden stands (membership snapshot)", () => {
    const { battle, fetcher, warden, seal, keyOf } = setup();
    battle.beginUndo();
    battle.attack(fetcher, warden); // drop
    expect(warden.alive).toBe(false);
    expect(keyOf()).toBeDefined();
    battle.undo();
    expect(warden.alive).toBe(true); // the death rolled back…
    expect(keyOf()).toBeUndefined(); // …and the key it dropped is gone
    expect(seal.locked).toBe(true);
  });
});
