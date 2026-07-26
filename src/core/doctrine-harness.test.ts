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
import { keyholderOf, openGateOnGrid, makeGate, applyGatesToGrid } from "./gates";
import { findPath } from "./pathfinding";
import { buildAuthoredEnemies } from "./authored";
import { inRegion } from "./iso";
import { Battle } from "./turn";
import { TileGrid } from "./grid";
import { manhattan } from "./combat";

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

  it("M3b: the control-room region stages onto the Battle and discriminates the two spawns", () => {
    const { battle } = stageEncounter(DOCTRINE_HARNESS, party());
    expect(battle.controlRoom).toEqual({ cols: [0, 2], rows: [0, 2] });
    const players = battle.units.filter((u) => u.side === "player");
    // The infiltrator spawns inside the control room (near the lever); the front party outside it — so the
    // M3b target-priority (unit-tested) has a real region to read off the live battle (Decision G plumbing).
    expect(players.some((p) => inRegion(p.pos, battle.controlRoom!))).toBe(true);
    expect(players.some((p) => !inRegion(p.pos, battle.controlRoom!))).toBe(true);
  });
});

// --- M4: the free-casualty ceiling — the ranged-farm tripwire (D117/H ruling) ---
// The H ruling kept clauses 4 & 5 (a guard does NOT chase an out-of-reach attacker), so a ranged unit can
// plink the advancing garrison from beyond its melee reach without ever pinning it. That's accepted as skill
// expression *only while the numbers don't make it a genuine farm* — this test is the digest tripwire the
// ruling promised: a garrison keyholder drives to a distant seal while a Hunter plinks it every turn, and we
// assert it REACHES + KEYS the seal without being farmed to death. It is built mutation-robust: `plinks > 0`
// proves the farm window was real (not green because the Hunter never fired), so a future change that made
// plinking lethal (bump the Hunter's attack) or stalled the drive would flip `warden.alive`/`sealKeyed` red.
describe("free-casualty ceiling (M4 — the ranged-farm tripwire)", () => {
  it("a garrison keyholder drives to a distant seal under a Hunter's plinking and survives to key it", () => {
    const grid = new TileGrid(7, 3);
    const seal = makeGate("seal", { col: 5, row: 0 }, [{ kind: "keyholder", tag: { role: "captain" } }]);
    applyGatesToGrid(grid, [seal]); // blocks (5,0); the Warden must reach (4,0) to key it
    const warden = createUnit({
      id: "warden", side: "enemy", pos: { col: 0, row: 0 }, role: "captain", tags: ["garrison"],
      speed: 10, maxHp: 24, attack: 8, defense: 2, moveRange: 2, sightRadius: 8, attackRange: 1,
    });
    // A ranged player two rows off the lane: it reaches the Warden anywhere on row 0 (attackRange 6) but sits
    // OUTSIDE the Warden's melee reach (1), so it never pins him — the exact H-ruling farm geometry.
    const hunter = createUnit({
      id: "hunter", side: "player", pos: { col: 0, row: 2 },
      speed: 10, maxHp: 20, attack: 9, defense: 0, moveRange: 3, sightRadius: 8, attackRange: 6,
    });
    const battle = new Battle(grid, [warden, hunter], { gates: [seal] });

    let plinks = 0;
    for (let round = 0; round < 4 && warden.alive && seal.locked; round++) {
      battle.runPolicyTurn(warden); // !in-combat (the Hunter is out of melee reach) → drives + keys
      if (warden.alive && manhattan(hunter.pos, warden.pos) <= hunter.attackRange) {
        if (battle.attack(hunter, warden) > 0) plinks += 1; // a free plink on the advancing Warden
      }
    }

    expect(plinks).toBeGreaterThan(0); // the farm window was REAL — the Hunter actually shot the advance
    expect(warden.alive).toBe(true); // …and the plinking did NOT farm the garrison to death (the ceiling)
    expect(seal.locked).toBe(false); // the drive still reached + keyed the seal despite eating free hits
    const garrisonCasualties = [warden].filter((u) => !u.alive).length;
    expect(garrisonCasualties).toBe(0); // ceiling = 0 for this drive at the shipped numbers
  });
});
