import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import { stageEncounter } from "./staging";
import type { AuthoredEncounter } from "./authored";
import { makeGate, type Gate } from "./gates";
import { Battle, replay } from "./turn";
import { TileGrid } from "./grid";

/**
 * Gates wired into a real staged {@link Battle} (D103 Phase 2a) — the mechanic end to end:
 * a locked gate blocks its tile, a Thief opens it via the interact Act, defeating the keyholder
 * (the Captain) pops the keyholder cells, and undo re-locks. Proves the pure `gates.ts` primitives
 * come alive through staging + the Battle without a scene.
 */

const thief = () => createUnit({ id: "thief", side: "player", pos: { col: 0, row: 0 }, jobId: "thief", primaryJob: "thief", speed: 12, maxHp: 20, attack: 6, defense: 1, moveRange: 4, sightRadius: 5, attackRange: 1 });
const bruiser = () => createUnit({ id: "bruiser", side: "player", pos: { col: 0, row: 0 }, jobId: "soldier", primaryJob: "soldier", speed: 10, maxHp: 30, attack: 50, defense: 2, moveRange: 3, sightRadius: 5, attackRange: 1 });

/** A prison: a lockpick+keyholder cell at (4,2), a keyholder-only cell at (4,4), the Captain at (5,2). */
const PRISON: AuthoredEncounter = {
  id: "prison-test",
  name: "Prison Test",
  cols: 8,
  rows: 6,
  blocked: [],
  playerSpawns: [{ col: 3, row: 2 }, { col: 5, row: 3 }], // thief next to cell-a; bruiser next to the Captain
  enemies: [{ templateId: "bandit-captain", pos: { col: 5, row: 2 }, id: "warden", role: "captain", overrides: { maxHp: 1 } }],
  gates: [
    { id: "cell-a", pos: { col: 4, row: 2 }, openBy: [{ kind: "lockpick" }, { kind: "keyholder", tag: { role: "captain" } }] },
    { id: "cell-b", pos: { col: 4, row: 4 }, openBy: [{ kind: "keyholder", tag: { role: "captain" } }] },
  ],
  reward: { gold: 0, materials: [] },
};

const gate = (units: { gates: Gate[] }, id: string) => units.gates.find((g) => g.id === id)!;
const unit = (us: readonly Unit[], id: string) => us.find((u) => u.id === id)!;

describe("gates in a staged battle (D103 Phase 2a)", () => {
  it("a locked gate blocks its tile from turn one", () => {
    const { battle } = stageEncounter(PRISON, [thief(), bruiser()]);
    expect(battle.grid.isWalkable({ col: 4, row: 2 })).toBe(false);
    expect(battle.grid.isWalkable({ col: 4, row: 4 })).toBe(false);
    expect(gate(battle, "cell-a").locked).toBe(true);
  });

  it("a Thief opens an adjacent lockpick cell via the interact Act (tile clears + gateOpened fires)", () => {
    const { battle } = stageEncounter(PRISON, [thief(), bruiser()]);
    const cellA = gate(battle, "cell-a");
    let fired: string | null = null;
    battle.bus.on("gateOpened", ({ cause }) => (fired = cause));

    battle.openGate(cellA, unit(battle.units, "thief"));
    expect(cellA.locked).toBe(false);
    expect(battle.grid.isWalkable({ col: 4, row: 2 })).toBe(true);
    expect(fired).toBe("lockpick");
    expect(gate(battle, "cell-b").locked).toBe(true); // keyholder-only cell untouched
  });

  it("a non-adjacent or non-lockpick unit can't open it (a refused no-op)", () => {
    const { battle } = stageEncounter(PRISON, [thief(), bruiser()]);
    const cellA = gate(battle, "cell-a");
    battle.openGate(cellA, unit(battle.units, "bruiser")); // adjacent-ish but no lockpick capability
    expect(cellA.locked).toBe(true); // refused
  });

  it("defeating the Captain (keyholder) pops every keyholder cell", () => {
    const { battle } = stageEncounter(PRISON, [thief(), bruiser()]);
    const cellA = gate(battle, "cell-a");
    const cellB = gate(battle, "cell-b");
    battle.attack(unit(battle.units, "bruiser"), unit(battle.units, "warden"));
    expect(unit(battle.units, "warden").alive).toBe(false);
    expect(cellA.locked).toBe(false); // both keyholder-tagged cells open
    expect(cellB.locked).toBe(false);
    expect(battle.grid.isWalkable({ col: 4, row: 4 })).toBe(true);
  });

  it("undo re-locks a lockpicked gate and re-blocks its tile", () => {
    const { battle } = stageEncounter(PRISON, [thief(), bruiser()]);
    const cellA = gate(battle, "cell-a");
    battle.beginUndo();
    battle.openGate(cellA, unit(battle.units, "thief"));
    expect(cellA.locked).toBe(false);
    battle.undo();
    expect(cellA.locked).toBe(true); // re-locked
    expect(battle.grid.isWalkable({ col: 4, row: 2 })).toBe(false); // tile re-blocked
  });

  // --- keyGate: the living-keyholder Act (D108, M2b) -------------------------
  // The Warden ("warden", role "captain") sits at (5,2), adjacent to the keyed cell-a at (4,2);
  // cell-b at (4,4) is keyed but out of his reach. The active counterpart to the death-trigger.

  it("the Warden turns his key on the adjacent keyed cell — tile clears, cause 'keyholder'", () => {
    const { battle } = stageEncounter(PRISON, [thief(), bruiser()]);
    const cellA = gate(battle, "cell-a");
    let fired: string | null = null;
    battle.bus.on("gateOpened", ({ cause }) => (fired = cause));
    battle.keyGate(cellA, unit(battle.units, "warden"));
    expect(cellA.locked).toBe(false);
    expect(battle.grid.isWalkable({ col: 4, row: 2 })).toBe(true);
    expect(fired).toBe("keyholder");
    expect(gate(battle, "cell-b").locked).toBe(true); // out of reach — only the adjacent cell opens
  });

  it("keyGate refuses a non-keyholder, a non-adjacent keyholder, and an already-open gate (no-op, unlogged)", () => {
    const { battle } = stageEncounter(PRISON, [thief(), bruiser()]);
    battle.keyGate(gate(battle, "cell-a"), unit(battle.units, "thief")); // adjacent, but not the keyholder
    expect(gate(battle, "cell-a").locked).toBe(true);
    battle.keyGate(gate(battle, "cell-b"), unit(battle.units, "warden")); // the keyholder, but not adjacent
    expect(gate(battle, "cell-b").locked).toBe(true);
    battle.keyGate(gate(battle, "cell-a"), unit(battle.units, "warden")); // opens it (logged)
    expect(gate(battle, "cell-a").locked).toBe(false);
    const logged = battle.log.length;
    battle.keyGate(gate(battle, "cell-a"), unit(battle.units, "warden")); // already open → refused
    expect(battle.log.length).toBe(logged); // unlogged no-op
  });

  it("undo re-locks a keyed gate and re-blocks its tile", () => {
    const { battle } = stageEncounter(PRISON, [thief(), bruiser()]);
    const cellA = gate(battle, "cell-a");
    battle.beginUndo();
    battle.keyGate(cellA, unit(battle.units, "warden"));
    expect(cellA.locked).toBe(false);
    battle.undo();
    expect(cellA.locked).toBe(true);
    expect(battle.grid.isWalkable({ col: 4, row: 2 })).toBe(false);
  });

  it("a keyed-open gate does NOT double-open when the Warden later dies (idempotent)", () => {
    const { battle } = stageEncounter(PRISON, [thief(), bruiser()]);
    const opens: string[] = [];
    battle.bus.on("gateOpened", ({ gate, cause }) => opens.push(`${gate.id}:${cause}`));
    battle.keyGate(gate(battle, "cell-a"), unit(battle.units, "warden")); // key cell-a open
    battle.attack(unit(battle.units, "bruiser"), unit(battle.units, "warden")); // Warden dies (maxHp 1)
    expect(unit(battle.units, "warden").alive).toBe(false);
    expect(gate(battle, "cell-a").locked).toBe(false);
    expect(gate(battle, "cell-b").locked).toBe(false); // his death pops the OTHER keyed cell
    expect(opens.filter((o) => o.startsWith("cell-a")).length).toBe(1); // opened once (by key), not again on death
    expect(opens).toEqual(expect.arrayContaining(["cell-a:keyholder", "cell-b:keyholder"]));
  });

  it("replay reconstructs a keyed-open gate (the Act rides the command log)", () => {
    const build = () => {
      const grid = new TileGrid(6, 3);
      const warden = createUnit({ id: "warden", side: "enemy", pos: { col: 2, row: 1 }, role: "captain", speed: 10, maxHp: 10, attack: 5, defense: 1, moveRange: 3, sightRadius: 5, attackRange: 1 });
      const cell = makeGate("cell", { col: 1, row: 1 }, [{ kind: "keyholder", tag: { role: "captain" } }]);
      return { grid, warden, cell };
    };
    const a = build();
    const battle = new Battle(a.grid, [a.warden], { gates: [a.cell] });
    battle.keyGate(a.cell, a.warden);
    expect(a.cell.locked).toBe(false);

    const b = build();
    const replayed = replay(b.grid, [b.warden], battle.log, { gates: [b.cell] });
    expect(replayed.gates.find((g) => g.id === "cell")!.locked).toBe(false); // reconstructed from the log
  });

  it("a destructible door chips over hits, breaks open at 0, and undo restores its durability + block", () => {
    const DOOR: AuthoredEncounter = {
      id: "door-test",
      name: "Door Test",
      cols: 5,
      rows: 3,
      blocked: [],
      playerSpawns: [{ col: 1, row: 1 }], // the striker — adjacent to the door at (2,1)
      enemies: [{ templateId: "bandit-thug", pos: { col: 4, row: 1 } }],
      gates: [{ id: "door", pos: { col: 2, row: 1 }, openBy: [{ kind: "destructible", hp: 15 }] }],
      reward: { gold: 0, materials: [] },
    };
    const striker = createUnit({ id: "striker", side: "player", pos: { col: 0, row: 0 }, jobId: "soldier", primaryJob: "soldier", speed: 10, maxHp: 24, attack: 9, defense: 2, moveRange: 4, sightRadius: 5, attackRange: 1 });
    const { battle } = stageEncounter(DOOR, [striker]);
    const door = gate(battle, "door");
    const s = unit(battle.units, "striker");
    expect(battle.grid.isWalkable({ col: 2, row: 1 })).toBe(false); // locked ⇒ blocks
    expect(door.hp).toBe(15);

    // One hit holds — durability drops, the door still blocks.
    battle.beginUndo();
    battle.attackGate(door, s); // 15 − 9 = 6
    expect(door.hp).toBe(6);
    expect(door.locked).toBe(true);

    // Undo restores its durability + the block.
    battle.undo();
    expect(door.hp).toBe(15);
    expect(battle.grid.isWalkable({ col: 2, row: 1 })).toBe(false);

    // Two hits break it open — and (D106) it's smashed to a permanent remnant, not merely opened.
    battle.attackGate(door, s);
    battle.attackGate(door, s); // 6 → 0
    expect(door.hp).toBe(0);
    expect(door.locked).toBe(false);
    expect(door.broken).toBe(true);
    expect(battle.grid.isWalkable({ col: 2, row: 1 })).toBe(true); // the way is clear
  });

  it("D106: a battered-down door is a PERMANENT breach — the lever can't re-seal it, and undo crosses the smash", () => {
    const BREACH: AuthoredEncounter = {
      id: "breach-test",
      name: "Breach Test",
      cols: 5,
      rows: 3,
      blocked: [{ col: 3, row: 0 }, { col: 3, row: 2 }], // wall col 3 except the door at (3,1)
      playerSpawns: [{ col: 2, row: 1 }], // the breaker — adjacent to the door, beside the lever at (2,0)
      enemies: [{ templateId: "bandit-thug", pos: { col: 4, row: 1 } }],
      gates: [{ id: "door", pos: { col: 3, row: 1 }, openBy: [{ kind: "destructible", hp: 15 }] }],
      levers: [{ id: "switch", pos: { col: 2, row: 0 }, targets: ["door"] }],
      reward: { gold: 0, materials: [] },
    };
    const breaker = createUnit({ id: "breaker", side: "player", pos: { col: 0, row: 0 }, jobId: "soldier", primaryJob: "soldier", speed: 10, maxHp: 24, attack: 9, defense: 2, moveRange: 4, sightRadius: 5, attackRange: 1 });
    const { battle } = stageEncounter(BREACH, [breaker]);
    const door = gate(battle, "door");
    const lever = battle.levers[0];
    const b = unit(battle.units, "breaker");

    // Chip it to 6 (holds, still sealing, not broken).
    battle.attackGate(door, b); // 15 → 6
    expect(door.hp).toBe(6);
    expect(door.broken).toBeFalsy();

    // The killing blow smashes it to a permanent, passable remnant.
    battle.beginUndo();
    battle.attackGate(door, b); // 6 → 0
    expect(door.broken).toBe(true);
    expect(door.locked).toBe(false);
    expect(battle.grid.isWalkable({ col: 3, row: 1 })).toBe(true);

    // Undo crosses the smash (the checkpoint restored `broken`): the door seals again, un-broken.
    battle.undo();
    expect(door.broken).toBeFalsy();
    expect(door.locked).toBe(true);
    expect(door.hp).toBe(6);
    expect(battle.grid.isWalkable({ col: 3, row: 1 })).toBe(false);

    // Re-smash it — now the lever cannot re-seal the breach (the infinite-reseal exploit is closed).
    battle.attackGate(door, b); // 6 → 0 again
    expect(door.broken).toBe(true);
    battle.pullLever(lever, b);
    expect(door.broken).toBe(true);
    expect(door.locked).toBe(false);
    expect(battle.grid.isWalkable({ col: 3, row: 1 })).toBe(true); // still a passable remnant
  });

  it("D107: a lever re-seal does NOT mend the door — battering persists across seals, so each seal buys less", () => {
    const BREACH: AuthoredEncounter = {
      id: "persist-test",
      name: "Persist Test",
      cols: 5,
      rows: 3,
      blocked: [{ col: 3, row: 0 }, { col: 3, row: 2 }], // wall col 3 except the door at (3,1)
      playerSpawns: [{ col: 2, row: 1 }], // the breaker — adjacent to the door, beside the lever at (2,0)
      enemies: [{ templateId: "bandit-thug", pos: { col: 4, row: 1 } }],
      gates: [{ id: "door", pos: { col: 3, row: 1 }, openBy: [{ kind: "destructible", hp: 15 }] }],
      levers: [{ id: "switch", pos: { col: 2, row: 0 }, targets: ["door"] }],
      reward: { gold: 0, materials: [] },
    };
    const breaker = createUnit({ id: "breaker", side: "player", pos: { col: 0, row: 0 }, jobId: "soldier", primaryJob: "soldier", speed: 10, maxHp: 24, attack: 9, defense: 2, moveRange: 4, sightRadius: 5, attackRange: 1 });
    const { battle } = stageEncounter(BREACH, [breaker]);
    const door = gate(battle, "door");
    const lever = battle.levers[0];
    const b = unit(battle.units, "breaker");

    // Batter the locked door down to 6.
    battle.attackGate(door, b); // 15 → 6
    expect(door.hp).toBe(6);

    // Pull the lever (door locked → it opens), then pull again (door open → it re-seals).
    battle.pullLever(lever, b); // opens the damaged door
    expect(door.locked).toBe(false);
    expect(door.hp).toBe(6); // opening doesn't change durability
    battle.pullLever(lever, b); // re-seals it
    expect(door.locked).toBe(true);
    expect(door.hp).toBe(6); // re-sealing KEEPS the damage — no free top-up (D107)

    // One more hit now finishes it (6 → 0) — the seal bought less time the second round.
    battle.attackGate(door, b);
    expect(door.broken).toBe(true);
  });

  it("a lever pull slams an open door shut (control-room seal), toggles back, and undo crosses it", () => {
    const SEAL: AuthoredEncounter = {
      id: "seal-test",
      name: "Seal Test",
      cols: 5,
      rows: 3,
      blocked: [],
      playerSpawns: [{ col: 2, row: 1 }], // the infiltrator — beside the lever at (2,0)
      enemies: [{ templateId: "bandit-thug", pos: { col: 4, row: 1 } }],
      gates: [{ id: "door", pos: { col: 3, row: 1 }, locked: false, openBy: [{ kind: "destructible", hp: 20 }] }], // starts OPEN
      levers: [{ id: "switch", pos: { col: 2, row: 0 }, targets: ["door"] }],
      reward: { gold: 0, materials: [] },
    };
    const infil = createUnit({ id: "infil", side: "player", pos: { col: 0, row: 0 }, jobId: "thief", primaryJob: "thief", speed: 12, maxHp: 24, attack: 6, defense: 1, moveRange: 4, sightRadius: 5, attackRange: 1 });
    const { battle } = stageEncounter(SEAL, [infil]);
    const door = gate(battle, "door");
    const lever = battle.levers[0];
    const p = unit(battle.units, "infil");
    expect(door.locked).toBe(false); // open on entry
    expect(battle.grid.isWalkable({ col: 3, row: 1 })).toBe(true);

    // Pull the lever → the door slams shut + re-blocks.
    battle.beginUndo();
    battle.pullLever(lever, p);
    expect(door.locked).toBe(true);
    expect(battle.grid.isWalkable({ col: 3, row: 1 })).toBe(false); // sealed
    expect(door.hp).toBe(20); // whole — it was never battered (sealing doesn't mend, D107)

    // Undo re-opens it (crosses the toggle via the gate checkpoint).
    battle.undo();
    expect(door.locked).toBe(false);
    expect(battle.grid.isWalkable({ col: 3, row: 1 })).toBe(true);

    // Pull twice → seal, then reopen (toggle).
    battle.pullLever(lever, p);
    expect(door.locked).toBe(true);
    battle.pullLever(lever, p);
    expect(door.locked).toBe(false);
  });
});
