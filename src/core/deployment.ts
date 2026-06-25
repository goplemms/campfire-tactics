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
import { effectiveSpeed, byReadiest, tickUntilReady, TURN_THRESHOLD, ACT_COST, MOVE_COST, type TurnSpend } from "./clock";
import { PASSIVE } from "./combat";
import { hasStatus, SWIFT } from "./status";

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

// --- D63: the closing-net deployment — two influence sources ----------------
//
// Deployment is a **turn-based stealth phase**: player units take real turns on a
// CT clock, and the board is shaped by **two radial influence sources** measured
// in orthogonal steps:
//  - the party's **campfire** (a home-side anchor) whose **safe radius** scales
//    with the party's total combat *presence* — a sturdier party (Heavy Knights
//    and the like) intimidates further out;
//  - the enemy's **danger source**, whose radius **grows one step on each of its
//    turns** (a single actor on the deployment clock, Speed leaned toward the
//    enemy's fastest). The danger **overrides** the campfire, so a growing enemy
//    radius eats into your safe ground — your territory shrinks turn by turn.
//
// Capture is rolled **only on the enemy source's turn**, for every unit inside the
// danger radius — never per player turn, so a fast party gets *more* positioning
// turns without *more* capture dice. A unit can **Dig In** to hunker at a fraction
// of the capture chance. The first unit caught raises the alarm and combat begins;
// if the danger overruns every last safe tile first, the scene starts it anyway.

/** Steps the danger radius grows on each of the enemy source's turns. */
export const FRONT_ADVANCE_PER_TURN = 1;
/** Lean toward the fastest enemy when deriving the source's Speed (0 = avg, 1 = max). */
export const FRONT_SPEED_LEAN = 0.5;
/**
 * Per-net-turn capture chance for a unit caught **inside the net** (the red zone) —
 * "near-guaranteed for anyone who isn't an infiltrator." Only dig-in and the Scout's
 * evasion cut it (the net is the net — confidence/scouting don't help once it's on you).
 */
export const FRONT_DANGER = 0.95;
/**
 * Per-net-turn capture chance on **neutral** ground — unprotected, but the net hasn't
 * reached it yet. Lower than the net, but real: there is no free open ground. A
 * confident / scouted party trims it via the morale+intel exposure multiplier.
 */
export const NEUTRAL_DANGER = 0.4;
/** Fraction of the capture chance a dug-in unit faces (hunkered = hard to grab). */
export const DIG_IN_CAPTURE_FACTOR = 0.25;
/** Quiet Footsteps (D68): the Scout passive's capture-chance multiplier — it slips the net. */
export const QUIET_FOOTSTEPS_CAPTURE_FACTOR = 0.5;
/** Dash's transient capture cut (D68): an extra multiplier while a quiet unit is Swift (darting deep). */
export const DASH_CAPTURE_FACTOR = 0.5;
/** Base **protected** radius (steps): the capture-immune green core around the campfire. */
export const SAFE_BASE_RADIUS = 2;
/** Party presence per extra step of protected radius (a sturdier party holds more ground). */
export const SAFE_POWER_PER_STEP = 20;
/**
 * Caps the protected radius to a fraction of the board's width, so the green core can't
 * blanket a small map (the original "safe range is huge on small maps" complaint). A
 * floor of {@link SAFE_BASE_RADIUS} keeps even the tightest board playable.
 */
export const PROTECT_MAP_DIVISOR = 3;

/** A unit's deployment **presence** — its intimidation weight at the campfire. */
export function unitPresence(unit: Unit): number {
  return unit.attack + unit.defense + Math.floor(unit.maxHp / 10);
}

/** The party's summed presence (living, un-captured player units). */
export function partyPresence(units: readonly Unit[]): number {
  return units
    .filter((u) => u.side === "player" && u.alive && !u.captured)
    .reduce((sum, u) => sum + unitPresence(u), 0);
}

/** The campfire's protected radius (steps), uncapped: a base widened by the party's presence. */
export function campfireRadius(units: readonly Unit[]): number {
  return Math.max(1, SAFE_BASE_RADIUS + Math.floor(partyPresence(units) / SAFE_POWER_PER_STEP));
}

/**
 * The protected radius the campfire actually projects on `grid` — the presence-sized
 * {@link campfireRadius}, **capped to a fraction of the board width** ({@link
 * PROTECT_MAP_DIVISOR}) so the green core stays tight on a small map and only opens up
 * on larger ground. Floored at {@link SAFE_BASE_RADIUS}.
 */
export function protectRadiusOn(grid: TileGrid, units: readonly Unit[]): number {
  const cap = Math.max(SAFE_BASE_RADIUS, Math.floor(grid.cols / PROTECT_MAP_DIVISOR));
  return Math.min(campfireRadius(units), cap);
}

/** A radial influence source on the board, measured in orthogonal steps. */
export interface DeploySource {
  origin: GridCoord;
  /** Reach in steps — tiles within this Manhattan distance are inside. */
  radius: number;
}

/** The enemy danger source (D63): a {@link DeploySource} that ticks on the clock. */
export interface DeployFront extends DeploySource {
  /** CT-style Speed — how fast the source closes, derived from the enemy roster. */
  speed: number;
}

/** Orthogonal (Manhattan) step distance between two tiles. */
export function stepDistance(a: GridCoord, b: GridCoord): number {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

/**
 * The enemy source's Speed: the roster's average Speed pulled toward its fastest
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

/** The campfire anchored at the home-edge centre, its protected radius presence-sized and map-capped. */
export function createCampfire(grid: TileGrid, units: readonly Unit[]): DeploySource {
  return { origin: { col: 0, row: Math.floor((grid.rows - 1) / 2) }, radius: protectRadiusOn(grid, units) };
}

/** A fresh enemy danger source at the enemy-edge centre (nothing dangerous yet). */
export function createFront(grid: TileGrid, enemies: readonly Unit[], lean = FRONT_SPEED_LEAN): DeployFront {
  return { origin: { col: grid.cols - 1, row: Math.floor((grid.rows - 1) / 2) }, radius: 0, speed: frontSpeed(enemies, lean) };
}

/** True if `coord` is inside the enemy danger radius (the net — the red zone). */
export function inDangerZone(coord: GridCoord, front: DeploySource): boolean {
  return stepDistance(coord, front.origin) <= front.radius;
}

/**
 * True if `coord` is inside the campfire's **protected** radius — the green core where
 * a unit is **capture-immune** (D-feel). Protection is what carves safety out of an
 * otherwise-hostile board; everything outside it is a danger zone (neutral or net).
 */
export function isProtected(coord: GridCoord, camp: DeploySource): boolean {
  return stepDistance(coord, camp.origin) <= camp.radius;
}

/**
 * True if `coord` reads as safe ground for the overlays: protected by the campfire and
 * **not yet reached by the net**. (A protected tile the net has lapped over no longer
 * paints green — the contact is what ends deployment — but the unit there is still
 * never captured; see {@link captureChanceAt}.)
 */
export function inSafeZone(coord: GridCoord, camp: DeploySource, front: DeploySource): boolean {
  return isProtected(coord, camp) && !inDangerZone(coord, front);
}

/** Grow the danger radius one (or `by`) steps. */
export function advanceFront(front: DeployFront, by = FRONT_ADVANCE_PER_TURN): void {
  front.radius += by;
}

/**
 * The per-net-turn capture chance for `unit` — the zone model (D-feel): **0** inside
 * the campfire's protected core (capture-immune), {@link FRONT_DANGER} inside the net
 * (near-guaranteed), {@link NEUTRAL_DANGER} on open neutral ground. Dig-in and the
 * Scout's {@link captureEvasionFactor evasion} cut it; a confident/scouted party trims
 * the *neutral* rate via `exposureMultiplier` (the morale+intel deploy edge, D8/D10).
 */
export function frontCaptureChance(
  unit: Unit,
  camp: DeploySource,
  front: DeploySource,
  opts: { dugIn?: boolean; exposureMultiplier?: number } = {},
): number {
  return captureChanceAt(unit.pos, camp, front, { ...opts, evasion: captureEvasionFactor(unit) });
}

/**
 * The capture chance at an arbitrary `coord` — the position-only core of
 * {@link frontCaptureChance}, so a forecast can score *hypothetical* tiles (where a
 * unit could step) without cloning the unit. Protected ground is **immune** (0); the
 * net is near-guaranteed; neutral ground is a real, lower risk. The net's rate ignores
 * `exposureMultiplier` — once the net is on you, confidence doesn't help (only dig-in
 * and evasion do).
 */
export function captureChanceAt(
  coord: GridCoord,
  camp: DeploySource,
  front: DeploySource,
  opts: { dugIn?: boolean; evasion?: number; exposureMultiplier?: number } = {},
): number {
  if (isProtected(coord, camp)) return 0; // green core — capture-immune
  const base = inDangerZone(coord, front) ? FRONT_DANGER : NEUTRAL_DANGER * (opts.exposureMultiplier ?? 1);
  let chance = base;
  if (opts.dugIn) chance *= DIG_IN_CAPTURE_FACTOR;
  if (opts.evasion !== undefined) chance *= opts.evasion;
  return Math.max(0, Math.min(1, chance));
}

/**
 * The capture-chance multiplier a unit's own traits earn (D68): the Scout's **Quiet
 * Footsteps** passive halves it, and **Dash** (while the quiet unit is Swift, darting
 * deep) halves it again — so a dashing Scout faces a quarter of the net's grab. `1` for
 * anyone without the passive. Read by the roll ({@link frontCaptureChance}) and the
 * forecast ({@link deployForecast}) so preview == outcome.
 */
export function captureEvasionFactor(unit: Unit): number {
  if (!unit.passives[PASSIVE.quietFootsteps]) return 1;
  const dash = hasStatus(unit, SWIFT) ? DASH_CAPTURE_FACTOR : 1;
  return QUIET_FOOTSTEPS_CAPTURE_FACTOR * dash;
}

/**
 * A per-choice **capture-risk forecast** for the unit whose deploy turn it is — the
 * decision the focus card poses, scored as pure numbers (mirrors the D48 route
 * forecast). Each field is the risk that choice would leave the unit at:
 *  - `hold` — end the turn where it stands, in its current stance (the baseline).
 *  - `digIn` — hunker on this tile (risk × the dig-in factor); `null` when already
 *    dug in, since there's no further improvement to offer.
 *  - `move` — the *best* (lowest) risk reachable by repositioning this turn; `null`
 *    when standing pat is already at least as safe as anywhere it can step. Moving
 *    breaks the dig-in stance, so candidate tiles are scored un-dug.
 *
 * `reachable` is the set of tiles the unit could step to this turn (empty once it's
 * already repositioned, or for a captured unit) — the caller owns pathing/budget.
 */
export interface DeployForecast {
  hold: number;
  digIn: number | null;
  move: number | null;
}

export function deployForecast(
  unit: Unit,
  camp: DeploySource,
  front: DeploySource,
  reachable: readonly GridCoord[] = [],
  opts: { dugIn?: boolean; exposureMultiplier?: number } = {},
): DeployForecast {
  const dugIn = opts.dugIn ?? unit.dugIn === true;
  const evasion = captureEvasionFactor(unit);
  const exposureMultiplier = opts.exposureMultiplier;
  const hold = captureChanceAt(unit.pos, camp, front, { dugIn, evasion, exposureMultiplier });
  const digIn = dugIn ? null : captureChanceAt(unit.pos, camp, front, { dugIn: true, evasion, exposureMultiplier });
  let best: number | null = null;
  for (const coord of reachable) {
    const risk = captureChanceAt(coord, camp, front, { dugIn: false, evasion, exposureMultiplier });
    if (best === null || risk < best) best = risk;
  }
  const move = best !== null && best < hold ? best : null;
  return { hold, digIn, move };
}

/** The resolved outcome of one enemy-source turn — the radius grows, then capture. */
export interface FrontTurnOutcome {
  /** The danger radius after growing. */
  advancedTo: number;
  /** The first unit caught this turn, or null. */
  captured: Unit | null;
  /** Units that faced a capture roll, deepest (closest to the source) first. */
  rolled: Unit[];
  /** True if a capture raised the alarm (combat should begin). */
  alarm: boolean;
  /**
   * True when **no one was captured** but the net has reached a unit sitting in the
   * **protected** core (D-feel): the green is capture-immune, so the contact can't
   * grab anyone — it just trips the alarm and starts the battle (the soft consequence).
   */
  breached: boolean;
}

/**
 * Resolve the enemy source's turn (D63): grow the danger radius one step, then roll
 * capture for every **unprotected** player unit (neutral or netted) — deepest (closest
 * to the source) first; the campfire's protected core is immune. The party's **last
 * un-captured fighter is never caught**, and the **first** catch stops the rolls and
 * raises the alarm. If no one is caught but the net has reached a protected unit, the
 * turn comes back **breached** (combat starts, nobody taken). All rolls take the seeded
 * `rng`, so the whole turn is reproducible.
 *
 * This **decides** the catch; it no longer binds the unit itself — the caller
 * applies the capture through the one interpreter ({@link "./turn".Battle.apply}'s
 * `capture` action, D63 unification) so the deploy "enemy turn" lands in the same
 * log/undo path as combat. (`opts.dugIn` reads {@link Unit.dugIn} by default.)
 */
export function resolveFrontTurn(
  front: DeployFront,
  camp: DeploySource,
  units: readonly Unit[],
  rng: Rng,
  opts: { dugIn?: (u: Unit) => boolean; by?: number; exposureMultiplier?: number } = {},
): FrontTurnOutcome {
  advanceFront(front, opts.by ?? FRONT_ADVANCE_PER_TURN);
  const isDugIn = opts.dugIn ?? ((u: Unit) => u.dugIn === true);
  const exposureMultiplier = opts.exposureMultiplier;

  const players = units.filter((u) => u.side === "player" && u.alive && !u.captured);
  // Capture rolls are for the **unprotected** — neutral or netted; the green core is
  // immune. Deepest (closest to the source) first, so the most-exposed is grabbed first.
  const exposed = players
    .filter((u) => !isProtected(u.pos, camp))
    .sort(
      (a, b) =>
        stepDistance(a.pos, front.origin) - stepDistance(b.pos, front.origin) ||
        a.pos.row - b.pos.row ||
        a.id.localeCompare(b.id),
    );

  const rolled: Unit[] = [];
  let captured: Unit | null = null;
  let remaining = units.filter((u) => u.side === "player" && !u.captured).length;
  for (const u of exposed) {
    if (remaining <= 1) break; // never catch the party's last fighter
    rolled.push(u);
    if (rng.chance(frontCaptureChance(u, camp, front, { dugIn: isDugIn(u), exposureMultiplier }))) {
      captured = u;
      remaining -= 1;
      break; // first catch raises the alarm → combat begins
    }
  }
  // No catch, but the net has lapped over a protected unit → it can't be grabbed, but
  // the contact trips the alarm (combat starts, nobody taken) — the soft consequence.
  const breached = captured === null && players.some((u) => isProtected(u.pos, camp) && inDangerZone(u.pos, front));
  return { advancedTo: front.radius, captured, rolled, alarm: captured !== null, breached };
}

/** True while any walkable tile is still safe ground (else the danger has overrun). */
export function safeGroundRemains(grid: TileGrid, camp: DeploySource, front: DeploySource): boolean {
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const t = { col, row };
      if (grid.isWalkable(t) && inSafeZone(t, camp, front)) return true;
    }
  }
  return false;
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
   *
   * Shares combat's stepping engine ({@link tickUntilReady} + {@link byReadiest});
   * the **front-vs-player strict-lead tie rule** below is deployment's own policy —
   * the reason the front stays a distinct actor rather than a unit in the pool.
   */
  next(): DeployTurn {
    // The front always charges, so the timeline can always progress (never stalls).
    if (!tickUntilReady(() => this.ready(), () => true, () => this.tick())) {
      return { unit: null, isFront: true };
    }
    const readyPlayers = this.players
      .filter((u) => u.alive && !u.captured && u.ct >= TURN_THRESHOLD)
      .sort(byReadiest);
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
