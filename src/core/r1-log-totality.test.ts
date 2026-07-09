/**
 * R1 (#111) — characterization safety net for combat-log **totality**.
 *
 * A golden scripted battle (fixed seed, variance ON, fully deterministic) that uses
 * BOTH verbs the audit flagged as out-of-log — `Battle.rescue` and `Battle.useHeal` —
 * and pins its exact end-state. At increment 0 these tests were **discrepancy
 * witnesses**: `replay(initial, log)` did NOT reproduce that end-state, because
 * neither verb appended a {@link CombatAction}. Increment 1 (logged rescue) and
 * increment 2 (logged useHeal) each flipped their witness; increment 4 holds them as
 * the standing **replay pin** that closes #111: the golden battle replays
 * byte-identically (through a JSON round-trip of its log), and undo/undoAll cross
 * both verbs.
 *
 * Sim baseline at increment 0 (`npm run sim` — must stay byte-identical through R1):
 *   ── procedural / normal (80 runs) ──
 *     completed 3 (4%) · lost 77 · stalled 0 · crashed 0
 *     median nights 6 · median gold earned 215 · permadeaths/run 0.00
 *     encounters: win 195 · obj-fail 0 · wipe 77
 *     ended at layer: L4:9 L5:16 L6:55
 *     levers engaged: goldPressure 100% · skippedFood 0% · tookCaptureRisk 0% ·
 *       moraleMoved 100% · leveled 49% · restedInPlace 0% · storagePressure 56% · feltTraps 0%
 *     enemy traps: staged 0 · spotted 0 · sprung 0 · disarmed 0 · salvaged 0
 *     Hollow Mill (authored): complete — ended finale (L7)
 *     Hollow Mill traps: staged 8 · spotted 0 · sprung 5 · disarmed 0 · salvaged 0
 *
 * Pure logic: no Phaser, no DOM.
 */
import { describe, it, expect } from "vitest";
import { Battle, replay, type BattleOptions } from "./turn";
import { TileGrid } from "./grid";
import { createUnit, type Side, type Unit } from "./units";
import { createInventory, countOf, type Inventory } from "./inventory";
import { JOBS } from "./jobs";
import { DEFEND } from "./jobs-data/support";
import type { CombatAction } from "./combat-actions";

const HEAL = JOBS.medic.skills[0]; // the Medic's herb-fuelled Heal (med-heal)

function at(id: string, side: Side, col: number, row: number, overrides: Partial<Unit> = {}): Unit {
  return {
    ...createUnit({
      id,
      side,
      pos: { col, row },
      speed: 10,
      maxHp: 24,
      attack: 8,
      defense: 2,
      moveRange: 4,
      sightRadius: 6,
    }),
    ...overrides,
  };
}

/** The golden roster — fresh clones each call (the battle mutates them). */
function roster(): Unit[] {
  return [
    at("medic", "player", 0, 0, { jobId: "medic", primaryJob: "medic", speed: 14, attack: 4 }),
    at("ally", "player", 1, 0, { speed: 8, hp: 5, maxHp: 40 }),
    at("hero", "player", 2, 0, { speed: 12, attack: 10 }),
    at("cap", "player", 2, 1, { captured: true }),
    at("foe", "enemy", 6, 0, { speed: 6, maxHp: 30, hp: 30 }),
  ];
}

const GOLDEN_OPTS: BattleOptions = { seed: "r1-golden", variance: 0.25 };
const TURNS = 8;

/**
 * Play the golden script: a fixed number of turns in which the Medic heals the
 * wounded ally with a salve (`useHeal`), the hero frees the captive (`rescue`) and
 * later trades blows with the foe, and the enemy runs its AI. Deterministic —
 * fixed seed, scripted decisions only.
 */
function playGolden(): { battle: Battle; inv: Inventory } {
  const grid = new TileGrid(8, 3);
  const battle = new Battle(grid, roster(), GOLDEN_OPTS);
  const inv = createInventory(8, { salve: 2 });
  battle.setStash(inv);
  battle.seed();

  const turnsTaken: Record<string, number> = {};
  for (let t = 0; t < TURNS; t++) {
    const actor = battle.nextActor();
    if (!actor) break;
    const n = (turnsTaken[actor.id] = (turnsTaken[actor.id] ?? 0) + 1);
    if (actor.side === "enemy") {
      battle.runPolicyTurn(actor);
      continue;
    }
    switch (actor.id) {
      case "medic": {
        if (n === 1) {
          // The Medic's herb heal — commits the turn itself (default commitTurn).
          const medic = actor;
          const ally = battle.units.find((u) => u.id === "ally")!;
          battle.useHeal(medic, HEAL, ally, "salve", inv);
        } else {
          battle.endTurn(actor, { moved: false });
        }
        break;
      }
      case "hero": {
        const cap = battle.units.find((u) => u.id === "cap")!;
        const foe = battle.units.find((u) => u.id === "foe")!;
        if (n === 1) {
          // The rescue Act (D52): free the adjacent captive, then end the turn on the Act.
          battle.rescue(cap, actor);
          battle.endTurn(actor, { moved: false, acted: true });
        } else if (foe.alive && Math.abs(foe.pos.col - actor.pos.col) + Math.abs(foe.pos.row - actor.pos.row) <= 1) {
          battle.attack(actor, foe);
          battle.endTurn(actor, { moved: false, acted: true });
        } else {
          battle.endTurn(actor, { moved: false });
        }
        break;
      }
      default:
        battle.endTurn(actor, { moved: false });
    }
  }
  return { battle, inv };
}

const unitIn = (battle: Battle, id: string): Unit => battle.units.find((u) => u.id === id)!;

/** Replay the golden log from a fresh roster + a fresh copy of the initial stash. */
function replayGolden(battle: Battle): { rebuilt: Battle; inv: Inventory } {
  const grid = new TileGrid(8, 3);
  const inv = createInventory(8, { salve: 2 }); // the same initial counts playGolden started from
  const rebuilt = replay(grid, roster(), battle.log, { ...GOLDEN_OPTS, stash: inv });
  return { rebuilt, inv };
}

describe("R1 #111 — golden rescue+heal battle (log-totality characterization)", () => {
  it("pins the golden end-state (rescue freed the captive, the heal landed, the herb burned)", () => {
    const { battle, inv } = playGolden();
    const cap = unitIn(battle, "cap");
    const ally = unitIn(battle, "ally");

    expect(cap.captured).toBe(false); // rescued — back on the clock
    expect(ally.hp).toBe(38); // 5 + (8 base + ⌊0.5 × 35⌋ triage + 8 salve) = 38
    expect(countOf(inv, "salve")).toBe(1); // one herb consumed
    // The pinned trace shape: the battle genuinely played out (moves/attacks logged).
    expect(battle.log.length).toBeGreaterThan(0);
  });

  it("replay reproduces the logged rescue (the increment-0 witness, flipped): the replayed captive is freed", () => {
    const { battle } = playGolden();
    const { rebuilt } = replayGolden(battle);
    // The rescue is a logged action now, so the replayed captive comes back freed —
    // the state graph (isActive, clock membership, win check) reconstructs.
    expect(unitIn(rebuilt, "cap").captured).toBe(false);
  });

  it("replay reproduces the logged heal (the increment-0 witness, flipped): the ally's HP and the herb spend come back", () => {
    const { battle } = playGolden();
    const { rebuilt, inv } = replayGolden(battle);
    // The heal (herb spend + turn commit) is a logged action now: the replayed ally
    // lands on the same HP, and the replayed stash burned the same herb.
    expect(unitIn(rebuilt, "ally").hp).toBe(unitIn(battle, "ally").hp);
    expect(countOf(inv, "salve")).toBe(1);
    expect(rebuilt.units).toEqual(battle.units);
  });

  it("THE REPLAY PIN (closes #111): the golden battle replays byte-identically, through a JSON round-trip", () => {
    const { battle } = playGolden();
    const grid = new TileGrid(8, 3);
    const inv = createInventory(8, { salve: 2 });
    // The full invariant, on the wire form: serialize the log, parse it back, replay
    // from the initial roster + initial stash — identical battle, identical log.
    const wire = JSON.parse(JSON.stringify(battle.log)) as CombatAction[];
    const rebuilt = replay(grid, roster(), wire, { ...GOLDEN_OPTS, stash: inv });
    expect(rebuilt.units).toEqual(battle.units);
    expect(rebuilt.log).toEqual(battle.log);
    expect(rebuilt.outcome()).toEqual(battle.outcome());
    expect(countOf(inv, "salve")).toBe(1);
  });

  it("undo/undoAll cross both verbs — the armed span rolls back byte-identically (#111)", () => {
    const grid = new TileGrid(8, 3);
    const battle = new Battle(grid, roster(), GOLDEN_OPTS);
    const inv = createInventory(8, { salve: 2 });
    battle.setStash(inv);
    battle.seed();
    const medic = unitIn(battle, "medic");
    const ally = unitIn(battle, "ally");
    const hero = unitIn(battle, "hero");
    const cap = unitIn(battle, "cap");

    battle.beginUndo();
    const before = battle.units.map((u) => structuredClone(u));

    battle.rescue(cap, hero);
    battle.useHeal(medic, HEAL, ally, "salve", inv, { commitTurn: false });
    expect(cap.captured).toBe(false);
    expect(ally.hp).toBe(38);
    expect(countOf(inv, "salve")).toBe(1);
    expect(battle.undoDepth()).toBe(2);

    // Peel the heal back alone — the rescue stands.
    expect(battle.undo()?.kind).toBe("useHeal");
    expect(ally.hp).toBe(5);
    expect(countOf(inv, "salve")).toBe(2); // herb refunded
    expect(cap.captured).toBe(false); // the earlier rescue is untouched

    // Re-do, then roll the whole span back — byte-identical to the armed start.
    battle.useHeal(medic, HEAL, ally, "salve", inv, { commitTurn: false });
    const undone = battle.undoAll();
    expect(undone.map((a) => a.kind)).toEqual(["useHeal", "rescue"]);
    expect(battle.units.map((u) => structuredClone(u))).toEqual(before);
    expect(cap.captured).toBe(true);
    expect(countOf(inv, "salve")).toBe(2);
    expect(battle.log).toEqual([]);
  });
});

describe("R1 #111 — the log is a serializable wire format (skill-by-id)", () => {
  it("JSON.parse(JSON.stringify(log)) replays identically for a registry-skill battle", () => {
    // A small battle exercising every skill-carrying verb with REGISTRY skills only:
    // a `skill` cast (the universal Defend), a `useHeal` (the Medic's Heal), a rescue,
    // attacks, and endTurns — then the round-trip: serialize the log to JSON, parse it
    // back, and replay the parsed form. Identical reconstruction proves the log is a
    // pure-data wire format (the D27 save seam).
    const grid = new TileGrid(6, 1);
    const mk = () => [
      at("medic", "player", 0, 0, { jobId: "medic", primaryJob: "medic", speed: 14, attack: 4 }),
      at("ally", "player", 1, 0, { speed: 10, hp: 6, maxHp: 30 }),
      at("cap", "player", 2, 0, { captured: true }),
      at("foe", "enemy", 5, 0, { speed: 6, maxHp: 26, hp: 26 }),
    ];
    const opts: BattleOptions = { seed: "r1-wire", variance: 0.2 };
    const battle = new Battle(grid, mk(), opts);
    const inv = createInventory(8, { salve: 1 });
    battle.seed();

    const turnsTaken: Record<string, number> = {};
    for (let t = 0; t < 6; t++) {
      const actor = battle.nextActor();
      if (!actor) break;
      const n = (turnsTaken[actor.id] = (turnsTaken[actor.id] ?? 0) + 1);
      if (actor.side === "enemy") battle.runPolicyTurn(actor);
      else if (actor.id === "medic" && n === 1) {
        battle.useHeal(actor, HEAL, unitIn(battle, "ally"), "salve", inv);
      } else if (actor.id === "ally" && n === 1) {
        battle.rescue(unitIn(battle, "cap"), actor);
        battle.useSkill(actor, DEFEND, actor); // registry skill — commits the turn
      } else {
        battle.endTurn(actor, { moved: false });
      }
    }

    // The logged skill references are ids, not object refs.
    const skillRefs = battle.log.flatMap((a) => ("skill" in a ? [a.skill] : []));
    expect(skillRefs).toContain("defend");
    expect(skillRefs).toContain("heal");
    for (const ref of skillRefs) expect(typeof ref).toBe("string");

    const wire = JSON.parse(JSON.stringify(battle.log)) as CombatAction[];
    const rebuilt = replay(grid, mk(), wire, { ...opts, stash: createInventory(8, { salve: 1 }) });
    expect(rebuilt.units).toEqual(battle.units);
    expect(rebuilt.log).toEqual(battle.log); // the round-trip is lossless
    expect(rebuilt.outcome()).toEqual(battle.outcome());
  });
});
