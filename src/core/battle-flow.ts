/**
 * Pure battle-phase flow decisions (D60/D55 — the headless half of the
 * BattleScene's combat controller, Phase B of the deploy↔combat unification). Twin
 * of {@link "./deploy-flow"}: the scene owns rendering, animation, and input; these
 * own the turn-flow *decisions* it used to tangle with Phaser.
 *
 * The heavy combat mechanics already live in core and are covered there — the CT
 * clock + `nextActor` ({@link "./turn"}), the enemy AI ({@link "./ai"}), the
 * resolution gates ({@link "./staging"}). This module captures the thin "whose turn
 * is it / can this unit do anything" choices that were stranded in the render layer.
 *
 * Pure logic: no Phaser, no DOM.
 */

import type { Unit } from "./units";
import type { TileGrid } from "./grid";
import type { GridCoord } from "./iso";
import type { EntityRegistry, ConcealedTrap } from "./entities";
import { isConcealedTrap } from "./entities";
import { chebyshev } from "./iso";
import { isAdjacent, moveBudget } from "./combat";
import { PILOT_POLICY, type AIPlan, type BattlePolicy } from "./ai";
import { reachableTiles, type Reach } from "./ai";
import { forecastAttack } from "./planning";
import { availableSkills } from "./leveling";
import { hiddenTraps, canDisarm, revealTrapsNear, spotWhileMoving } from "./traps";
import { isImmobilized } from "./status";
import type { SkillDef } from "./skills";
import type { Rng } from "./rng";
import { Labels } from "./rng-labels";
import type { Battle } from "./turn";
import {
  createCampfire,
  createFront,
  configureDeployClock,
  resolveFrontTurn,
  zoneHasRoom,
  freeTileIn,
  type DeployFront,
  type SafeGround,
  type SpawnZone,
  type FrontTurnOutcome,
} from "./deployment";
import { frontTurnStage, deployActions, type FrontTurnStage, type DeployActionId } from "./deploy-flow";

/** What advancing the clock does with the next actor (the `onAdvance` branch). */
export type AdvanceOutcome =
  /** The encounter is decided (or the clock is empty) → resolve the battle. */
  | { kind: "finish" }
  /** A hidden ambusher just passes until the party scouts it into view (D42/D44). */
  | { kind: "ambushPass"; actor: Unit }
  /** An enemy acts (its turn runs through the AI planner). */
  | { kind: "enemyTurn"; actor: Unit }
  /** Open a player unit's free-move turn (D60). */
  | { kind: "playerTurn"; actor: Unit };

/**
 * Classify a clock advance (D60), the decision behind `BattleScene.onAdvance`. The
 * caller steps the clock (`battle.nextActor`) and re-polls whether the encounter is
 * decided — a clock tick can close a gate (D50) — then this turns the next actor +
 * that flag into the branch the scene renders (resolve / pass / enemy / player).
 */
export function advanceOutcome(actor: Unit | null, decided: boolean): AdvanceOutcome {
  if (decided || !actor) return { kind: "finish" };
  if (actor.hidden) return { kind: "ambushPass", actor };
  return actor.side === "enemy" ? { kind: "enemyTurn", actor } : { kind: "playerTurn", actor };
}

/** The nearest revealed, un-sprung trap a unit could reach to disarm (within 1 tile). */
export function adjacentRevealedTrap(actor: Unit, entities: EntityRegistry): ConcealedTrap | undefined {
  return entities.all().filter(isConcealedTrap).find((t) => t.revealed && !t.sprung && chebyshev(t.pos, actor.pos) <= 1);
}

/** Everything the no-action backstop reads about the board. */
export interface ActionScanContext {
  actor: Unit;
  units: readonly Unit[];
  grid: TileGrid;
  entities: EntityRegistry;
  /** A guild is present, so Bribe is on the table while any enemy lives. */
  hasGuild: boolean;
}

/**
 * The D55 no-action backstop: `true` when the unit has *nothing* it can do this turn
 * — no move, no strike, no rescue of a bound ally, no skill, no Search, no disarm,
 * no bribe — so the scene auto-passes it and the clock can never stall. The decision
 * behind `BattleScene.noActionsAvailable`.
 *
 * The skill check reads {@link availableSkills}(`"combat"`), the **authoritative** surfacing
 * projection (#123): it folds in the universal capabilities + the capability gate that the old
 * `unlockedSkills("battle")` read missed. In practice a unit can always **Defend** (a universal),
 * so this line no longer fires the backstop on its own — which is correct: no combat turn is
 * genuinely action-less. The other scans (move / strike / rescue / Search / disarm / bribe) are
 * what still distinguish a live turn from a dead one for the render's hint.
 */
export function noActionsAvailable(ctx: ActionScanContext): boolean {
  const { actor, units, grid, entities, hasGuild } = ctx;
  const budget = moveBudget(actor);
  if (reachableTiles(actor, units, grid, budget).some((r) => r.tile.col !== actor.pos.col || r.tile.row !== actor.pos.row)) return false;
  if (units.some((u) => u.alive && !u.captured && u.side !== actor.side && forecastAttack(actor, u, units, grid))) return false;
  if (units.some((u) => u.captured && u.side === actor.side && u !== actor && isAdjacent(actor.pos, u.pos))) return false;
  if (availableSkills(actor, "combat").length > 0) return false;
  if (hiddenTraps(entities).length > 0) return false; // Search is available
  if (adjacentRevealedTrap(actor, entities) && canDisarm(actor)) return false;
  if (hasGuild && units.some((u) => u.side === "enemy" && u.alive)) return false; // Bribe
  return true;
}

// --- BattleFlow — the game master (design map, step 3) --------------------------------
//
// The design map's finding: the rules live in core, but *what happens next* (whose turn,
// which phase, when the net steps, when a turn is spent) lived in BattleScene, with a second
// copy in the sim (`RunLoop.autoBattle`) that skipped deployment entirely and ran hidden
// ambushers' turns the scene never runs — so the headless guards were blind to the phase where
// the unlogged mutations cluster, and the bot and the player drifted. `BattleFlow` is the one
// sequencer both seats talk to: **intents in** (`advance` / `advanceClock` / `move` / `digIn` /
// `spendAct` / `endTurn` / `undo` / `startBattle` / `policyTurn` …), **view state out**
// ({@link DeployView} / {@link CombatView}: what the active unit may do now). The scene renders
// the view and turns clicks into intents; the sim's policies send the same intents. Two slices:
// the deploy phase (the net, the deploy turn) and the combat turn (the free-move turn, D60).

/** The flow's phase: `alarm` is the net's turn having ended deploy (a catch or an overrun) — only `startBattle` remains. */
export type FlowPhase = "deploy" | "alarm" | "combat";

/** The open deploy turn — the per-turn economy the scene used to keep as loose fields. */
export interface DeployTurn {
  actor: Unit;
  /** Stepped at all this turn (drives the End-Turn CT spend). */
  moved: boolean;
  /** Used its one Act (dig-in / trap / skill / Search / Disarm / entrance …). */
  acted: boolean;
  /** A unit that opened the turn dug in pressed **Take Action** — its full row is back without breaking the stance. */
  revealed: boolean;
  /** Weighted movement left this turn (the same budget a combat turn spends). */
  moveBudget: number;
}

/** What the render (or a policy) reads to decide what to offer — the deploy slice's view state. */
export interface DeployView {
  phase: FlowPhase;
  /** The unit whose deploy turn is open, or null between turns (the clock rests on the player). */
  actor: Unit | null;
  moved: boolean;
  acted: boolean;
  revealed: boolean;
  moveBudget: number;
  /** The actor began the turn dug in and has not re-engaged: the minimal Take Action menu. */
  hunkered: boolean;
  /** The actor may still take its one Act: present, not captured, Act unspent, not hunkered. */
  canAct: boolean;
  canUndo: boolean;
  /** The meta-controls the row surfaces ({@link deployActions}). */
  controls: DeployActionId[];
  /**
   * The actor's abilities this turn — the same `availableSkills(actor, "pre-combat")` projection as
   * combat; an enemy-target skill only while a foe is **engageable** (un-concealed — a keep-assault).
   * Empty when the actor may not act.
   */
  skills: SkillDef[];
  /** The net's reach, in steps. */
  frontRadius: number;
  /** Why deploy ended, once the net's turn ended it. */
  alarm: "capture" | "overrun" | null;
}

/**
 * The open **combat** turn (D60, the free-move turn) — the per-turn economy the scene used to
 * keep as loose fields (`waitingFor` / `acted` / `actCharged` / `movedThisTurn` / `turnLocked`).
 */
export interface CombatTurn {
  actor: Unit;
  /** Stepped at all this turn (the cheap Move cost on End Turn). */
  moved: boolean;
  /** Used its one Act (strike / skill / rescue / Search / Disarm / bribe / gate). */
  acted: boolean;
  /** The Act's CT weight: `false` when a move-spend skill (Dash) billed as a move, not the full Act. */
  actCharged: boolean;
  /** A sprung trap cost HP this turn — the move stands, no take-back (D60). */
  locked: boolean;
  /** Weighted movement left this turn. */
  moveBudget: number;
}

/** What the render (or a policy) reads during the combat phase. */
export interface CombatView {
  phase: FlowPhase;
  /** The unit whose free-move turn is open, or null between turns (the clock waits for Advance). */
  actor: Unit | null;
  moved: boolean;
  acted: boolean;
  actCharged: boolean;
  locked: boolean;
  moveBudget: number;
  /** The actor may still take its one Act: a turn is open, the unit is up, the Act unspent. */
  canAct: boolean;
  /** Something on this turn's stack and no sprung-trap lock. */
  canUndo: boolean;
  /** Budget left and somewhere to step. */
  canMoveFurther: boolean;
  /** Both halves spent (the Act used and no movement left) — the auto-end gate (D60). */
  exhausted: boolean;
}

/** What `advanceClock()` did with the next actor on the combat clock. */
export type CombatAdvance =
  /** The encounter is decided (or the clock is empty) → resolve the battle. */
  | { kind: "finish" }
  /** A hidden ambusher passed its turn (logged) until the party scouts it into view (D42/D44). */
  | { kind: "ambushPass"; actor: Unit }
  /** An enemy is up: run its turn with {@link BattleFlow.policyTurn}. */
  | { kind: "enemyTurn"; actor: Unit }
  /** A player unit's free-move turn opened (undo armed, budget seeded, the passive trap read done). */
  | { kind: "turn"; actor: Unit; spotted: ConcealedTrap[] }
  /** A player unit with nothing it can do passed at once (the D55 backstop) — its turn is already spent. */
  | { kind: "pass"; actor: Unit; spotted: ConcealedTrap[] }
  | { kind: "refused"; reason: string };

/** What `advance()` did: opened a unit's turn, or ran the net's turn. */
export type DeployAdvance =
  | { kind: "turn"; actor: Unit; /** Hidden traps the actor spotted stepping up (D12). */ spotted: ConcealedTrap[] }
  | { kind: "front"; stage: FrontTurnStage; outcome: FrontTurnOutcome }
  | { kind: "refused"; reason: string };

/** The result of a move intent (either phase's open turn). */
export type MoveResult =
  | { ok: true; walked: GridCoord[]; /** A trap sensed just in time (the walk stopped short of it). */ spotted: ConcealedTrap | null; halted: boolean; cost: number }
  | {
      ok: false;
      /** `out-of-reach`: budget remains but not for that tile · `out-of-moves`: nothing left · `balked`: a trap on the first step (spotted, if sensed now) · `not-your-turn`. */
      reason: "out-of-reach" | "out-of-moves" | "balked" | "not-your-turn";
      spotted?: ConcealedTrap | null;
    };

export class BattleFlow {
  readonly battle: Battle;
  readonly grid: TileGrid;
  /** The party's safe ground: the encounter's authored spawn zones (D119), else the derived campfire. */
  readonly safeGround: SafeGround;
  /** The closing net — the enemy danger front that steps in on its clock turns (D63). */
  readonly front: DeployFront;
  /** The trap spot-roll stream (`Labels.trapSpot()`), shared with the combat turn's reads. */
  readonly spotRng: Rng;
  /** The net's capture rolls (`Labels.deploy()`). */
  private readonly deployRng: Rng;
  /** The morale × intel neutral-capture multiplier (D8/D10), threaded into the net's rolls. */
  private readonly exposure: number;
  /** Is the encounter graded terminal (D50/D51)? The run layer passes its objective classifier; alone, the elimination primitive. */
  readonly decided: () => boolean;
  /** A guild is present, so Bribe is on the table (the no-action backstop's read). */
  private readonly hasGuild: boolean;
  private phase: FlowPhase;
  private turn: DeployTurn | null = null;
  /** The open combat turn — the free-move turn's economy (D60). */
  private fight: CombatTurn | null = null;
  private alarm: "capture" | "overrun" | null = null;
  private entered = false;

  constructor(battle: Battle, opts: { exposureMultiplier?: number; decided?: () => boolean; hasGuild?: boolean } = {}) {
    this.battle = battle;
    this.grid = battle.grid;
    this.exposure = opts.exposureMultiplier ?? 1;
    this.decided = opts.decided ?? (() => battle.outcome().over);
    this.hasGuild = opts.hasGuild ?? false;
    // A flow built over a Battle already in combat (the headless route that skips staging) opens there.
    this.phase = battle.phase === "combat" ? "combat" : "deploy";
    // The RNG streams derive from the battle's own seed by label (D67) — creation order is immaterial.
    this.deployRng = battle.stream(Labels.deploy());
    this.spotRng = battle.stream(Labels.trapSpot());
    // D119: authored zones override the net outright and replace the campfire; `createCampfire`
    // anchors blindly at the home edge, which a hand-built board can put inside a wall.
    this.safeGround = battle.spawnZones.length > 0 ? battle.spawnZones : createCampfire(this.grid, battle.units);
    this.front = createFront(this.grid, battle.units.filter((u) => u.side === "enemy"));
  }

  /**
   * Open the deploy phase: the Battle enters pre-combat, its own clock is configured for the
   * net (players participate, the front is the tempo source) and seeded per unit, and the party
   * takes its opening Awareness read of the trap field (D12). Returns the traps it revealed.
   * Once per battle; the first `advance()` then opens the first turn.
   */
  enterDeploy(): ConcealedTrap[] {
    if (this.entered) throw new Error("BattleFlow.enterDeploy: already entered");
    this.entered = true;
    this.phase = "deploy";
    this.battle.enterDeploy();
    configureDeployClock(this.battle.clock, this.front);
    this.battle.clock.seedFlat();
    return this.partyScan();
  }

  /** The whole party's passive trap read — at the deploy line, and again as battle opens. */
  private partyScan(): ConcealedTrap[] {
    if (hiddenTraps(this.battle.entities).length === 0) return [];
    const found: ConcealedTrap[] = [];
    for (const u of this.battle.units) if (u.side === "player" && u.alive) found.push(...revealTrapsNear(u, this.battle.entities, this.spotRng));
    return found;
  }

  /** The deploy slice's view (its `actor` is the open **deploy** turn's; see {@link combatView} for the fight). */
  view(): DeployView {
    const t = this.turn;
    const actor = t?.actor ?? null;
    const captured = !!actor?.captured;
    const hunkered = !!t && !!actor?.dugIn && !captured && !t.acted && !t.revealed;
    const canAct = this.phase === "deploy" && !!t && !captured && !t.acted && !hunkered;
    const canEngage = this.battle.units.some((u) => u.alive && !u.concealed && actor !== null && u.side !== actor.side);
    return {
      phase: this.phase,
      actor,
      moved: t?.moved ?? false,
      acted: t?.acted ?? false,
      revealed: t?.revealed ?? false,
      moveBudget: t?.moveBudget ?? 0,
      hunkered,
      canAct,
      canUndo: this.battle.canUndo(),
      controls: deployActions({ hasActor: !!actor, captured, canUndo: this.battle.canUndo() }),
      skills: canAct && actor ? availableSkills(actor, "pre-combat").filter((s) => s.target !== "enemy" || canEngage) : [],
      frontRadius: this.front.radius,
      alarm: this.alarm,
    };
  }

  /** The open turn (either phase) — the deploy turn or the combat turn. */
  private open(): DeployTurn | CombatTurn | null {
    return this.phase === "combat" ? this.fight : this.turn;
  }

  /** The open turn's reachable tiles (path + weighted cost each) for its remaining budget. */
  reach(): Reach[] {
    const t = this.open();
    if (!t || t.moveBudget <= 0 || isImmobilized(t.actor)) return [];
    return reachableTiles(t.actor, this.battle.units, this.grid, t.moveBudget);
  }

  /** True while the open turn's unit has budget and somewhere to step. */
  canMoveFurther(): boolean {
    return this.reach().some((r) => r.path.length > 0);
  }

  /**
   * May `unit` take its one Act right now? The one gate for both phases' field verbs (Search /
   * Disarm / rescue / strike / skill / bribe / gate / entrance): its turn is open, it is up, the
   * Act is unspent (and, in deployment, it is not hunkered).
   */
  canAct(unit: Unit): boolean {
    if (this.phase === "combat") {
      const f = this.fight;
      return !!f && f.actor === unit && !f.acted && unit.alive && !unit.captured;
    }
    return this.turn?.actor === unit && this.view().canAct;
  }

  /** The combat slice's view — the free-move turn's economy (D60). */
  combatView(): CombatView {
    const f = this.phase === "combat" ? this.fight : null;
    const actor = f?.actor ?? null;
    const canMoveFurther = !!f && this.canMoveFurther();
    return {
      phase: this.phase,
      actor,
      moved: f?.moved ?? false,
      acted: f?.acted ?? false,
      actCharged: f?.actCharged ?? false,
      locked: f?.locked ?? false,
      moveBudget: f?.moveBudget ?? 0,
      canAct: !!actor && this.canAct(actor),
      canUndo: !!f && !f.locked && this.battle.canUndo(),
      canMoveFurther,
      exhausted: !!f && f.acted && !canMoveFurther,
    };
  }

  /**
   * Step the deploy clock by one actor. Nothing happens on its own: the player ends a turn and
   * presses Advance, so the board never changes without an input. A unit's turn opens (undo
   * armed, budget seeded, a passive trap read); the net's turn resolves the capture wave and
   * may end the phase (`alarm`). Refused while a turn is open or the phase is over.
   */
  advance(): DeployAdvance {
    if (this.phase !== "deploy") return { kind: "refused", reason: "deployment is over" };
    if (this.turn) return { kind: "refused", reason: `${this.turn.actor.name}'s turn is open — end it first` };
    const next = this.battle.clock.nextTurn();
    if (next.kind === "unit") return this.openTurn(next.unit);
    // "tempo" (the front leads) or "idle" (never — the front always charges): the net's turn.
    return this.frontTurn();
  }

  private openTurn(actor: Unit): DeployAdvance {
    this.turn = { actor, moved: false, acted: false, revealed: false, moveBudget: moveBudget(actor) };
    // Arm the shared action-log undo for the turn (D63): each move / dig-in / trap is undoable
    // back to the turn's start, exactly like a combat turn.
    this.battle.beginUndo();
    // The unit looks around as it steps up — the passive Awareness scan (D12; shared with combat).
    const spotted = hiddenTraps(this.battle.entities).length > 0 ? revealTrapsNear(actor, this.battle.entities, this.spotRng) : [];
    return { kind: "turn", actor, spotted };
  }

  /**
   * The capture wave (D63/D67): the net advances one column, then rolls capture for every unit it
   * has swallowed. A catch is bound through the one interpreter (logged) and raises the alarm;
   * an overrun (the net at the protected core, or the last safe tile gone) raises it with nobody
   * taken; otherwise the clock rests on the player. `frontTurn` fires on the bus after it resolves.
   */
  private frontTurn(): DeployAdvance {
    const outcome = resolveFrontTurn(this.front, this.safeGround, this.battle.units, this.deployRng, { exposureMultiplier: this.exposure });
    this.battle.clock.spendTempo();
    const stage = frontTurnStage(outcome, this.grid, this.safeGround, this.front);
    if (stage.kind === "capture") {
      this.battle.capture(outcome.captured!);
      this.phase = "alarm";
      this.alarm = "capture";
    } else if (stage.kind === "overrun") {
      this.phase = "alarm";
      this.alarm = "overrun";
    }
    this.battle.bus.emit("frontTurn", {});
    return { kind: "front", stage, outcome };
  }

  /**
   * Step the open turn's unit to a lit tile, spending that leg's weighted cost from the budget
   * (D-feel: the same reach a combat turn spends). The per-step trap read (D12) may truncate the
   * walk: the unit senses a hidden trap and stops short, balks at one it already knows, or
   * blunders onto one it missed (which springs on entry). Commits through the logged `move`
   * verb (undoable; breaks dig-in).
   */
  move(unit: Unit, tile: GridCoord): MoveResult {
    const t = this.open();
    if (this.phase === "alarm" || !t || t.actor !== unit || unit.captured) return { ok: false, reason: "not-your-turn" };
    const reach = this.reach();
    const target = reach.find((r) => r.tile.col === tile.col && r.tile.row === tile.row);
    if (!target || target.path.length === 0) {
      return { ok: false, reason: reach.some((r) => r.path.length > 0) ? "out-of-reach" : "out-of-moves" };
    }
    const spot = spotWhileMoving(unit, target.path, this.battle.entities, this.spotRng);
    if (spot.path.length === 0) return { ok: false, reason: "balked", spotted: spot.spotted };
    // The walked route ends on a tile of the original reach, so its cost is that tile's reach cost.
    const halt = spot.path[spot.path.length - 1];
    const cost = reach.find((r) => r.tile.col === halt.col && r.tile.row === halt.row)?.cost ?? target.cost;
    const hpBefore = unit.hp;
    this.battle.moveUnit(unit, spot.path);
    t.moved = true;
    t.moveBudget -= cost;
    // A combat move that walked onto a missed trap stands: no take-back once a sprung trap cost HP (D60).
    if ("locked" in t && unit.hp < hpBefore) t.locked = true;
    return { ok: true, walked: spot.path, spotted: spot.spotted, halted: spot.halted, cost };
  }

  /**
   * Take another authored entrance (D119): a unit standing in one spawn zone circles round to
   * `zone` — a move, not a swap, respecting the zone's `cap`. It spends the move **and** the Act
   * (circling the building is the turn). Refused when the zone is full.
   */
  takeEntrance(unit: Unit, zone: SpawnZone): { ok: true; dest: GridCoord } | { ok: false; reason: string } {
    if (!this.canAct(unit)) return { ok: false, reason: "not-your-turn" };
    const dest = zoneHasRoom(zone, this.battle.units, unit) ? freeTileIn(zone, this.battle.units, this.grid, unit) : undefined;
    if (!dest) return { ok: false, reason: "full" };
    this.battle.moveUnit(unit, [dest]);
    const t = this.turn!;
    t.moved = true;
    t.moveBudget = 0; // the circle IS the turn — no reposition left after arriving
    this.spendAct(unit);
    return { ok: true, dest };
  }

  /** Dig In (D63): hunker on this tile for a sharply reduced capture chance — the turn's Act. */
  digIn(unit: Unit): boolean {
    const t = this.turn;
    if (this.phase !== "deploy" || !t || t.actor !== unit || unit.captured || t.acted) return false;
    this.battle.digIn(unit); // logged + undoable through the one interpreter
    t.acted = true;
    return true;
  }

  /**
   * Spend the open turn's one Act on a verb the caller already resolved through the Battle
   * (a strike, a skill cast, a rescue, Search, Disarm, a bribe, a gate …). Refused unless
   * {@link canAct}. In deployment, acting breaks the hunker (the status-effect "on action"
   * trigger) unless `keepStance` — placing a trap keeps it. In combat, `charged` is the Act's CT
   * weight on End Turn: a move-spend skill (Dash) bills as a move, not the full Act (default true).
   */
  spendAct(unit: Unit, opts: { keepStance?: boolean; charged?: boolean } = {}): boolean {
    if (!this.canAct(unit)) return false;
    if (this.phase === "combat") {
      const f = this.fight!;
      f.acted = true;
      f.actCharged = opts.charged ?? true;
      return true;
    }
    this.turn!.acted = true;
    if (!opts.keepStance) unit.dugIn = false;
    return true;
  }

  /** Take Action: a unit that opened its turn dug in re-engages — its full row returns; the stance holds until it moves or acts. */
  takeAction(unit: Unit): boolean {
    const t = this.turn;
    if (this.phase !== "deploy" || !t || t.actor !== unit || unit.captured) return false;
    t.revealed = true;
    return true;
  }

  /**
   * Take back everything the open turn did (positions, HP, statuses, kits, the log) — back to
   * the turn's start (D60 / D63, the *Into the Breach* take-back). A combat turn a sprung trap
   * locked refuses.
   */
  undo(unit: Unit): boolean {
    if (this.phase === "combat") {
      const f = this.fight;
      if (!f || f.actor !== unit || f.locked || !this.battle.canUndo()) return false;
      this.battle.undoAll();
      f.moved = false;
      f.acted = false;
      f.actCharged = false;
      f.moveBudget = moveBudget(unit);
      return true;
    }
    const t = this.turn;
    if (!t || t.actor !== unit || !this.battle.canUndo()) return false;
    this.battle.undoAll();
    t.moved = false;
    t.acted = false;
    t.revealed = false; // back to the minimal menu if the unit began the turn dug in
    t.moveBudget = moveBudget(unit); // the whole turn rolled back — full range again
    return true;
  }

  /**
   * End the open turn: the take-back window closes and the unit's CT is spent through the logged
   * verb — what it actually did (`moved` / `acted`), so a unit that only stepped pays the cheap
   * Move cost and one that struck pays the Act (a move-spend skill billed as a move).
   */
  endTurn(unit: Unit): boolean {
    if (this.phase === "combat") {
      const f = this.fight;
      if (!f || f.actor !== unit) return false;
      this.battle.endUndo(); // the turn commits — no take-back across the boundary
      this.fight = null;
      this.battle.endTurn(unit, { moved: f.moved, acted: f.actCharged });
      return true;
    }
    const t = this.turn;
    if (!t || t.actor !== unit) return false;
    this.battle.endUndo(); // the deploy turn commits — no take-back across the boundary
    this.turn = null;
    this.battle.endTurn(unit, { moved: t.moved, acted: t.acted });
    return true;
  }

  /**
   * Commit: cross the pre-combat → combat boundary (the logged `beginBattle`, D67) with the
   * party where it stands — at any point (early), or after the alarm. An open turn commits
   * as it is. Returns the party's opening trap read as battle opens. The caller then seeds
   * initiative (the run layer's heal + morale warming — `RunLoop.beginBattle`).
   */
  startBattle(): ConcealedTrap[] {
    if (this.phase === "combat") return [];
    if (this.turn) {
      this.battle.endUndo();
      this.turn = null;
    }
    this.phase = "combat";
    this.battle.beginBattle();
    return this.partyScan();
  }

  // --- The combat turn (D60) ----------------------------------------------------------

  /**
   * Advance the combat clock to the next actor (the Advance Clock press). Nothing happens on
   * its own: the clock steps only on this intent, so the board never changes without an input.
   * The encounter is polled for a graded terminal before **and** after the tick (a tick can
   * close a gate, D50). A hidden ambusher passes (logged) until scouted (D42/D44); an enemy is
   * handed back for {@link policyTurn}; a player unit's free-move turn opens (undo armed, budget
   * seeded, the passive trap read) — or passes at once when it has nothing it can do (D55).
   * Refused outside combat or while a turn is open.
   */
  advanceClock(): CombatAdvance {
    if (this.phase !== "combat") return { kind: "refused", reason: "not in combat" };
    if (this.fight) return { kind: "refused", reason: `${this.fight.actor.name}'s turn is open — end it first` };
    if (this.decided()) return { kind: "finish" };
    const actor = this.battle.nextActor();
    const out = advanceOutcome(actor, this.decided());
    if (out.kind === "finish") return out;
    if (out.kind === "ambushPass") {
      this.battle.endTurn(out.actor, {});
      return out;
    }
    if (out.kind === "enemyTurn") return out;
    return this.openCombatTurn(out.actor);
  }

  private openCombatTurn(actor: Unit): CombatAdvance {
    this.fight = { actor, moved: false, acted: false, actCharged: false, locked: false, moveBudget: moveBudget(actor) };
    // Arm the action-log undo for the turn (D60 take-back): every move / strike / skill the unit
    // makes is undoable back to this point, until the turn commits.
    this.battle.beginUndo();
    // The unit looks around as it steps up — the passive Awareness scan (D12; shared with deploy).
    const spotted = hiddenTraps(this.battle.entities).length > 0 ? revealTrapsNear(actor, this.battle.entities, this.spotRng) : [];
    // The D55 backstop: a unit with no legal action passes so the clock can never stall.
    if (noActionsAvailable({ actor, units: this.battle.units, grid: this.grid, entities: this.battle.entities, hasGuild: this.hasGuild })) {
      this.endTurn(actor);
      return { kind: "pass", actor, spotted };
    }
    return { kind: "turn", actor, spotted };
  }

  /**
   * Run a whole turn for `actor` through a {@link BattlePolicy} (the pilot by default): plan,
   * lower to logged actions, end the turn. The enemy's turn after `advanceClock` hands it back;
   * also how a headless bot plays a **player** unit's open turn (the sim's A/B seam, D56) — the
   * open turn's take-back window closes first, since the policy commits it. Returns the plan
   * for the render to animate.
   */
  policyTurn(actor: Unit, policy: BattlePolicy = PILOT_POLICY): AIPlan {
    if (this.phase !== "combat") throw new Error("BattleFlow.policyTurn: not in combat");
    if (this.fight) {
      if (this.fight.actor !== actor) throw new Error(`BattleFlow.policyTurn: ${this.fight.actor.name}'s turn is open`);
      this.battle.endUndo();
      this.fight = null;
    }
    return this.battle.runPolicyTurn(actor, policy);
  }
}

/** A headless deploy policy — what a bot does with a unit's open deploy turn ({@link RunLoop.autoDeploy}). */
export type DeployPolicy = (flow: BattleFlow, actor: Unit) => void;

/** The naive bot's deploy: hold position (end the turn at once). */
export const HOLD_POSITION: DeployPolicy = (flow, actor) => {
  flow.endTurn(actor);
};
