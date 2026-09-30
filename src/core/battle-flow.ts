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
import { reachableTiles, PILOT_POLICY, type Reach, type BattlePolicy, type AIPlan } from "./ai";
import { canSee } from "./vision";
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

// --- BattleFlow — the game master (design map, steps 3–4) ------------------------
//
// The design map's finding: the rules live in core, but *what happens next* (whose turn,
// which phase, when the net steps) lived in BattleScene, with a second copy in the sim
// (`RunLoop.autoBattle`) that skipped deployment entirely and ran the combat clock by its own
// rules — so the headless guards were blind to the phase where the unlogged mutations cluster,
// and the sim's fights were not quite the scene's. `BattleFlow` is the one sequencer both
// seats talk to: **intents in** (`advance` / `move` / `digIn` / `spendAct` / `endTurn` / `undo`
// / `startBattle` / `playPolicy` …), **view state out** ({@link TurnView}: what the active unit
// may do now). The scene renders the view and turns clicks into intents; the sim's policies
// send the same intents. Deploy was step 3; the combat turn is step 4 — the same turn record,
// the same move / Act / undo / end-turn intents, one `advance` for both clocks.

/** The flow's phase: `alarm` is the net's turn having ended deploy (a catch or an overrun) — only `startBattle` remains. */
export type FlowPhase = "deploy" | "alarm" | "combat";

/**
 * The open turn — the per-turn economy the scene used to keep as loose fields, one record for
 * both phases (a deploy turn and a combat turn step, act, and take back the same way).
 */
export interface FlowTurn {
  actor: Unit;
  /** Stepped at all this turn (drives the End-Turn CT spend). */
  moved: boolean;
  /** Used its one Act (a strike, a skill, a field verb; in deploy also dig-in / trap / entrance). */
  acted: boolean;
  /** That Act bills the full Act CT — a `spend: "move"` skill (Dash) is an Act billed as a move. */
  charged: boolean;
  /** Deploy: a unit that opened the turn dug in pressed **Take Action** — its full row is back without breaking the stance. */
  revealed: boolean;
  /** Combat: a sprung trap cost HP on a step — the turn's take-back is gone (D60). */
  locked: boolean;
  /** Weighted movement left this turn (the same budget in both phases). */
  moveBudget: number;
}
/** @deprecated The deploy slice's name for {@link FlowTurn}. */
export type DeployTurn = FlowTurn;

/** What the render (or a policy) reads to decide what to offer — the flow's view state. */
export interface TurnView {
  phase: FlowPhase;
  /** The unit whose turn is open (a player's, or a deploy turn), or null between turns. */
  actor: Unit | null;
  moved: boolean;
  acted: boolean;
  charged: boolean;
  revealed: boolean;
  locked: boolean;
  moveBudget: number;
  /** The actor began the turn dug in and has not re-engaged: the minimal Take Action menu (deploy). */
  hunkered: boolean;
  /** The actor may still take its one Act: present, not captured, Act unspent, not hunkered. */
  canAct: boolean;
  /** There is something on the open turn's take-back stack, and no sprung trap has locked it. */
  canUndo: boolean;
  /** The pre-combat meta-controls the row surfaces ({@link deployActions}); empty in combat. */
  controls: DeployActionId[];
  /**
   * The actor's abilities this turn — `availableSkills(actor, "pre-combat")` in deploy (an
   * enemy-target skill only while a foe is **engageable** — un-concealed, a keep-assault), and
   * `availableSkills(actor, "combat")` in combat. Empty when the actor may not act.
   */
  skills: SkillDef[];
  /** The net's reach, in steps. */
  frontRadius: number;
  /** Why deploy ended, once the net's turn ended it. */
  alarm: "capture" | "overrun" | null;
  /** A policy-driven unit (an enemy) the clock handed the turn to, awaiting {@link BattleFlow.playPolicy}. */
  seat: Unit | null;
}
/** @deprecated The deploy slice's name for {@link TurnView}. */
export type DeployView = TurnView;

/** What `advance()` did in deploy: opened a unit's turn, or ran the net's turn. */
export type DeployAdvance =
  | { kind: "turn"; actor: Unit; /** Hidden traps the actor spotted stepping up (D12). */ spotted: ConcealedTrap[] }
  | { kind: "front"; stage: FrontTurnStage; outcome: FrontTurnOutcome }
  | { kind: "refused"; reason: string };

/**
 * What `advance()` did in combat (the {@link advanceOutcome} branch, carried out): the encounter
 * is decided; a hidden ambusher passed; an enemy holds the seat (the caller animates as it
 * sends {@link BattleFlow.playPolicy}); or a player unit's free-move turn opened — or opened
 * and passed at once, the D55 no-action backstop. `revealed` is the ambush bodies the party
 * scouted into view on this tick (D44).
 */
export type CombatAdvance =
  | { kind: "finish" }
  | { kind: "ambushPass"; actor: Unit; revealed: Unit[] }
  | { kind: "enemyTurn"; actor: Unit; revealed: Unit[] }
  | { kind: "playerTurn"; actor: Unit; revealed: Unit[]; spotted: ConcealedTrap[]; /** Nothing it could do — the turn already ended. */ passed: boolean }
  | { kind: "refused"; reason: string };

export type FlowAdvance = DeployAdvance | CombatAdvance;

/** The result of a move intent (either phase). */
export type FlowMove =
  | {
      ok: true;
      walked: GridCoord[];
      /** A trap sensed just in time (the walk stopped short of it). */
      spotted: ConcealedTrap | null;
      halted: boolean;
      cost: number;
      /** A missed trap sprang underfoot and cost HP — in combat this locks the turn's take-back. */
      sprung: boolean;
    }
  | {
      ok: false;
      /** `out-of-reach`: budget remains but not for that tile · `out-of-moves`: nothing left · `balked`: a trap on the first step (spotted, if sensed now) · `not-your-turn`. */
      reason: "out-of-reach" | "out-of-moves" | "balked" | "not-your-turn";
      spotted?: ConcealedTrap | null;
    };
/** @deprecated The deploy slice's name for {@link FlowMove}. */
export type DeployMove = FlowMove;

export interface BattleFlowOptions {
  /** The morale × intel neutral-capture multiplier (D8/D10), threaded into the net's rolls. */
  exposureMultiplier?: number;
  /**
   * Is the encounter decided? The staged encounter's graded outcome (D50) when there is one — a
   * closing gate can fail the fight while enemies still stand — else the elimination primitive.
   */
  decided?: () => boolean;
  /** A guild is present, so Bribe is on the table — the no-action backstop reads it (D55). */
  hasGuild?: boolean;
}

export class BattleFlow {
  readonly battle: Battle;
  readonly grid: TileGrid;
  /** The party's safe ground: the encounter's authored spawn zones (D119), else the derived campfire. */
  readonly safeGround: SafeGround;
  /** The closing net — the enemy danger front that steps in on its clock turns (D63). */
  readonly front: DeployFront;
  /** The trap spot-roll stream (`Labels.trapSpot()`), shared by both phases' reads. */
  readonly spotRng: Rng;
  /** The net's capture rolls (`Labels.deploy()`). */
  private readonly deployRng: Rng;
  /** The morale × intel neutral-capture multiplier (D8/D10), threaded into the net's rolls. */
  private readonly exposure: number;
  /** Is the encounter graded terminal (D50/D51)? The run layer passes its objective classifier; alone, the elimination primitive. */
  readonly decided: () => boolean;
  private readonly hasGuild: boolean;
  private phase: FlowPhase = "deploy";
  private turn: FlowTurn | null = null;
  /** The policy-driven unit holding the combat clock, until `playPolicy` runs its turn. */
  private seat: Unit | null = null;
  private alarm: "capture" | "overrun" | null = null;
  private entered = false;

  constructor(battle: Battle, opts: BattleFlowOptions = {}) {
    this.battle = battle;
    this.grid = battle.grid;
    this.exposure = opts.exposureMultiplier ?? 1;
    this.decided = opts.decided ?? (() => battle.outcome().over);
    this.hasGuild = opts.hasGuild ?? false;
    // The RNG streams derive from the battle's own seed by label (D67) — creation order is immaterial.
    this.deployRng = battle.stream(Labels.deploy());
    this.spotRng = battle.stream(Labels.trapSpot());
    // D119: authored zones override the net outright and replace the campfire; `createCampfire`
    // anchors blindly at the home edge, which a hand-built board can put inside a wall.
    this.safeGround = battle.spawnZones.length > 0 ? battle.spawnZones : createCampfire(this.grid, battle.units);
    this.front = createFront(this.grid, battle.units.filter((u) => u.side === "enemy"));
  }

  /**
   * A flow for a battle that skips deployment and is already fighting (a headless test that
   * seeds and fights at once): the combat phase, no prelude, nothing logged on the way in.
   */
  static forCombat(battle: Battle, opts: BattleFlowOptions = {}): BattleFlow {
    const flow = new BattleFlow(battle, opts);
    flow.entered = true;
    flow.phase = "combat";
    return flow;
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

  view(): TurnView {
    const t = this.turn;
    const actor = t?.actor ?? null;
    const captured = !!actor?.captured;
    const deploy = this.phase === "deploy";
    const hunkered = deploy && !!t && !!actor?.dugIn && !captured && !t.acted && !t.revealed;
    const canAct = this.phase !== "alarm" && !!t && !captured && !t.acted && !hunkered;
    const canUndo = this.battle.canUndo() && !t?.locked;
    const canEngage = this.battle.units.some((u) => u.alive && !u.concealed && actor !== null && u.side !== actor.side);
    const skills = !canAct || !actor ? []
      : deploy ? availableSkills(actor, "pre-combat").filter((s) => s.target !== "enemy" || canEngage)
      : availableSkills(actor, "combat");
    return {
      phase: this.phase,
      actor,
      moved: t?.moved ?? false,
      acted: t?.acted ?? false,
      charged: t?.charged ?? false,
      revealed: t?.revealed ?? false,
      locked: t?.locked ?? false,
      moveBudget: t?.moveBudget ?? 0,
      hunkered,
      canAct,
      canUndo,
      controls: this.phase !== "combat" ? deployActions({ hasActor: !!actor, captured, canUndo }) : [],
      skills,
      frontRadius: this.front.radius,
      alarm: this.alarm,
      seat: this.seat,
    };
  }

  /** The open turn's reachable tiles (path + weighted cost each) for its remaining budget. */
  reach(): Reach[] {
    const t = this.turn;
    if (!t || t.moveBudget <= 0 || isImmobilized(t.actor)) return [];
    return reachableTiles(t.actor, this.battle.units, this.grid, t.moveBudget);
  }

  /** True while the open turn's unit has budget and somewhere to step. */
  canMoveFurther(): boolean {
    return this.reach().some((r) => r.path.length > 0);
  }

  /** May `unit` take its one Act right now (the field-verb gate: strike / skill / Search / Disarm / rescue / gate / entrance)? */
  canAct(unit: Unit): boolean {
    return this.turn?.actor === unit && this.view().canAct;
  }

  /**
   * The combat auto-end gate (D60): the open turn's **both** halves are spent — the Act used
   * and no movement left. Anything short of that keeps the turn open; the player ends it.
   */
  turnExhausted(): boolean {
    return !!this.turn?.acted && !this.canMoveFurther();
  }

  /**
   * Step the clock by one actor. Nothing happens on its own: the player ends a turn and presses
   * Advance, so the board never changes without an input. Refused while a turn (or a policy
   * seat) is open. **Deploy**: a unit's turn opens, or the net's turn resolves the capture wave
   * and may end the phase (`alarm`). **Combat**: the {@link CombatAdvance} branches.
   */
  advance(): FlowAdvance {
    if (this.turn) return { kind: "refused", reason: `${this.turn.actor.name}'s turn is open — end it first` };
    if (this.seat) return { kind: "refused", reason: `${this.seat.name} holds the clock — play its turn first` };
    if (this.phase === "combat") return this.combatAdvance();
    if (this.phase !== "deploy") return { kind: "refused", reason: "deployment is over" };
    const next = this.battle.clock.nextTurn();
    if (next.kind === "unit") {
      const spotted = this.openTurn(next.unit);
      return { kind: "turn", actor: next.unit, spotted };
    }
    // "tempo" (the front leads) or "idle" (never — the front always charges): the net's turn.
    return this.frontTurn();
  }

  /**
   * Open a unit's turn (either phase): budget seeded, the per-turn flags cleared, the shared
   * action-log undo armed (D60/D63 — each move / strike / dig-in / trap is undoable back to the
   * turn's start), and the passive Awareness read as it steps up (D12). Returns what it spotted.
   */
  private openTurn(actor: Unit): ConcealedTrap[] {
    this.turn = { actor, moved: false, acted: false, charged: false, revealed: false, locked: false, moveBudget: moveBudget(actor) };
    this.battle.beginUndo();
    return hiddenTraps(this.battle.entities).length > 0 ? revealTrapsNear(actor, this.battle.entities, this.spotRng) : [];
  }

  /**
   * The combat clock's tick (D60), what `BattleScene.onAdvance` used to decide: a decided
   * encounter finishes before the clock moves; otherwise the clock steps (`nextActor` fires
   * `turnStart` and ticks the actor's statuses), the encounter is re-polled (a tick can close a
   * gate, D50), and the party scouts any ambush body now in sight (D44). A hidden ambusher then
   * passes, an enemy takes the policy seat, and a player unit's turn opens — passing at once when
   * it has nothing it can do (the D55 backstop), so the clock can never stall.
   */
  private combatAdvance(): CombatAdvance {
    if (this.decided()) return { kind: "finish" };
    const out = advanceOutcome(this.battle.nextActor(), this.decided());
    if (out.kind === "finish") return out;
    const revealed = this.revealScouted();
    if (out.kind === "ambushPass") {
      this.battle.endTurn(out.actor, {});
      return { ...out, revealed };
    }
    if (out.kind === "enemyTurn") {
      this.seat = out.actor;
      return { ...out, revealed };
    }
    const actor = out.actor;
    const spotted = this.openTurn(actor);
    const passed = noActionsAvailable({ actor, units: this.battle.units, grid: this.grid, entities: this.battle.entities, hasGuild: this.hasGuild });
    if (passed) this.endTurn(actor);
    return { kind: "playerTurn", actor, revealed, spotted, passed };
  }

  /** Reveal the hidden ambush bodies the party can now see (the scouting payoff, D44). */
  private revealScouted(): Unit[] {
    const revealed: Unit[] = [];
    for (const u of this.battle.units) {
      if (u.hidden && u.alive && canSee(this.battle.units, "player", u.pos)) {
        u.hidden = false;
        revealed.push(u);
      }
    }
    return revealed;
  }

  /**
   * Run a policy-driven turn for `unit` (D56): the enemy holding the seat after `advance`, or —
   * the headless bot's seat — a player unit whose turn is open. The policy plans, the plan runs
   * through the one interpreter and ends the turn (`Battle.runPolicyTurn`); an open turn's
   * take-back window closes with it. Returns the plan for the render to animate, or null when
   * `unit` holds no seat.
   */
  playPolicy(unit: Unit, policy: BattlePolicy = PILOT_POLICY): AIPlan | null {
    if (this.phase !== "combat") return null;
    if (this.seat === unit) {
      this.seat = null;
      return this.battle.runPolicyTurn(unit, policy);
    }
    if (this.turn?.actor !== unit) return null;
    const plan = this.battle.runPolicyTurn(unit, policy);
    this.battle.endUndo();
    this.turn = null;
    return plan;
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
   * (D-feel: the same reach in both phases). The per-step trap read (D12) may truncate the walk:
   * the unit senses a hidden trap and stops short, balks at one it already knows, or blunders
   * onto one it missed (which springs on entry — in combat, a trap that cost HP locks the turn's
   * take-back, D60). Commits through the logged `move` verb (undoable; breaks dig-in).
   */
  move(unit: Unit, tile: GridCoord): FlowMove {
    const t = this.turn;
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
    const sprung = unit.hp < hpBefore;
    if (sprung && this.phase === "combat" && unit.alive) t.locked = true; // a trap bit — the move stands
    return { ok: true, walked: spot.path, spotted: spot.spotted, halted: spot.halted, cost, sprung };
  }

  /**
   * Take another authored entrance (D119): a unit standing in one spawn zone circles round to
   * `zone` — a move, not a swap, respecting the zone's `cap`. It spends the move **and** the Act
   * (circling the building is the turn). Refused when the zone is full.
   */
  takeEntrance(unit: Unit, zone: SpawnZone): { ok: true; dest: GridCoord } | { ok: false; reason: string } {
    if (this.phase !== "deploy" || !this.canAct(unit)) return { ok: false, reason: "not-your-turn" };
    const dest = zoneHasRoom(zone, this.battle.units, unit) ? freeTileIn(zone, this.battle.units, this.grid, unit) : undefined;
    if (!dest) return { ok: false, reason: "full" };
    this.battle.moveUnit(unit, [dest]);
    const t = this.turn!;
    t.moved = true;
    t.moveBudget = 0; // the circle IS the turn — no reposition left after arriving
    this.spendAct(unit);
    return { ok: true, dest };
  }

  /** Dig In (D63): hunker on this tile for a sharply reduced capture chance — the deploy turn's Act. */
  digIn(unit: Unit): boolean {
    const t = this.turn;
    if (this.phase !== "deploy" || !t || t.actor !== unit || unit.captured || t.acted) return false;
    this.battle.digIn(unit); // logged + undoable through the one interpreter
    t.acted = true;
    t.charged = true;
    return true;
  }

  /**
   * Spend the open turn's one Act on a verb the caller already resolved (a strike, a skill cast,
   * Search, Disarm, a rescue, a gate, a bribe …). `charged` is the Act's CT weight — a move-spend
   * skill (Dash) bills as a move, not the full Act (combat; a deploy Act always bills). In deploy,
   * acting breaks the hunker (the status-effect "on action" trigger) unless `keepStance` —
   * placing a trap keeps it. Refused unless {@link canAct}.
   */
  spendAct(unit: Unit, opts: { keepStance?: boolean; charged?: boolean } = {}): boolean {
    if (!this.canAct(unit)) return false;
    const t = this.turn!;
    t.acted = true;
    t.charged = this.phase === "deploy" ? true : opts.charged ?? true;
    if (this.phase === "deploy" && !opts.keepStance) unit.dugIn = false;
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
   * Take back everything the open turn did (positions, HP, statuses, kits, the log) — back to the
   * turn's start. Refused once a sprung trap has locked the turn (no take-back on damage taken).
   */
  undo(unit: Unit): boolean {
    const t = this.turn;
    if (!t || t.actor !== unit || t.locked || !this.battle.canUndo()) return false;
    this.battle.undoAll();
    t.moved = false;
    t.acted = false;
    t.charged = false;
    t.revealed = false; // back to the minimal menu if the unit began the turn dug in
    t.moveBudget = moveBudget(unit); // the whole turn rolled back — full range again
    return true;
  }

  /**
   * End the open turn: the take-back window closes and the unit's CT is spent from what it
   * actually did (logged) — a unit that only stepped pays the Move cost, one that took a
   * charged Act pays the Act.
   */
  endTurn(unit: Unit): boolean {
    const t = this.turn;
    if (!t || t.actor !== unit) return false;
    this.battle.endUndo(); // the turn commits — no take-back across the boundary
    this.turn = null;
    this.battle.endTurn(unit, { moved: t.moved, acted: t.charged });
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
}

/** A headless deploy policy — what a bot does with a unit's open deploy turn ({@link RunLoop.autoDeploy}). */
export type DeployPolicy = (flow: BattleFlow, actor: Unit) => void;

/** The naive bot's deploy: hold position (end the turn at once). */
export const HOLD_POSITION: DeployPolicy = (flow, actor) => {
  flow.endTurn(actor);
};
