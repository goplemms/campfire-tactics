/**
 * The guard-doctrine harness (D108, M2.5) — proves the fixture is *doctrine-shaped*: it stages, the
 * garrison enemies carry the `garrison` tag, the seal is a real chokepoint (front unreachable while
 * locked, reachable once keyed), and the lever re-locks the keyed seal (Decision G). Plus the fail-loud
 * tag guard. The doctrine *behaviors* (primary drive, in-combat gate, control-room targeting) are M3's
 * tests against this fixture; the rendered proof is M4.
 */
import { describe, it, expect } from "vitest";
import { DOCTRINE_HARNESS } from "./scenarios/doctrine-harness";
import { stageEncounter } from "./staging";
import { createUnit, type Unit } from "./units";
import { hasTag, GARRISON } from "./tags";
import { keyholderOf, openGateOnGrid } from "./gates";
import { findPath } from "./pathfinding";
import { buildAuthoredEnemies } from "./authored";

const STATS = { speed: 12, maxHp: 24, attack: 9, defense: 2, moveRange: 4, sightRadius: 5 };
const party = (): Unit[] => [
  createUnit({ id: "infil", side: "player", pos: { col: 0, row: 0 }, jobId: "thief", primaryJob: "thief", ...STATS }),
  createUnit({ id: "sol", side: "player", pos: { col: 0, row: 0 }, jobId: "soldier", primaryJob: "soldier", ...STATS }),
];
const enemyOf = (battle: { units: readonly Unit[] }, id: string) => battle.units.find((u) => u.id === id)!;

describe("doctrine harness (M2.5)", () => {
  it("stages; the garrison enemies carry the `garrison` tag; the Warden is the seal's keyholder", () => {
    const { battle } = stageEncounter(DOCTRINE_HARNESS, party());
    const warden = enemyOf(battle, "warden");
    const ctx = battle.tagContext();
    expect(warden).toBeDefined();
    expect(hasTag(warden, GARRISON, ctx)).toBe(true);
    expect(hasTag(enemyOf(battle, "guard"), GARRISON, ctx)).toBe(true);
    // every enemy is garrison-tagged (the fixture's whole garrison)
    expect(battle.units.filter((u) => u.side === "enemy").every((u) => hasTag(u, GARRISON, ctx))).toBe(true);
    // the Warden holds the seal's key
    expect(keyholderOf(battle.gates.find((g) => g.id === "seal")!, warden)).toBe(true);
  });

  it("the seal is the sole chokepoint — the front is unreachable while locked, reachable once keyed", () => {
    const { battle } = stageEncounter(DOCTRINE_HARNESS, party());
    const seal = battle.gates.find((g) => g.id === "seal")!;
    const wardenPos = { col: 1, row: 1 };
    const front = { col: 5, row: 1 };
    expect(seal.locked).toBe(true);
    expect(findPath(battle.grid, wardenPos, front)).toBeNull(); // walled off by the seal
    openGateOnGrid(battle.grid, seal); // as if the Warden keyed it
    expect(findPath(battle.grid, wardenPos, front)).not.toBeNull(); // the route to the front opens
  });

  it("the lever re-locks the keyed seal (Decision G — same door)", () => {
    const { battle } = stageEncounter(DOCTRINE_HARNESS, party());
    const seal = battle.gates.find((g) => g.id === "seal")!;
    openGateOnGrid(battle.grid, seal); // open (as if keyed)
    expect(seal.locked).toBe(false);
    // the Warden at (1,1) is adjacent to the lever at (1,0) → pull re-locks the seal
    battle.pullLever(battle.levers.find((l) => l.id === "control")!, enemyOf(battle, "warden"));
    expect(seal.locked).toBe(true);
    expect(battle.grid.isWalkable({ col: 3, row: 1 })).toBe(false); // tile re-blocked
  });

  it("buildAuthoredEnemies fails loud on an unregistered authored tag (D117); the harness passes", () => {
    const bad = { ...DOCTRINE_HARNESS, enemies: [{ templateId: "bandit-thug", pos: { col: 0, row: 0 }, overrides: { tags: ["garrsion"] } }] };
    expect(() => buildAuthoredEnemies(bad)).toThrow(/unregistered tag/);
    expect(() => buildAuthoredEnemies(DOCTRINE_HARNESS)).not.toThrow();
  });
});

// --- M3: the garrison door-drive, driven through the live Battle (D108/D117) ---
// runPolicyTurn wires `this.tagContext()` into the planner, so `in-combat` is read off the REAL combat
// event log — the only guard that catches the "silent permanent in-combat=false" failure a stubbed ctx
// can't (the pre-mortem's highest-risk item). Both directions proven end-to-end against the fixture.
describe("garrison door-drive (M3, integration)", () => {
  it("an un-engaged Warden drives to the seal and keys it OPEN, past the reachable infiltrator", () => {
    const { battle } = stageEncounter(DOCTRINE_HARNESS, party());
    const warden = enemyOf(battle, "warden");
    const seal = battle.gates.find((g) => g.id === "seal")!;
    expect(seal.locked).toBe(true);
    const plan = battle.runPolicyTurn(warden); // no damage logged yet → !in-combat → the drive fires
    expect(plan.gateTarget?.id).toBe("seal");
    expect(plan.gateAct).toBe("key");
    expect(plan.target).toBeNull(); // ignored the infiltrator to reach the door
    expect(seal.locked).toBe(false); // keyed open — the route to the front is revealed
    expect(battle.grid.isWalkable({ col: 3, row: 1 })).toBe(true);
  });

  it("the drive is what keys it: the SAME staged Warden, un-tagged, attacks the infiltrator instead (garrison-scoped)", () => {
    const { battle } = stageEncounter(DOCTRINE_HARNESS, party());
    const warden = enemyOf(battle, "warden");
    (warden as { tags: readonly string[] }).tags = []; // strip `garrison` → generic AI, infiltrator reachable
    const seal = battle.gates.find((g) => g.id === "seal")!;
    const plan = battle.runPolicyTurn(warden);
    expect(plan.gateTarget).toBeUndefined(); // no door-drive → it goes for the reachable foe
    expect(seal.locked).toBe(true); // proves the un-engaged case above keyed *because of* the garrison drive
  });

  it("a Warden struck this window is `in-combat` → it STOPS and fights, the seal stays shut", () => {
    const { battle } = stageEncounter(DOCTRINE_HARNESS, party());
    const warden = enemyOf(battle, "warden");
    const infil = battle.units.find((u) => u.id === "infil")!;
    const seal = battle.gates.find((g) => g.id === "seal")!;
    // Stage a REAL exchange: the infiltrator steps adjacent and strikes the Warden (a logged `unitDamaged`
    // since the Warden's battle-open window) → `in-combat` reads true off the event log.
    infil.pos = { col: 1, row: 0 }; // adjacent to the Warden at (1,1)
    const dealt = battle.attack(infil, warden);
    expect(dealt).toBeGreaterThan(0);
    const plan = battle.runPolicyTurn(warden);
    expect(plan.target?.id).toBe("infil"); // pinned → attacks the engager
    expect(plan.gateTarget).toBeUndefined(); // did NOT key
    expect(seal.locked).toBe(true); // the seal stays shut while the Warden is engaged
  });
});
