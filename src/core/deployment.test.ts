import { describe, it, expect } from "vitest";
import {
  freeCaptive,
  frontSpeed,
  createFront,
  createCampfire,
  inDangerZone,
  inSafeZone,
  advanceFront,
  frontCaptureChance,
  captureChanceAt,
  deployForecast,
  resolveFrontTurn,
  safeGroundRemains,
  stepDistance,
  unitPresence,
  partyPresence,
  campfireRadius,
  createDeployClock,
  FRONT_SPEED_LEAN,
  DIG_IN_CAPTURE_FACTOR,
  SAFE_BASE_RADIUS,
  isProtected,
  protectRadiusOn,
  PROTECT_MAP_DIVISOR,
  NEUTRAL_DANGER,
  FRONT_DANGER,
} from "./deployment";
import { CTClock, sideSeed } from "./clock";
import { Rng } from "./rng";
import { TileGrid } from "./grid";
import { createUnit, type Side, type Unit } from "./units";

function unit(id: string, side: Side, awareness: number, speed = 10): Unit {
  return createUnit({
    id,
    side,
    pos: { col: 0, row: 0 },
    awareness,
    speed,
    maxHp: 20,
    attack: 5,
    defense: 1,
    moveRange: 3,
    sightRadius: 4,
  });
}


describe("initiative seed excludes captured units (D7 → D11)", () => {
  it("a captured unit drops from its side's seed and never takes a turn", () => {
    const rook = unit("Rook", "player", 4, 12);
    const vale = unit("Vale", "player", 2, 10);
    const foe = unit("Grunt", "enemy", 3, 9);
    const units = [rook, vale, foe];

    // Before capture, the player seed sums Rook+Vale = 22.
    expect(sideSeed(units, "player")).toBe(22);

    // Capture Vale → the seed DROPS to just Rook (12): losing a unit cost tempo.
    vale.captured = true;
    expect(sideSeed(units, "player")).toBe(12);

    // ...but with Rook also gone the seed would collapse. Here, verify the clock
    // never hands a captured unit a turn.
    const clock = new CTClock(units);
    clock.seedInitiative();
    expect(vale.ct).toBe(0);
    let sawVale = false;
    for (let i = 0; i < 20; i++) {
      const actor = clock.advanceToNextActor();
      if (actor === vale) sawVale = true;
      if (actor) clock.spend(actor, { acted: true });
    }
    expect(sawVale).toBe(false);

    // Freed mid-battle, Vale rejoins the clock and can act.
    freeCaptive(vale);
    let sawValeNow = false;
    for (let i = 0; i < 20; i++) {
      const actor = clock.advanceToNextActor();
      if (actor === vale) sawValeNow = true;
      if (actor) clock.spend(actor, { acted: true });
    }
    expect(sawValeNow).toBe(true);
  });
});



describe("D63 enemy-source speed — leaned toward the fastest", () => {
  it("derives source speed as the enemy average leaned toward the fastest", () => {
    const enemies = [unit("a", "enemy", 2, 6), unit("b", "enemy", 2, 6), unit("scout", "enemy", 2, 18)];
    // avg = 10, max = 18; lean 0.5 → 10 + (18-10)*0.5 = 14.
    expect(frontSpeed(enemies, 0.5)).toBe(14);
    expect(frontSpeed(enemies, 0)).toBe(10);
    expect(frontSpeed(enemies, 1)).toBe(18);
    expect(frontSpeed(enemies)).toBeGreaterThan(10); // a lone scout quickens the net
  });

  it("a fast roster closes the net faster than a slow one", () => {
    expect(frontSpeed([unit("s", "enemy", 2, 20)])).toBeGreaterThan(frontSpeed([unit("b", "enemy", 2, 4)]));
  });
});

describe("D63 campfire presence — party strength sets the safe radius", () => {
  const heavyKnight = () =>
    createUnit({ id: "knight", side: "player", pos: { col: 0, row: 0 }, awareness: 2, speed: 12, maxHp: 34, attack: 11, defense: 4, moveRange: 4, sightRadius: 4 });

  it("a unit's presence sums attack, defense, and a tenth of its HP", () => {
    expect(unitPresence(unit("u", "player", 2))).toBe(8); // 5 + 1 + floor(20/10)
    expect(unitPresence(heavyKnight())).toBe(18); // 11 + 4 + floor(34/10)
  });

  it("party presence counts only living, un-captured player units", () => {
    const a = unit("a", "player", 2);
    const b = unit("b", "player", 2);
    expect(partyPresence([a, b, unit("e", "enemy", 2)])).toBe(16); // foe excluded
    b.captured = true;
    expect(partyPresence([a, b])).toBe(8); // a captured unit drops out
  });

  it("a sturdier party widens the campfire (Heavy Knights intimidate further)", () => {
    const light = [unit("a", "player", 2), unit("b", "player", 2)]; // presence 16
    const heavy = [...light, heavyKnight()]; // +18 presence
    expect(campfireRadius(light)).toBe(SAFE_BASE_RADIUS); // floor(16/20) = 0
    expect(campfireRadius(heavy)).toBeGreaterThan(campfireRadius(light));
  });
});

describe("D63 two-source geometry — campfire vs. the growing danger", () => {
  const grid = () => new TileGrid(8, 5);

  it("anchors the campfire at the home-edge centre and the danger at the enemy edge", () => {
    const g = grid();
    expect(createCampfire(g, [unit("a", "player", 2)]).origin).toEqual({ col: 0, row: 2 });
    const front = createFront(g, [unit("e", "enemy", 2, 8)]);
    expect(front.origin).toEqual({ col: 7, row: 2 });
    expect(front.radius).toBe(0);
  });

  it("measures reach in orthogonal steps", () => {
    expect(stepDistance({ col: 0, row: 0 }, { col: 3, row: 2 })).toBe(5);
  });

  it("the danger radius grows on each advance and swallows nearer tiles", () => {
    const front = createFront(grid(), [unit("e", "enemy", 2, 8)]); // origin {7,2}, r0
    expect(inDangerZone({ col: 7, row: 2 }, front)).toBe(true); // the source tile
    expect(inDangerZone({ col: 6, row: 2 }, front)).toBe(false);
    advanceFront(front); // r1
    expect(inDangerZone({ col: 6, row: 2 }, front)).toBe(true);
    advanceFront(front);
    advanceFront(front); // r3
    expect(inDangerZone({ col: 4, row: 2 }, front)).toBe(true);
  });

  it("safe ground is inside the campfire but unreached by the danger — and it shrinks", () => {
    const g = grid();
    const camp = createCampfire(g, [unit("a", "player", 2)]); // origin {0,2}, radius 2
    const front = createFront(g, [unit("e", "enemy", 2, 8)]); // origin {7,2}
    const home = { col: 0, row: 2 };
    expect(inSafeZone(home, camp, front)).toBe(true);
    for (let i = 0; i < 7; i++) advanceFront(front); // radius 7 reaches {0,2} (dist 7)
    expect(inDangerZone(home, front)).toBe(true);
    expect(inSafeZone(home, camp, front)).toBe(false); // danger overrides the campfire
  });

  it("safe ground remains until the danger overruns the whole campfire", () => {
    const g = grid();
    const camp = createCampfire(g, [unit("a", "player", 2)]);
    const front = createFront(g, [unit("e", "enemy", 2, 8)]);
    expect(safeGroundRemains(g, camp, front)).toBe(true);
    for (let i = 0; i < 20; i++) advanceFront(front);
    expect(safeGroundRemains(g, camp, front)).toBe(false);
  });
});

describe("D-feel protected core — presence-sized, capped to the board width", () => {
  const heavy = () =>
    createUnit({ id: "k", side: "player", pos: { col: 0, row: 0 }, awareness: 2, speed: 12, maxHp: 34, attack: 11, defense: 4, moveRange: 4, sightRadius: 4 });

  it("caps the protected radius to a fraction of the board width (tight on a small map, opens on a big one)", () => {
    const big = [heavy(), heavy(), heavy(), heavy()]; // presence 72 → a large uncapped radius
    expect(campfireRadius(big)).toBeGreaterThan(Math.floor(8 / PROTECT_MAP_DIVISOR));
    expect(protectRadiusOn(new TileGrid(8, 6), big)).toBe(Math.floor(8 / PROTECT_MAP_DIVISOR)); // capped small
    expect(protectRadiusOn(new TileGrid(18, 6), big)).toBeGreaterThan(Math.floor(8 / PROTECT_MAP_DIVISOR)); // opens up
  });

  it("never drops below the base radius, even on a tiny board", () => {
    expect(protectRadiusOn(new TileGrid(3, 3), [unit("a", "player", 2)])).toBe(SAFE_BASE_RADIUS);
  });

  it("isProtected marks the tiles within the campfire's radius", () => {
    const c = { origin: { col: 0, row: 2 }, radius: 2 };
    expect(isProtected({ col: 2, row: 2 }, c)).toBe(true);
    expect(isProtected({ col: 3, row: 2 }, c)).toBe(false);
  });
});

describe("D-feel capture chance — immune core, neutral risk, near-certain net", () => {
  const at = (col: number, row = 2) => {
    const u = unit("u", "player", 2);
    u.pos = { col, row };
    return u;
  };
  const camp = (radius = 2) => ({ origin: { col: 0, row: 2 }, radius });
  const front = (radius: number) => ({ origin: { col: 7, row: 2 }, radius, speed: 10 });

  it("is zero inside the protected core — even when the net has lapped over it", () => {
    expect(captureChanceAt({ col: 1, row: 2 }, camp(2), front(0))).toBe(0);
    expect(captureChanceAt({ col: 1, row: 2 }, camp(2), front(7))).toBe(0); // net over the core: still immune (a breach, not a catch)
  });

  it("open neutral ground carries a real (lower) risk — there is no free ground", () => {
    expect(captureChanceAt(at(4).pos, camp(2), front(0))).toBeCloseTo(NEUTRAL_DANGER, 5);
  });

  it("inside the net is near-guaranteed, and flat wherever it has reached", () => {
    expect(captureChanceAt(at(6).pos, camp(2), front(2))).toBeCloseTo(FRONT_DANGER, 5);
    expect(FRONT_DANGER).toBeGreaterThan(NEUTRAL_DANGER);
    const f = front(5);
    expect(captureChanceAt(at(7).pos, camp(2), f)).toBeCloseTo(captureChanceAt(at(3).pos, camp(2), f), 5);
  });

  it("digging in slashes the chance by the dig-in factor", () => {
    const f = front(5);
    expect(frontCaptureChance(at(4), camp(2), f, { dugIn: true })).toBeCloseTo(
      frontCaptureChance(at(4), camp(2), f, { dugIn: false }) * DIG_IN_CAPTURE_FACTOR,
      5,
    );
  });

  it("the exposure multiplier trims neutral ground but never the net itself", () => {
    expect(captureChanceAt(at(4).pos, camp(2), front(0), { exposureMultiplier: 0.5 })).toBeCloseTo(NEUTRAL_DANGER * 0.5, 5);
    expect(captureChanceAt(at(6).pos, camp(2), front(2), { exposureMultiplier: 0.5 })).toBeCloseTo(FRONT_DANGER, 5); // the net is the net
  });

  it("never exceeds the near-certain net rate", () => {
    expect(frontCaptureChance(at(7), camp(2), front(10))).toBeLessThanOrEqual(FRONT_DANGER);
  });

  it("captureChanceAt scores a bare coord exactly as frontCaptureChance scores the unit", () => {
    const f = front(5);
    const u = at(4);
    expect(captureChanceAt(u.pos, camp(2), f)).toBe(frontCaptureChance(u, camp(2), f));
    expect(captureChanceAt(u.pos, camp(2), f, { dugIn: true })).toBe(frontCaptureChance(u, camp(2), f, { dugIn: true }));
  });
});

describe("D-feel deployForecast — the per-choice risk forecast for the focus card", () => {
  const at = (col: number, row = 2) => {
    const u = unit("u", "player", 2);
    u.pos = { col, row };
    return u;
  };
  const camp = (radius = 2) => ({ origin: { col: 0, row: 2 }, radius });
  const front = (radius: number) => ({ origin: { col: 7, row: 2 }, radius, speed: 10 });

  it("digging in is offered below the hold baseline; stepping into the core reads safe", () => {
    const f = front(5);
    const u = at(4); // in the net
    const coreTile = { col: 1, row: 2 }; // inside the protected core
    const fc = deployForecast(u, camp(2), f, [coreTile]);
    expect(fc.hold).toBe(frontCaptureChance(u, camp(2), f));
    expect(fc.digIn).toBeCloseTo(fc.hold * DIG_IN_CAPTURE_FACTOR, 5);
    expect(fc.move).toBe(0); // stepping into the protected core zeroes it
  });

  it("offers no dig-in figure once the unit is already dug in", () => {
    const f = front(5);
    const u = at(4);
    const fc = deployForecast(u, camp(2), f, [], { dugIn: true });
    expect(fc.digIn).toBeNull();
    expect(fc.hold).toBeCloseTo(frontCaptureChance(u, camp(2), f) * DIG_IN_CAPTURE_FACTOR, 5);
  });

  it("suppresses the move row when no reachable tile beats standing pat", () => {
    const f = front(5);
    const u = at(7); // deepest in the net
    const sameZone = { col: 7, row: 2 }; // its own tile, also in the net — no improvement
    expect(deployForecast(u, camp(2), f, [sameZone]).move).toBeNull();
    expect(deployForecast(u, camp(2), f, []).move).toBeNull();
  });

  it("moving across neutral ground (no core in reach) still reads risky, not safe", () => {
    const f = front(3); // net over cols 4–7
    const u = at(5); // in the net
    const neutralTile = { col: 3, row: 2 }; // out of the net but unprotected → neutral
    const fc = deployForecast(u, camp(2), f, [neutralTile]);
    expect(fc.move).toBeCloseTo(NEUTRAL_DANGER, 5); // better than the net, but not zero
  });
});

describe("D-feel resolveFrontTurn — grow, roll the unprotected, breach the core", () => {
  const grid = () => new TileGrid(8, 5);
  const camp = (radius = 2) => ({ origin: { col: 0, row: 2 }, radius });
  const player = (id: string, col: number, row: number) => {
    const u = unit(id, "player", 2);
    u.pos = { col, row };
    return u;
  };

  it("grows the danger radius one step", () => {
    const front = createFront(grid(), [unit("e", "enemy", 2, 8)]); // r0
    const out = resolveFrontTurn(front, camp(2), [player("a", 0, 2)], new Rng(1));
    expect(out.advancedTo).toBe(1);
    expect(front.radius).toBe(1);
  });

  it("rolls the unprotected nearest the source first; the protected core is exempt", () => {
    const protectedU = player("safe", 1, 2); // inside the core
    const a = player("a", 4, 2); // unprotected, dist 3 from source
    const b = player("b", 6, 2); // unprotected, dist 1 — deeper, rolls first
    const front = { origin: { col: 7, row: 2 }, radius: 4, speed: 10 }; // grows to 5
    const out = resolveFrontTurn(front, camp(2), [protectedU, a, b], new Rng(5));
    expect(out.rolled).not.toContain(protectedU);
    expect(out.rolled[0]).toBe(b);
  });

  it("rolls neutral (unprotected, not-yet-netted) units too — no free open ground", () => {
    const neutralA = player("a", 4, 2); // unprotected, outside the net → neutral
    const neutralB = player("b", 5, 1); // unprotected, outside the net → neutral
    const protectedU = player("safe", 1, 2);
    const front = { origin: { col: 7, row: 2 }, radius: 0, speed: 10 }; // → r1, far from these tiles
    const out = resolveFrontTurn(front, camp(2), [neutralA, neutralB, protectedU], new Rng(3));
    expect(out.rolled).not.toContain(protectedU); // the core never rolls
    expect(out.rolled.length).toBeGreaterThan(0); // neutral ground is rolled
  });

  it("the first capture stops the rolls and raises the alarm", () => {
    let out = resolveFrontTurn({ origin: { col: 7, row: 2 }, radius: 4, speed: 10 }, camp(2), [player("z", 1, 2)], new Rng(0));
    let seed = 0;
    while (!out.alarm && seed < 300) {
      seed++;
      const us = [player("a", 6, 2), player("b", 6, 1), player("c", 6, 3), player("d", 1, 2)];
      out = resolveFrontTurn({ origin: { col: 7, row: 2 }, radius: 4, speed: 10 }, camp(2), us, new Rng(seed));
    }
    expect(out.alarm).toBe(true);
    expect(out.captured).not.toBeNull();
  });

  it("breaches (no catch, but the alarm goes up) when the net reaches a unit in the core", () => {
    const front = { origin: { col: 7, row: 2 }, radius: 6, speed: 10 }; // → r7 reaches (0,2)
    const u = player("safe", 0, 2); // in the core
    const ally = player("ally", 1, 2); // also in the core (so this isn't the lone-fighter case)
    const out = resolveFrontTurn(front, camp(2), [u, ally], new Rng(0));
    expect(out.captured).toBeNull();
    expect(out.breached).toBe(true);
    expect(out.alarm).toBe(false);
  });

  it("does not breach while the net is short of the core", () => {
    const front = { origin: { col: 7, row: 2 }, radius: 1, speed: 10 }; // → r2, nowhere near the core
    const u = player("safe", 1, 2);
    const ally = player("ally", 2, 2); // both protected → no catches, no breach
    const out = resolveFrontTurn(front, camp(2), [u, ally], new Rng(1));
    expect(out.breached).toBe(false);
  });

  it("never catches the party's last un-captured fighter", () => {
    for (let seed = 0; seed < 50; seed++) {
      const u = player("lone", 6, 2);
      const out = resolveFrontTurn({ origin: { col: 7, row: 2 }, radius: 5, speed: 10 }, camp(2), [u], new Rng(seed));
      expect(out.captured).toBeNull();
      expect(u.captured).toBe(false);
    }
  });

  it("is deterministic for a given seed", () => {
    const run = (seed: number) => {
      const us = [player("a", 6, 2), player("b", 5, 2), player("anchor", 1, 2)];
      const out = resolveFrontTurn({ origin: { col: 7, row: 2 }, radius: 4, speed: 10 }, camp(2), us, new Rng(seed));
      return { advancedTo: out.advancedTo, captured: out.captured?.id ?? null, rolled: out.rolled.map((u) => u.id), breached: out.breached };
    };
    expect(run(9)).toEqual(run(9));
  });
});

describe("D63/D67 deploy clock — the front folds onto the one CTClock as a tempo source", () => {
  const grid = () => new TileGrid(8, 4);

  it("a faster party earns more positioning turns between net-closings", () => {
    const fastParty = [unit("p1", "player", 2, 20), unit("p2", "player", 2, 20)];
    const slowParty = [unit("q1", "player", 2, 6), unit("q2", "player", 2, 6)];
    const enemies = [unit("e", "enemy", 2, 10)];

    const countPlayerTurnsPerFront = (party: Unit[]) => {
      const front = createFront(grid(), enemies);
      const clock = createDeployClock(party, front);
      clock.seedFlat();
      let playerTurns = 0;
      for (let i = 0; i < 40; i++) {
        const t = clock.nextTurn();
        if (t.kind !== "unit") {
          clock.spendTempo();
          break; // measure player turns before the first net-closing
        }
        playerTurns++;
        clock.spend(t.unit, { moved: true });
      }
      return playerTurns;
    };

    expect(countPlayerTurnsPerFront(fastParty)).toBeGreaterThan(countPlayerTurnsPerFront(slowParty));
  });

  it("the front still takes its turns and excludes captured units", () => {
    const party = [unit("p1", "player", 2, 8), unit("p2", "player", 2, 8)];
    party[1].captured = true;
    const front = createFront(grid(), [unit("e", "enemy", 2, 30)]); // fast net
    const clock = createDeployClock(party, front);
    clock.seedFlat();
    let sawFront = false;
    let sawCaptured = false;
    for (let i = 0; i < 30; i++) {
      const t = clock.nextTurn();
      if (t.kind !== "unit") {
        sawFront = true;
        clock.spendTempo();
      } else {
        if (t.unit === party[1]) sawCaptured = true;
        clock.spend(t.unit, { moved: true });
      }
    }
    expect(sawFront).toBe(true);
    expect(sawCaptured).toBe(false);
  });

  it("uses the configured lean by default", () => {
    // documents that createFront/frontSpeed share the default lean knob.
    const enemies = [unit("a", "enemy", 2, 4), unit("b", "enemy", 2, 16)];
    const front = createFront(grid(), enemies);
    expect(front.speed).toBe(frontSpeed(enemies, FRONT_SPEED_LEAN));
  });

  it("freezes the enemies off the one clock (W1 — built over the WHOLE roster, narrowed to players)", () => {
    // The deploy clock now carries the *same* roster combat runs on — players AND the
    // pre-positioned enemies — but its participant predicate narrows turn-taking to the
    // active party. The enemies must neither tick toward CT nor ever be handed a turn.
    const players = [unit("p1", "player", 2, 8), unit("p2", "player", 2, 8)];
    const enemies = [unit("e1", "enemy", 2, 30), unit("e2", "enemy", 2, 30)]; // fast, but frozen
    const front = createFront(grid(), enemies);
    const clock = createDeployClock([...players, ...enemies], front);
    clock.seedFlat();
    expect(enemies.every((e) => e.ct === 0)).toBe(true); // not seeded — only the party is

    const actors = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const t = clock.nextTurn();
      if (t.kind !== "unit") {
        clock.spendTempo();
        continue;
      }
      actors.add(t.unit.id);
      clock.spend(t.unit, { moved: true });
    }
    expect([...actors].sort()).toEqual(["p1", "p2"]); // never an enemy
    expect(enemies.every((e) => e.ct === 0)).toBe(true); // never charged, despite their high Speed
  });
});
