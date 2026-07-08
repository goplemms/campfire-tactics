/**
 * Deployment — the closing-net deployment phase (D63/D67).
 *
 * Deployment plays out **on the board**, like combat: player units take real
 * turns on a CT clock, positioning (and laying traps) where they stand, while
 * the enemy's **danger radius closes in** turn by turn — the two-influence-source
 * model documented at the D63 section below. Capture is rolled only on the
 * net's turn; a captured unit is **bound on the map**, dropped from the
 * initiative seed, a rescuable sub-objective in the battle.
 *
 * (The two earlier models that shared this spatial spine — the M5b deterministic
 * exposure meter and the D11 stealth-alert layer — were superseded by D63/D67
 * and deleted, R1 #122.)
 *
 * Pure logic: no Phaser, no DOM.
 */

import { isActive, type Unit } from "./units";
import type { Rng } from "./rng";
import type { TileGrid } from "./grid";
import type { GridCoord } from "./iso";
import { CTClock, type TempoSource } from "./clock";
import { PASSIVE } from "./combat";
import { hasStatus, SWIFT } from "./status";

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

/**
 * Configure an existing {@link CTClock} for the Deployment phase (D67 W2): narrow its
 * participant set to **active players** (so the pre-positioned enemies are frozen off the
 * very clock combat runs on) and attach the enemy **front** as a strict-lead
 * {@link TempoSource} (it takes the net-closing turn only on a strict CT lead — players win
 * ties, the front's deliberate rule). Because capture is rolled on the front's turn, a
 * faster party simply earns more positioning turns between net-closings. The Battle drives
 * *its own* clock through deployment this way — no parallel instance — and sheds this config
 * at the combat boundary via {@link CTClock.resetForCombat}. Seed it with `seedFlat()` (the
 * per-unit deploy seed), then `nextTurn()` / `spend()` / `spendTempo()` step the net.
 */
export function configureDeployClock(clock: CTClock, front: DeployFront): void {
  clock.setParticipants((u) => isActive(u) && u.side === "player");
  clock.setTempo({ id: "front", ct: 0, speed: front.speed, strictLeadTie: true });
}

/**
 * Build a **standalone** Deployment clock over `units` — a fresh {@link CTClock} configured
 * for deploy (see {@link configureDeployClock}). The Battle folds deployment onto its *own*
 * clock in the live game (D67 W2); this constructs an isolated one for tests and harnesses
 * that exercise the closing net without a full Battle.
 */
export function createDeployClock(units: readonly Unit[], front: DeployFront): CTClock {
  const clock = new CTClock([...units]);
  configureDeployClock(clock, front);
  return clock;
}
