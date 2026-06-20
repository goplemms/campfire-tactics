import { describe, it, expect } from "vitest";
import {
  createExposure,
  safeDepth,
  placementCost,
  recordPlacement,
  exposureRisk,
  freeCaptive,
  isCaptured,
  CAPTURE_THRESHOLD,
  createAlert,
  deployNoise,
  addNoise,
  rollAlerted,
  captureChance,
  settleAlert,
  NOISE_PER_DEPTH,
  CAPTURE_CHANCE_MAX,
  resolveDeployAction,
  frontSpeed,
  createFront,
  inDangerZone,
  advanceFront,
  frontCaptureChance,
  resolveFrontTurn,
  DeployClock,
  FRONT_SPEED_LEAN,
  DIG_IN_CAPTURE_FACTOR,
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

describe("deployment exposure gamble (D7/D11)", () => {
  it("ranges deeper for free at higher Awareness (banded safe depth)", () => {
    const cautious = unit("Bram", "player", 6); // 2 + 3 = 5
    const reckless = unit("Vale", "player", 2); // 2 + 1 = 3
    expect(safeDepth(cautious)).toBe(5);
    expect(safeDepth(reckless)).toBe(3);
  });

  it("charges exposure per tile of depth beyond the safe zone", () => {
    const vale = unit("Vale", "player", 2); // safe depth 3, 25 per tile deeper
    expect(placementCost(vale, 3)).toBe(0); // within safe depth
    expect(placementCost(vale, 4)).toBe(25);
    expect(placementCost(vale, 6)).toBe(75);
  });

  it("accrues exposure only on deep placements and captures at the threshold", () => {
    const vale = unit("Vale", "player", 2); // safe depth 3
    const st = createExposure();

    // A placement inside the safe depth → free.
    expect(recordPlacement(st, vale, 2)).toEqual({ exposureAdded: 0, captured: false });
    expect(st.exposure).toBe(0);

    // Depth 5 → +50, risk 50%.
    expect(recordPlacement(st, vale, 5)).toEqual({ exposureAdded: 50, captured: false });
    expect(exposureRisk(st)).toBeCloseTo(0.5);
    expect(isCaptured(vale)).toBe(false);

    // Another depth-5 placement → +50 ⇒ 100 ⇒ captured.
    const r = recordPlacement(st, vale, 5);
    expect(r.exposureAdded).toBe(50);
    expect(r.captured).toBe(true);
    expect(st.exposure).toBeGreaterThanOrEqual(CAPTURE_THRESHOLD);
    expect(isCaptured(vale)).toBe(true);
    expect(vale.ct).toBe(0);
  });

  it("high Awareness preps deep before any risk", () => {
    const bram = unit("Bram", "player", 6); // safe depth 5
    const st = createExposure();
    recordPlacement(st, bram, 4);
    recordPlacement(st, bram, 5);
    expect(st.exposure).toBe(0);
    expect(isCaptured(bram)).toBe(false);
  });
});

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

describe("deployment stealth-alert layer (D11)", () => {
  // awareness 2 → safe depth 3 (2 + floor(2/2)).
  const scout = () => unit("scout", "player", 2);

  it("noise is silent within the safe zone and scales past it", () => {
    const u = scout();
    expect(safeDepth(u)).toBe(3);
    expect(deployNoise(u, 3)).toBe(0); // at the safe edge
    expect(deployNoise(u, 4)).toBe(NOISE_PER_DEPTH); // one tile past
    expect(deployNoise(u, 6)).toBe(3 * NOISE_PER_DEPTH);
  });

  it("the shared meter accumulates across units and clamps at the cap", () => {
    const alert = createAlert();
    addNoise(alert, scout(), 5); // +24
    addNoise(alert, scout(), 5); // +24 → 48
    expect(alert.meter).toBe(48);
    for (let i = 0; i < 20; i++) addNoise(alert, scout(), 7);
    expect(alert.meter).toBe(100); // clamped to ALERT_CAP
  });

  it("capture chance rises with depth and is capped", () => {
    const u = scout();
    expect(captureChance(u, 3)).toBe(0); // safe
    expect(captureChance(u, 4)).toBeCloseTo(0.15, 5);
    expect(captureChance(u, 99)).toBe(CAPTURE_CHANCE_MAX); // capped, never a sure loss
  });

  it("alert rolls are deterministic for a given seed", () => {
    const seq = (seed: number) => {
      const alert = createAlert();
      alert.meter = 50;
      const rng = new Rng(seed);
      return Array.from({ length: 8 }, () => rollAlerted(alert, rng));
    };
    expect(seq(42)).toEqual(seq(42)); // same seed → same outcomes
    // a 50% meter over 8 rolls should produce a mix (not all one way)
    const rolls = seq(42);
    expect(rolls.some(Boolean) && rolls.some((b) => !b)).toBe(true);
  });

  it("settling halves the meter after a survived spotting", () => {
    const alert = createAlert();
    alert.meter = 80;
    settleAlert(alert);
    expect(alert.meter).toBe(40);
  });
});

describe("resolveDeployAction — the shared stealth resolver (D11)", () => {
  // 6-wide board; awareness 2 → safe depth 3.
  const grid = () => new TileGrid(6, 4);
  const deep = (col: number) => {
    const u = unit("scout", "player", 2);
    u.pos = { col, row: 1 };
    return u;
  };

  it("a move inside the safe zone is silent (never spotted)", () => {
    const u = deep(2); // within safe depth 3
    const alert = createAlert();
    const out = resolveDeployAction(alert, u, grid(), [u], new Rng(1));
    expect(out.spotted).toBe(false);
    expect(alert.meter).toBe(0);
  });

  it("a forward action with a hot meter is spotted and retreats toward cover", () => {
    const u = deep(5); // 2 past safe
    const ally = unit("ally", "player", 2); // a second body so the last-unit shield doesn't apply
    const alert = createAlert();
    alert.meter = 100; // guarantee a spot
    const out = resolveDeployAction(alert, u, grid(), [u, ally], new Rng(7));
    expect(out.spotted).toBe(true);
    expect(out.retreatPath.length).toBeGreaterThan(0);
    // the retreat ends inside the safe zone
    expect(out.retreatPath[out.retreatPath.length - 1].col).toBeLessThanOrEqual(safeDepth(u));
  });

  it("the party's last un-captured unit is spotted but never netted", () => {
    const u = deep(5);
    const alert = createAlert();
    alert.meter = 100;
    const out = resolveDeployAction(alert, u, grid(), [u], new Rng(7)); // u is the only unit
    expect(out.spotted).toBe(true);
    expect(out.capturedAt).toBe(-1); // protected
  });

  it("is deterministic for a given seed", () => {
    const run = (seed: number) => {
      const u = deep(5);
      const ally = unit("ally", "player", 2);
      const alert = createAlert();
      alert.meter = 80;
      return resolveDeployAction(alert, u, grid(), [u, ally], new Rng(seed));
    };
    expect(run(123)).toEqual(run(123));
  });
});

describe("D63 closing-net front — speed & geometry", () => {
  it("derives front speed as the enemy average leaned toward the fastest", () => {
    const enemies = [unit("a", "enemy", 2, 6), unit("b", "enemy", 2, 6), unit("scout", "enemy", 2, 18)];
    // avg = 10, max = 18; lean 0.5 → 10 + (18-10)*0.5 = 14.
    expect(frontSpeed(enemies, 0.5)).toBe(14);
    // pure average and pure max are the lean endpoints.
    expect(frontSpeed(enemies, 0)).toBe(10);
    expect(frontSpeed(enemies, 1)).toBe(18);
    // a lone scout drags the whole net faster than its sluggish camp average.
    expect(frontSpeed(enemies)).toBeGreaterThan(10);
  });

  it("a fast roster closes the net faster than a slow one", () => {
    const fast = [unit("s", "enemy", 2, 20)];
    const slow = [unit("b", "enemy", 2, 4)];
    expect(frontSpeed(fast)).toBeGreaterThan(frontSpeed(slow));
  });

  it("front starts off the enemy edge and marches toward the home edge", () => {
    const grid = new TileGrid(6, 4);
    const front = createFront(grid, [unit("e", "enemy", 2, 8)]);
    expect(front.col).toBe(6); // off the right edge — nothing dangerous yet
    expect(inDangerZone(5, front)).toBe(false);
    advanceFront(front);
    expect(front.col).toBe(5);
    expect(inDangerZone(5, front)).toBe(true);
    expect(inDangerZone(4, front)).toBe(false);
    for (let i = 0; i < 99; i++) advanceFront(front);
    expect(front.col).toBe(0); // clamps at the home edge
  });
});

describe("D63 front capture chance — spike, depth, dig-in", () => {
  const grid = () => new TileGrid(8, 4);
  const at = (col: number) => {
    const u = unit("scout", "player", 2); // safe depth 3
    u.pos = { col, row: 1 };
    return u;
  };

  it("is zero until the net reaches the unit", () => {
    const front = createFront(grid(), [unit("e", "enemy", 2, 8)]);
    advanceFront(front); // front at col 7
    expect(frontCaptureChance(at(6), front)).toBe(0); // not yet swallowed
    expect(frontCaptureChance(at(7), front)).toBeGreaterThan(0); // at the edge
  });

  it("rises the deeper a unit sits in the danger zone", () => {
    const front = { col: 5, speed: 10 };
    // High Awareness (safe depth 7) keeps the shallow tile below the cap so the
    // depth gradient is visible before it saturates.
    const aware = (col: number) => {
      const u = unit("aware", "player", 10);
      u.pos = { col, row: 1 };
      return u;
    };
    const shallow = frontCaptureChance(aware(5), front);
    const deep = frontCaptureChance(aware(6), front);
    expect(deep).toBeGreaterThan(shallow);
  });

  it("the front spikes the chance well past the plain stealth curve", () => {
    const front = { col: 4, speed: 10 };
    // The stealth model at the same tile (depth 4, safe 3) is a single tile past.
    expect(frontCaptureChance(at(4), front)).toBeGreaterThan(captureChance(at(4), 4));
  });

  it("digging in slashes the capture chance by the dig-in factor", () => {
    const front = { col: 4, speed: 10 };
    const open = frontCaptureChance(at(5), front, { dugIn: false });
    const dug = frontCaptureChance(at(5), front, { dugIn: true });
    expect(dug).toBeCloseTo(open * DIG_IN_CAPTURE_FACTOR, 5);
  });

  it("never exceeds the capture cap, even when surrounded and deep", () => {
    const front = { col: 0, speed: 10 };
    expect(frontCaptureChance(at(7), front)).toBeLessThanOrEqual(CAPTURE_CHANCE_MAX);
  });
});

describe("D63 resolveFrontTurn — advance then roll the swallowed", () => {
  const grid = () => new TileGrid(8, 4);
  const player = (id: string, col: number, row: number) => {
    const u = unit(id, "player", 2);
    u.pos = { col, row };
    return u;
  };

  it("advances the net and reports the engulfed columns", () => {
    const front = createFront(grid(), [unit("e", "enemy", 2, 8)]); // col 8
    const out = resolveFrontTurn(front, [player("a", 0, 0)], new Rng(1));
    expect(out.advancedTo).toBe(7);
    expect(out.newlyEngulfed).toEqual([7]);
  });

  it("rolls capture only for units the net has swallowed, deepest first", () => {
    const safeU = player("safe", 1, 0); // never in the zone
    const a = player("a", 6, 0);
    const b = player("b", 7, 1); // deeper → rolls first
    const front = { col: 7, speed: 10 };
    const out = resolveFrontTurn(front, [safeU, a, b], new Rng(5)); // advances to 6
    expect(out.rolled).not.toContain(safeU);
    expect(out.rolled[0]).toBe(b); // deepest exposed rolls first
  });

  it("the first capture stops the rolls and raises the alarm", () => {
    // A wall of deep units with a hot front: someone gets netted, and only one.
    const us = [player("a", 7, 0), player("b", 7, 1), player("c", 7, 2), player("d", 0, 3)];
    const front = { col: 7, speed: 10 };
    // find a seed that nets someone
    let out = resolveFrontTurn({ ...front }, us.map((u) => ({ ...u, pos: { ...u.pos } }) as typeof u), new Rng(0));
    let seed = 0;
    while (!out.alarm && seed < 200) {
      seed++;
      const fresh = [player("a", 7, 0), player("b", 7, 1), player("c", 7, 2), player("d", 0, 3)];
      out = resolveFrontTurn({ col: 7, speed: 10 }, fresh, new Rng(seed));
    }
    expect(out.alarm).toBe(true);
    expect(out.captured).not.toBeNull();
    expect(out.captured!.captured).toBe(true);
  });

  it("never nets the party's last un-captured fighter", () => {
    const lone = player("lone", 7, 0); // deep in the net, but the only one left
    for (let seed = 0; seed < 50; seed++) {
      const u = player("lone", 7, 0);
      const out = resolveFrontTurn({ col: 7, speed: 10 }, [u], new Rng(seed));
      expect(out.captured).toBeNull();
      expect(u.captured).toBe(false);
    }
    expect(lone.captured).toBe(false);
  });

  it("is deterministic for a given seed", () => {
    const run = (seed: number) => {
      const us = [player("a", 7, 0), player("b", 6, 1)];
      const front = { col: 7, speed: 10 };
      const out = resolveFrontTurn(front, us, new Rng(seed));
      return { advancedTo: out.advancedTo, captured: out.captured?.id ?? null, rolled: out.rolled.map((u) => u.id) };
    };
    expect(run(9)).toEqual(run(9));
  });
});

describe("D63 DeployClock — interleaves player turns with the front", () => {
  const grid = () => new TileGrid(8, 4);

  it("a faster party earns more positioning turns between net-closings", () => {
    const fastParty = [unit("p1", "player", 2, 20), unit("p2", "player", 2, 20)];
    const slowParty = [unit("q1", "player", 2, 6), unit("q2", "player", 2, 6)];
    const enemies = [unit("e", "enemy", 2, 10)];

    const countPlayerTurnsPerFront = (party: Unit[]) => {
      const front = createFront(grid(), enemies);
      const clock = new DeployClock(party, front);
      clock.seed();
      let playerTurns = 0;
      for (let i = 0; i < 40; i++) {
        const t = clock.next();
        if (t.isFront) {
          clock.spendFront();
          break; // measure player turns before the first net-closing
        }
        playerTurns++;
        clock.spend(t.unit!, { moved: true });
      }
      return playerTurns;
    };

    expect(countPlayerTurnsPerFront(fastParty)).toBeGreaterThan(countPlayerTurnsPerFront(slowParty));
  });

  it("the front still takes its turns and excludes captured units", () => {
    const party = [unit("p1", "player", 2, 8), unit("p2", "player", 2, 8)];
    party[1].captured = true;
    const front = createFront(grid(), [unit("e", "enemy", 2, 30)]); // fast net
    const clock = new DeployClock(party, front);
    clock.seed();
    let sawFront = false;
    let sawCaptured = false;
    for (let i = 0; i < 30; i++) {
      const t = clock.next();
      if (t.isFront) {
        sawFront = true;
        clock.spendFront();
      } else {
        if (t.unit === party[1]) sawCaptured = true;
        clock.spend(t.unit!, { moved: true });
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
});
