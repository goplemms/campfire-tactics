/**
 * Deployment — the push-your-luck deployment gamble (D7/D11).
 *
 * Deployment plays out **on the board**, like combat: units walk out (and may
 * lay traps) where they stand. The gamble is **spatial** — a **safe depth** near
 * your edge (banded by Awareness) is silent, but each tile **deeper** you commit
 * a noisy action carries more risk.
 *
 * This module carries two models on that same spatial spine:
 *  - **M5b** — a transparent *deterministic* exposure meter (placement depth →
 *    {@link recordPlacement}); cross {@link CAPTURE_THRESHOLD} and the unit is
 *    captured. Kept for reference / re-use.
 *  - **D11** — the *stealth* model both scenes now run on: a shared, party-wide
 *    camp-alert meter that noisy actions raise, a seeded **spot** roll, and a
 *    **bolt-for-cover retreat** with a per-tile capture roll (the party's last
 *    un-captured fighter is never netted). See {@link resolveDeployAction}.
 *
 * Either way a captured unit is **bound on the map**, dropped from the initiative
 * seed, a rescuable sub-objective in the battle. Pure logic: no Phaser, no DOM.
 */

import type { Unit } from "./units";
import type { Rng } from "./rng";
import type { TileGrid } from "./grid";
import type { GridCoord } from "./iso";
import { findPath } from "./pathfinding";
import { occupiedGrid } from "./ai";
import { effectiveSpeed, TURN_THRESHOLD, ACT_COST, MOVE_COST, type TurnSpend } from "./clock";

/** Exposure at which a unit is captured. */
export const CAPTURE_THRESHOLD = 100;

/** Exposure added per tile of depth **beyond** the safe zone. */
export const EXPOSURE_PER_DEPTH = 25;

/** Per-unit deployment exposure state. */
export interface DeployExposure {
  /** Entities placed so far. */
  placements: number;
  /** Accumulated exposure (>= threshold ⇒ captured). */
  exposure: number;
  captured: boolean;
}

/** Fresh exposure state for a unit that hasn't placed anything yet. */
export function createExposure(): DeployExposure {
  return { placements: 0, exposure: 0, captured: false };
}

/**
 * How deep (in tiles from the party's safe edge) a unit may place at **zero
 * risk** — banded by Awareness (D11). A high-Awareness unit ranges further
 * before the meter moves.
 */
export function safeDepth(unit: Unit, moraleDepthBonus = 0): number {
  return 2 + Math.floor(unit.awareness / 2) + moraleDepthBonus;
}

/**
 * Exposure a placement at the given `depth` (tiles from the safe edge) would
 * add — zero within the safe depth, then {@link EXPOSURE_PER_DEPTH} per tile
 * deeper. Morale (D8) feeds two knobs: a wider `safeDepthBonus` and an
 * `exposureMultiplier` (<1 = confident units expose themselves less).
 */
export function placementCost(
  unit: Unit,
  depth: number,
  morale: { safeDepthBonus?: number; exposureMultiplier?: number } = {},
): number {
  const safe = safeDepth(unit, morale.safeDepthBonus ?? 0);
  const raw = Math.max(0, depth - safe) * EXPOSURE_PER_DEPTH;
  return Math.round(raw * (morale.exposureMultiplier ?? 1));
}

/** Current exposure as a 0..1 fraction, for the board meter. */
export function exposureRisk(state: DeployExposure): number {
  return Math.min(1, state.exposure / CAPTURE_THRESHOLD);
}

/**
 * Record a placement by `unit` at the given `depth`: accrue its exposure cost
 * and capture the unit if exposure crosses the threshold. Returns the exposure
 * added and whether the unit is now captured.
 */
export function recordPlacement(
  state: DeployExposure,
  unit: Unit,
  depth: number,
  morale: { safeDepthBonus?: number; exposureMultiplier?: number } = {},
): { exposureAdded: number; captured: boolean } {
  const cost = placementCost(unit, depth, morale);
  state.placements += 1;
  state.exposure += cost;
  if (!state.captured && state.exposure >= CAPTURE_THRESHOLD) {
    state.captured = true;
    captureUnit(unit);
  }
  return { exposureAdded: cost, captured: state.captured };
}

// --- Capture / rescue (the shared state, D7) -------------------------------

/** Mark a unit captured: bound, cold on the clock (excluded from the seed). */
export function captureUnit(unit: Unit): void {
  unit.captured = true;
  unit.ct = 0;
}

/** Free a captured unit (a rescue): it rejoins the clock cold. */
export function freeCaptive(unit: Unit): void {
  unit.captured = false;
  unit.ct = 0;
}

/** True if the unit is currently captured. */
export function isCaptured(unit: Unit): boolean {
  return unit.captured;
}

// --- D11: the stealth-alert layer (party-wide cumulative awareness) ---------
//
// A second, *probabilistic* deployment model layered on the same spatial depth:
// each forward action raises a **shared camp-awareness meter**; the further past
// safe depth, the more noise. After a noisy action you **roll against the meter**
// — on an alert the spotted unit auto-retreats to safety, and **each tile of that
// retreat is a capture roll** whose odds scale with how deep it was caught. All
// rolls take a seeded {@link Rng}, so a given seed always plays out the same.

/** Camp awareness gained per tile a unit deploys past its safe depth. */
export const NOISE_PER_DEPTH = 12;
/** Awareness ceiling — the alert chance on an action is `meter / ALERT_CAP`. */
export const ALERT_CAP = 100;
/** Per-tile capture chance gained per tile past safe depth, during a retreat. */
export const CAPTURE_PER_DEPTH = 0.15;
/** Cap on the per-tile capture chance, so even a deep retreat isn't a sure loss. */
export const CAPTURE_CHANCE_MAX = 0.6;
/** Fraction the meter settles to after a spotting that ends without a capture. */
export const ALERT_SETTLE = 0.5;

/** Party-wide deployment awareness (D11): one shared meter the camp accrues. */
export interface DeployAlert {
  meter: number;
}

/** A fresh (silent) alert meter for the start of a deployment. */
export function createAlert(): DeployAlert {
  return { meter: 0 };
}

/** Awareness a unit raises by deploying to `depth` — zero within its safe depth. */
export function deployNoise(unit: Unit, depth: number, moraleDepthBonus = 0): number {
  return Math.max(0, depth - safeDepth(unit, moraleDepthBonus)) * NOISE_PER_DEPTH;
}

/** Add a unit's deploy noise to the shared meter (clamped to the cap); returns it. */
export function addNoise(alert: DeployAlert, unit: Unit, depth: number, moraleDepthBonus = 0): number {
  alert.meter = Math.min(ALERT_CAP, alert.meter + deployNoise(unit, depth, moraleDepthBonus));
  return alert.meter;
}

/** Roll whether the camp spots a forward action, weighted by the current meter. */
export function rollAlerted(alert: DeployAlert, rng: Rng): boolean {
  return rng.chance(alert.meter / ALERT_CAP);
}

/**
 * The per-tile capture chance for a unit caught at `depth`, scaling with how far
 * past its safe depth it ranged — so a deep push is a long, dangerous walk home
 * and a shallow one usually slips back.
 */
export function captureChance(unit: Unit, depth: number, moraleDepthBonus = 0): number {
  return Math.min(CAPTURE_CHANCE_MAX, Math.max(0, depth - safeDepth(unit, moraleDepthBonus)) * CAPTURE_PER_DEPTH);
}

/** Settle the meter after a survived spotting — the patrol checked and relaxed. */
export function settleAlert(alert: DeployAlert): void {
  alert.meter = Math.round(alert.meter * ALERT_SETTLE);
}

/**
 * The resolved outcome of one noisy deploy action: whether the camp spotted it,
 * and if so the spotted unit's retreat path to cover and where (if anywhere) it
 * gets netted. The scene just *plays* this plan — all the rolls happened here.
 */
export interface DeployOutcome {
  spotted: boolean;
  /** Tiles the spotted unit retreats along toward cover (empty if not spotted). */
  retreatPath: GridCoord[];
  /** Index into retreatPath where the unit is netted, or -1 if it reaches cover. */
  capturedAt: number;
}

/**
 * The closest reachable, unoccupied tile inside `unit`'s safe depth — returned as
 * the retreat path (origin tile dropped), or `[]` if there's nowhere to fall back.
 */
export function nearestSafePath(grid: TileGrid, units: readonly Unit[], unit: Unit, moraleDepthBonus = 0): GridCoord[] {
  const safe = Math.min(safeDepth(unit, moraleDepthBonus), grid.cols - 1);
  const nav = occupiedGrid(grid, units, [unit]);
  let best: GridCoord[] | null = null;
  for (let col = safe; col >= 0; col--) {
    for (let row = 0; row < grid.rows; row++) {
      const t = { col, row };
      if (!grid.isWalkable(t)) continue;
      if (units.some((u) => u !== unit && u.alive && u.pos.col === col && u.pos.row === row)) continue;
      const p = findPath(nav, unit.pos, t);
      if (p && (!best || p.length < best.length)) best = p;
    }
  }
  return best ? best.slice(1) : [];
}

/**
 * Resolve a noisy deployment action end to end (the D11 stealth gamble), the one
 * model both the demo and the full game run on: add the unit's depth noise to the
 * shared meter, roll whether the camp spots it, and if so plan the retreat to
 * cover and roll capture per tile — the party's last un-captured fighter is never
 * netted. A silent action (within safe depth) is a no-op. Every roll takes the
 * seeded `rng`, so the whole outcome is reproducible.
 */
export function resolveDeployAction(
  alert: DeployAlert,
  unit: Unit,
  grid: TileGrid,
  units: readonly Unit[],
  rng: Rng,
  moraleDepthBonus = 0,
): DeployOutcome {
  const quiet: DeployOutcome = { spotted: false, retreatPath: [], capturedAt: -1 };
  if (deployNoise(unit, unit.pos.col, moraleDepthBonus) === 0) return quiet; // within cover — silent
  addNoise(alert, unit, unit.pos.col, moraleDepthBonus);
  if (!rollAlerted(alert, rng)) return quiet;

  const retreatPath = nearestSafePath(grid, units, unit, moraleDepthBonus);
  const protectedLast = units.filter((u) => u.side === unit.side && !u.captured).length <= 1;
  let capturedAt = -1;
  if (!protectedLast) {
    for (let i = 0; i < retreatPath.length; i++) {
      if (rng.chance(captureChance(unit, retreatPath[i].col, moraleDepthBonus))) {
        capturedAt = i;
        break;
      }
    }
  }
  if (capturedAt === -1) settleAlert(alert); // got away — the patrol relaxes
  return { spotted: true, retreatPath, capturedAt };
}

// --- D63: the closing-net deployment front ----------------------------------
//
// Deployment is a **turn-based stealth phase**: player units take real turns on a
// CT clock, and the enemy is represented by a single advancing **danger front** —
// a column that marches from the enemy (right) edge toward the party's home edge
// (col 0). The front is itself an actor on the clock, with a Speed derived from
// the enemy roster (leaning toward the fastest scout), so a quick camp closes the
// net faster. Capture is rolled **only on the front's turn**, for every unit the
// net has swallowed — never per player turn, so a fast party gets *more*
// positioning turns without being punished with *more* capture dice. A unit can
// **Dig In** to hunker on its tile at a fraction of the capture chance. The first
// unit netted raises the alarm and combat begins; if the front overruns the home
// edge first, the scene starts the battle anyway.

/** Columns the danger front advances on each of its turns. */
export const FRONT_ADVANCE_PER_TURN = 1;
/** Lean toward the fastest enemy when deriving front Speed (0 = average, 1 = max). */
export const FRONT_SPEED_LEAN = 0.5;
/** How sharply the front spikes the per-turn capture chance over the stealth curve. */
export const FRONT_DANGER_MULTIPLIER = 3;
/** Fraction of the capture chance a dug-in unit faces (hunkered = hard to grab). */
export const DIG_IN_CAPTURE_FACTOR = 0.25;

/** The advancing enemy danger front (D63): cols `>= col` are the danger zone. */
export interface DeployFront {
  /** Leftmost dangerous column; starts off the right edge and marches toward 0. */
  col: number;
  /** CT-style Speed — how fast the net closes, derived from the enemy roster. */
  speed: number;
}

/**
 * The front's Speed: the enemy roster's average Speed pulled toward its fastest
 * member by {@link FRONT_SPEED_LEAN}. A camp of sluggish bruisers closes slowly;
 * a lone scout in the mix noticeably quickens the net. Floored at 1.
 */
export function frontSpeed(enemies: readonly Unit[], lean = FRONT_SPEED_LEAN): number {
  if (enemies.length === 0) return 1;
  const speeds = enemies.map((e) => e.speed);
  const avg = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  const max = Math.max(...speeds);
  return Math.max(1, Math.round(avg + (max - avg) * lean));
}

/** A fresh front parked off the enemy edge (nothing dangerous yet). */
export function createFront(grid: TileGrid, enemies: readonly Unit[], lean = FRONT_SPEED_LEAN): DeployFront {
  return { col: grid.cols, speed: frontSpeed(enemies, lean) };
}

/** True if column `col` is inside (at or past) the danger front. */
export function inDangerZone(col: number, front: DeployFront): boolean {
  return col >= front.col;
}

/** Push the front one (or `by`) columns toward the home edge, clamped at 0. */
export function advanceFront(front: DeployFront, by = FRONT_ADVANCE_PER_TURN): void {
  front.col = Math.max(0, front.col - by);
}

/**
 * The per-front-turn capture chance for `unit`: zero unless the net has reached
 * it, then scaling with how deep into the danger zone it sits (more enemies
 * around it) **and** how far past its own safe depth it ranged — spiked by
 * {@link FRONT_DANGER_MULTIPLIER} and slashed for a dug-in unit. Capped by
 * {@link CAPTURE_CHANCE_MAX} so even a deep, surrounded unit is never a sure loss.
 */
export function frontCaptureChance(
  unit: Unit,
  front: DeployFront,
  opts: { moraleDepthBonus?: number; dugIn?: boolean } = {},
): number {
  if (!inDangerZone(unit.pos.col, front)) return 0;
  const depthPastFront = unit.pos.col - front.col + 1; // >= 1 once swallowed
  const pastSafe = Math.max(0, unit.pos.col - safeDepth(unit, opts.moraleDepthBonus ?? 0));
  let chance = Math.min(CAPTURE_CHANCE_MAX, (depthPastFront + pastSafe) * CAPTURE_PER_DEPTH * FRONT_DANGER_MULTIPLIER);
  if (opts.dugIn) chance *= DIG_IN_CAPTURE_FACTOR;
  return chance;
}

/** The resolved outcome of one front turn — the net advances, then rolls capture. */
export interface FrontTurnOutcome {
  /** The front's new column after advancing. */
  advancedTo: number;
  /** Columns that became dangerous on this turn (for the engulf FX). */
  newlyEngulfed: number[];
  /** The first unit netted this turn, or null. */
  captured: Unit | null;
  /** Units that faced a capture roll, deepest first. */
  rolled: Unit[];
  /** True if a capture raised the alarm (combat should begin). */
  alarm: boolean;
}

/**
 * Resolve the front's turn (D63): advance the net one step, then roll capture for
 * every player unit it has swallowed — deepest (most exposed) first. The party's
 * **last un-captured fighter is never netted** (parity with the stealth retreat),
 * and the **first** capture stops the rolls and raises the alarm. All rolls take
 * the seeded `rng`, so the whole turn is reproducible.
 */
export function resolveFrontTurn(
  front: DeployFront,
  units: readonly Unit[],
  rng: Rng,
  opts: { moraleDepthBonus?: number; dugIn?: (u: Unit) => boolean; by?: number } = {},
): FrontTurnOutcome {
  const before = front.col;
  advanceFront(front, opts.by ?? FRONT_ADVANCE_PER_TURN);
  const newlyEngulfed: number[] = [];
  for (let c = front.col; c < before; c++) newlyEngulfed.push(c);

  const exposed = units
    .filter((u) => u.side === "player" && u.alive && !u.captured && inDangerZone(u.pos.col, front))
    .sort((a, b) => b.pos.col - a.pos.col || a.pos.row - b.pos.row || a.id.localeCompare(b.id));

  const rolled: Unit[] = [];
  let captured: Unit | null = null;
  let remaining = units.filter((u) => u.side === "player" && !u.captured).length;
  for (const u of exposed) {
    if (remaining <= 1) break; // never net the party's last fighter
    rolled.push(u);
    const dugIn = opts.dugIn?.(u) ?? false;
    if (rng.chance(frontCaptureChance(u, front, { moraleDepthBonus: opts.moraleDepthBonus, dugIn }))) {
      captureUnit(u);
      captured = u;
      remaining -= 1;
      break; // first capture raises the alarm → combat begins
    }
  }
  return { advancedTo: front.col, newlyEngulfed, captured, rolled, alarm: captured !== null };
}

/** Whose turn it is in the deployment clock — a player unit, or the front. */
export interface DeployTurn {
  /** The player unit to act, or null when it's the front's turn. */
  unit: Unit | null;
  /** True when the front acts this step. */
  isFront: boolean;
}

/**
 * The deployment-phase clock (D63): player units and the enemy front share one CT
 * timeline, exactly like combat's {@link CTClock}, so initiative reads the same.
 * Player units charge by their effective Speed; the front charges by its derived
 * Speed. Because capture is rolled on the front's turn (not per player turn), a
 * faster party simply earns more positioning turns between net-closings.
 */
export class DeployClock {
  /** The front's charge-time accumulator. */
  frontCt = 0;
  private readonly players: Unit[];

  constructor(units: readonly Unit[], private readonly front: DeployFront) {
    this.players = units.filter((u) => u.side === "player");
  }

  /** Seed player CT from Speed (a warmer party acts first); the front starts cold. */
  seed(bonus = 0): void {
    for (const u of this.players) u.ct = u.captured ? 0 : Math.max(0, u.speed + bonus);
    this.frontCt = 0;
  }

  private tick(): void {
    for (const u of this.players) {
      if (!u.alive || u.captured) continue;
      u.ct += effectiveSpeed(u);
    }
    this.frontCt += this.front.speed;
  }

  private ready(): boolean {
    return this.frontCt >= TURN_THRESHOLD || this.players.some((u) => u.alive && !u.captured && u.ct >= TURN_THRESHOLD);
  }

  /**
   * Tick until a player unit or the front is ready, then return the readiest. The
   * front wins only on a strict CT lead — players take ties, so Speed and Awareness
   * keep buying the party its turns. Returns the front if no player can act.
   */
  next(): DeployTurn {
    let guard = 0;
    const GUARD_MAX = 1_000_000;
    while (!this.ready()) {
      this.tick();
      if (++guard > GUARD_MAX) return { unit: null, isFront: true };
    }
    const readyPlayers = this.players
      .filter((u) => u.alive && !u.captured && u.ct >= TURN_THRESHOLD)
      .sort((a, b) => b.ct - a.ct || b.speed - a.speed || a.id.localeCompare(b.id));
    const best = readyPlayers[0];
    if (this.frontCt >= TURN_THRESHOLD && (!best || this.frontCt > best.ct)) {
      return { unit: null, isFront: true };
    }
    return best ? { unit: best, isFront: false } : { unit: null, isFront: true };
  }

  /** Spend a player unit's CT after its turn (acting costs more than only moving). */
  spend(unit: Unit, spend: TurnSpend): void {
    unit.ct -= spend.acted ? ACT_COST : MOVE_COST;
  }

  /** Spend the front's CT after its turn. */
  spendFront(): void {
    this.frontCt -= TURN_THRESHOLD;
  }
}
