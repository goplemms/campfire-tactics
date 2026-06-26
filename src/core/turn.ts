/**
 * Battle orchestrator — the single entry the render layer drives.
 *
 * Wires the pieces together: a {@link CTClock} picks the next actor, the
 * {@link EventBus} announces moments (turn start/end, tile enter/leave, damage,
 * defeat), the {@link EntityRegistry} lets entities react, {@link combat}
 * resolves attacks, and {@link planEnemyTurn} runs the enemy. The render layer
 * calls `nextActor`, then `moveUnit` / `attack` / `endTurn` (or `runEnemyTurn`),
 * then checks `outcome` — it owns no rules.
 *
 * Pure logic: no Phaser, no DOM.
 */

import { isActive, type Unit, type Side } from "./units";
import type { GridCoord } from "./iso";
import type { TileGrid } from "./grid";
import type { Inventory } from "./inventory";
import { EventBus } from "./events";
import { CTClock, type TurnSpend, onSkillCooldown, armSkillCooldown } from "./clock";
import { EntityRegistry } from "./entities";
import {
  resolveAttack,
  battleOutcome,
  refreshAuras,
  isAdjacent,
  type BattleOutcome,
} from "./combat";
import { tickStatuses, applyStatus, guarded, GUARDED } from "./status";
import { computeVisibleTiles } from "./vision";
import { PILOT_POLICY, type AIPlan, type BattlePolicy } from "./ai";
import { stampPassives } from "./jobs";
import {
  resolveSkill,
  resolveMedHeal,
  type SkillDef,
  type SkillOutcome,
  type PlaceTrapEffect,
} from "./skills";
import {
  commitsTurn,
  isDeployAction,
  type CombatAction,
  type ActionResult,
  type UnitId,
} from "./combat-actions";
import { placePlayerTrap } from "./traps";
import { cleaveArc, shoveLanding } from "./ability-forecast";
import { captureUnit } from "./deployment";
import type { RecoverableEntity } from "./entities";
import { streamFor, type Rng } from "./rng";
import type { ClockSnapshot } from "./clock";
import type { EntitySnapshot } from "./entities";
import type { StatusInstance } from "./status";
import type { GridCoord as Coord } from "./iso";

/** A unit's undoable mutable state (everything a logged action can change). */
interface UnitSnapshot {
  pos: Coord;
  hp: number;
  ct: number;
  alive: boolean;
  captured: boolean;
  dugIn?: boolean;
  hidden?: boolean;
  statuses: StatusInstance[];
  counters: Record<string, number>;
  cooldowns: Record<string, number>;
}

/**
 * A turn-undo checkpoint (combat-actions Phase 2): the battle's mutable state
 * **before** one applied action — enough to roll it back in place. Captures the
 * log length and the RNG draw counter (so re-rolled values re-derive identically),
 * plus the unit / clock / entity state. Restored by value into identity-stable
 * objects, so the render keeps every reference (no re-emission, no re-binding).
 */
interface BattleCheckpoint {
  logLen: number;
  drawCount: number;
  units: Map<UnitId, UnitSnapshot>;
  clock: ClockSnapshot;
  entities: EntitySnapshot;
  /** Shared-stash counts by value (D63) — so undoing a `placeTrap` refunds its kit. */
  stash?: Record<string, number>;
}

/** Capture a unit's undoable mutable state by value. */
function snapshotUnit(u: Unit): UnitSnapshot {
  return {
    pos: { col: u.pos.col, row: u.pos.row },
    hp: u.hp,
    ct: u.ct,
    alive: u.alive,
    captured: u.captured,
    dugIn: u.dugIn,
    hidden: u.hidden,
    statuses: u.statuses.map((s) => ({ ...s, data: s.data ? { ...s.data } : undefined })),
    counters: { ...u.counters },
    cooldowns: { ...u.cooldowns },
  };
}

/** Write a unit snapshot back onto the (identity-stable) live unit. */
function restoreUnit(u: Unit, s: UnitSnapshot): void {
  u.pos = { col: s.pos.col, row: s.pos.row };
  u.hp = s.hp;
  u.ct = s.ct;
  u.alive = s.alive;
  u.captured = s.captured;
  u.dugIn = s.dugIn;
  u.hidden = s.hidden;
  u.statuses = s.statuses.map((x) => ({ ...x, data: x.data ? { ...x.data } : undefined }));
  u.counters = { ...s.counters };
  u.cooldowns = { ...s.cooldowns };
}

/**
 * Construction-time battle settings (all optional, all defaulting to the
 * **deterministic** baseline so an unconfigured battle is byte-identical to the
 * pre-RNG behaviour). The seam the "range of possibility" soft-randomization rides.
 */
export interface BattleOptions {
  /**
   * Seed for this battle's **label-derived** RNG (`streamFor(seed, label)`). Stays
   * `0` by default; production wires `streamFor(run.seed, \`battle:${node}:${night}\`)`
   * so the whole run still reproduces from its run seed.
   */
  seed?: string | number;
  /**
   * **Damage-variance amplitude** (±fraction of final damage): `0` (default) is the
   * deterministic floor (no roll, no draw); `0.2` spreads each hit across ±20%.
   * Resolved only in {@link Battle.apply} (planning sees the mean).
   */
  variance?: number;
}

/** The CT a skill spends on its caster's turn (Act is the expensive option, D5). */
function spendFor(skill: SkillDef): TurnSpend {
  return { acted: skill.spend === "act", moved: skill.spend === "move" };
}

export class Battle {
  readonly grid: TileGrid;
  readonly units: Unit[];
  readonly bus: EventBus;
  readonly clock: CTClock;
  readonly entities: EntityRegistry;

  /**
   * The **action log** (D4 event-sourcing of commands) — the combat analog of the
   * purse journal. {@link apply} appends each executed {@link CombatAction} here in
   * order; it is the substrate {@link replay} (and later undo / netcode / a sim
   * trace) reads. Combat state is a graph, not a conserved scalar, so it
   * reconstructs by **replay**, not by summing (`replay(log) === state`).
   */
  private readonly _log: CombatAction[] = [];

  /** This battle's RNG seed (label-derived rolls draw from `streamFor(seed, …)`). */
  private readonly rngSeed: string | number;
  /** Damage-variance amplitude (0 = deterministic; no draw happens). */
  private readonly variance: number;
  /**
   * Monotonic draw counter — the temporal coordinate that disambiguates rolls. It
   * advances **only** inside {@link apply} (the sole draw site), so it increments in
   * the exact same order on a {@link replay} and the rolls re-derive identically.
   */
  private drawCount = 0;

  /**
   * The turn-undo checkpoint stack (combat-actions Phase 2). `null` when undo is
   * **disarmed** (enemy turns, headless sim) — no snapshots are taken, so there is
   * zero cost. {@link beginUndo} arms it for a player turn; each successfully applied
   * action pushes a pre-state checkpoint; {@link undo} pops + restores.
   */
  private undoStack: BattleCheckpoint[] | null = null;

  /**
   * The shared supply stash (D63 unification) — the run inventory the Deployment
   * `placeTrap` verb draws kits from, wired by the scene via {@link setStash} before
   * the deploy phase. Left unset for a bare battle (headless sim / tests that don't
   * place traps), where `placeTrap` simply refuses.
   */
  private stash?: Inventory;

  constructor(grid: TileGrid, units: Unit[], opts: BattleOptions = {}) {
    this.grid = grid;
    this.units = units;
    this.bus = new EventBus();
    this.clock = new CTClock(units, this.bus);
    this.entities = new EntityRegistry(this.bus);
    this.rngSeed = opts.seed ?? 0;
    this.variance = opts.variance ?? 0;
    // Stamp job passives + arm the tarpit aura from the starting formation (D40).
    for (const u of units) stampPassives(u);
    refreshAuras(units);
  }

  /**
   * **The single combat-RNG seam** (the "soft randomization" substrate). Returns a
   * fresh deterministic {@link Rng} for one labelled roll, keyed by `(seed, label,
   * draw#)` — the label/coordinate approach (`streamFor`) the trap/encounter rolls
   * already use, so there is **no stateful cursor to snapshot**: a replay re-derives
   * every roll from the same coordinates. **Call only from within action resolution
   * ({@link apply}-driven)** — drawing during planning/forecast would desync replay.
   */
  roll(label: string): Rng {
    return streamFor(this.rngSeed, `${label}#${this.drawCount++}`);
  }

  /**
   * A **label-keyed** RNG stream off this battle's seed (D67 RNG-seam unification) — the
   * second draw shape beside {@link roll}. Where `roll` is keyed by an incrementing
   * `drawCount` (for *apply-driven* combat draws that a re-running replay reproduces in
   * order), `stream` is keyed by a **fixed label** with no cursor — for the **Deployment**
   * draws (front-capture, trap-spotting) that run outside the turn loop and whose outcomes
   * are either logged (capture) or render-only (spotting), so a replay never re-rolls them.
   * Same `(seed, label)` ⇒ the same stream, every time, so deployment stays reproducible
   * from the one encounter seed the Battle now owns — instead of the scene reaching into the
   * run seed itself. **Don't route apply-driven draws through this** (use {@link roll}).
   */
  stream(label: string): Rng {
    return streamFor(this.rngSeed, label);
  }

  /**
   * The damage-variance multiplier for one hit (±{@link variance}), or exactly `1`
   * — taking **no** draw — when variance is off. Keeps the off-path byte-identical.
   */
  private damageScale(attacker: Unit, defender: Unit): number {
    if (this.variance <= 0) return 1;
    return this.roll(`dmg:${attacker.id}->${defender.id}`).float(1 - this.variance, 1 + this.variance);
  }

  /**
   * Apply the per-side initiative seed (D11). Call once before the first turn.
   * `moraleBonus` warms the player's seed per the D8 morale bundle.
   */
  seed(moraleBonus = 0): void {
    this.clock.seedInitiative(moraleBonus ? { player: moraleBonus } : {});
  }

  /** The append-only action log in execution order (read-only to callers). */
  get log(): readonly CombatAction[] {
    return this._log;
  }

  /** Wire the shared supply stash the Deployment `placeTrap` verb draws from (D63). */
  setStash(stash: Inventory): void {
    this.stash = stash;
  }

  /** Resolve a {@link UnitId} to its live unit in this battle's roster. */
  private unit(id: UnitId): Unit {
    const u = this.units.find((x) => x.id === id);
    if (!u) throw new Error(`Battle.apply: no unit with id "${id}"`);
    return u;
  }

  // --- Undo (combat-actions Phase 2) ----------------------------------------

  /**
   * **Arm undo** for an undoable span — a player turn (D60 free-move / D-into-the-
   * breach take-back). While armed, each successfully applied action records a
   * pre-state checkpoint, so {@link undo} can peel actions back one at a time.
   * Starts a fresh (empty) history. The headless sim and enemy turns leave undo
   * disarmed, so they pay nothing.
   */
  beginUndo(): void {
    this.undoStack = [];
  }

  /** **Disarm undo** — the turn committed; drop the history (no take-back across turns). */
  endUndo(): void {
    this.undoStack = null;
  }

  /** True if undo is armed and there is at least one action to take back. */
  canUndo(): boolean {
    return (this.undoStack?.length ?? 0) > 0;
  }

  /** How many actions are currently undoable (the armed history depth). */
  undoDepth(): number {
    return this.undoStack?.length ?? 0;
  }

  /**
   * **Undo the most recent action**, rolling the battle back to exactly its state
   * before that action — positions, HP, CT, statuses, cooldowns, the CT clock and
   * its in-flight charges, entity flags, the RNG draw cursor, and the log. Restored
   * **in place** into the same unit/clock/entity objects (no re-emission, so live
   * listeners like the combat-XP tally and render FX don't re-fire). Returns the
   * undone {@link CombatAction}, or `null` if there's nothing to undo.
   */
  undo(): CombatAction | null {
    if (!this.undoStack || this.undoStack.length === 0) return null;
    const checkpoint = this.undoStack.pop()!;
    const undone = this._log[this._log.length - 1] ?? null;
    this.restoreCheckpoint(checkpoint);
    return undone;
  }

  /** Undo every action back to the start of the armed span; returns them newest-first. */
  undoAll(): CombatAction[] {
    const undone: CombatAction[] = [];
    let a: CombatAction | null;
    while ((a = this.undo()) !== null) undone.push(a);
    return undone;
  }

  /** Capture the battle's mutable state before an action (a turn-undo checkpoint). */
  private captureCheckpoint(): BattleCheckpoint {
    const units = new Map<UnitId, UnitSnapshot>();
    for (const u of this.units) units.set(u.id, snapshotUnit(u));
    return {
      logLen: this._log.length,
      drawCount: this.drawCount,
      units,
      clock: this.clock.snapshot(),
      entities: this.entities.snapshot(),
      stash: this.stash ? { ...this.stash.counts } : undefined,
    };
  }

  /** Roll all mutable state (and the log) back to a checkpoint — the undo primitive. */
  private restoreCheckpoint(cp: BattleCheckpoint): void {
    for (const u of this.units) {
      const s = cp.units.get(u.id);
      if (s) restoreUnit(u, s);
    }
    this.clock.restore(cp.clock);
    this.entities.restore(cp.entities);
    if (cp.stash && this.stash) this.stash.counts = { ...cp.stash };
    this.drawCount = cp.drawCount;
    this._log.length = cp.logLen; // drop the actions taken since the checkpoint
    // Positions reverted → re-derive the position-dependent tarpit aura (D40). The
    // restored statuses already match, so this is a confirming no-op in practice.
    refreshAuras(this.units);
  }

  /**
   * **The single execution path** for a battle action (Phase 1 of the
   * combat-actions design): validate → mutate → emit → **append to the log**. Player
   * input and {@link AIPlan} both lower to {@link CombatAction}s and flow through
   * here, so the two paths can't drift. Returns an {@link ActionResult} carrying the
   * verb's natural outcome (so the public wrappers keep their original return
   * shapes); a **refused** action (e.g. a skill on cooldown) is *not* logged.
   *
   * When undo is **armed** ({@link beginUndo}), a successful action also pushes a
   * pre-state checkpoint onto the undo stack (Phase 2). The snapshot is taken before
   * mutation and kept only if the action committed to the log, so a refusal leaves
   * the stack untouched.
   *
   * Adding a battle action = a new {@link CombatAction} variant + a case here.
   */
  apply(action: CombatAction): ActionResult {
    const checkpoint = this.undoStack ? this.captureCheckpoint() : null;
    const result = this.dispatch(action);
    if (checkpoint && result.ok) this.undoStack!.push(checkpoint);
    return result;
  }

  /** Validate → mutate → emit → log a single action (the interpreter core). */
  private dispatch(action: CombatAction): ActionResult {
    switch (action.kind) {
      case "move": {
        this.execMove(this.unit(action.unit), action.path, false);
        this._log.push(action);
        return { ok: true };
      }
      case "attack": {
        const attacker = this.unit(action.unit);
        const target = this.unit(action.target);
        const damage = resolveAttack(attacker, target, this.bus, attacker.attack, this.units, this.damageScale(attacker, target));
        this._log.push(action);
        return { ok: true, damage };
      }
      case "skill": {
        const caster = this.unit(action.unit);
        const target = this.unit(action.target);
        const skill = action.skill;
        const commitTurn = action.commitTurn ?? true;
        if (!this.canUseSkill(caster, skill)) return { ok: false, reason: "cooling down" };
        let outcome: SkillOutcome;
        if (skill.effect.kind === "forced-move") {
          outcome = this.resolveShove(caster, target, skill.effect.tiles, skill.effect.bonusAttack ?? 0);
        } else if (skill.effect.kind === "guard-allies") {
          outcome = this.resolveGuardAllies(caster, skill.effect.amount, skill.effect.duration ?? 1);
        } else if (skill.cost?.charge) {
          // Commit to the timeline; the effect lands when its gauge fills (D5/D37).
          this.clock.schedule({
            id: `charge:${caster.id}:${skill.id}:${this.clock.time}`,
            speed: skill.cost.charge,
            caster,
            run: () => {
              if (target.alive) resolveSkill(skill, caster, target, this.bus, this.units);
            },
          });
          outcome = { charging: true };
        } else {
          outcome = resolveSkill(skill, caster, target, this.bus, this.units);
        }
        this.commitSkill(caster, skill, commitTurn);
        this._log.push(action);
        return { ok: true, outcome };
      }
      case "cleave": {
        const caster = this.unit(action.unit);
        const skill = action.skill;
        if (!this.canUseSkill(caster, skill)) return { ok: false, reason: "cooling down" };
        const { hits, damage } = this.execCleave(caster, skill, action.dir);
        this.commitSkill(caster, skill, true);
        this._log.push(action);
        return { ok: true, hits, damage };
      }
      case "endTurn": {
        this.execEndTurn(this.unit(action.unit), action.spend);
        this._log.push(action);
        return { ok: true };
      }
      case "deployMove": {
        // Deployment reposition: the same walk as `move` (springs entities, breaks
        // dig-in), kept a distinct verb so replay can drain the deploy prelude.
        this.execMove(this.unit(action.unit), action.path, false);
        this._log.push(action);
        return { ok: true };
      }
      case "deploySkill": {
        // A dual-context ability cast during Deployment (e.g. Dash → Swift): resolve the
        // effect like the combat `skill` verb but WITHOUT the CT-clock turn-commit (the deploy
        // clock owns the turn). A distinct, drained verb so replay reconstructs it as part of
        // the deploy prelude — not a post-seed combat action.
        const caster = this.unit(action.unit);
        const target = this.unit(action.target);
        const skill = action.skill;
        if (!this.canUseSkill(caster, skill)) return { ok: false, reason: "cooling down" };
        let outcome: SkillOutcome;
        if (skill.effect.kind === "forced-move") {
          outcome = this.resolveShove(caster, target, skill.effect.tiles, skill.effect.bonusAttack ?? 0);
        } else if (skill.effect.kind === "guard-allies") {
          outcome = this.resolveGuardAllies(caster, skill.effect.amount, skill.effect.duration ?? 1);
        } else {
          outcome = resolveSkill(skill, caster, target, this.bus, this.units);
        }
        this._log.push(action);
        return { ok: true, outcome };
      }
      case "digIn": {
        this.unit(action.unit).dugIn = true;
        this._log.push(action);
        return { ok: true };
      }
      case "placeTrap": {
        if (!this.stash) return { ok: false, reason: "No supply stash wired for trap placement." };
        const actor = this.unit(action.unit);
        const res = placePlayerTrap(this.stash, this.entities, actor, action.pos, action.effect, action.id);
        if (!res.ok) return { ok: false, reason: res.reason ?? "Can't place a trap here." };
        this._log.push(action);
        return { ok: true, trap: res.trap, levels: res.levels };
      }
      case "capture": {
        captureUnit(this.unit(action.unit));
        this._log.push(action);
        return { ok: true };
      }
    }
  }

  /**
   * Advance the clock to the next actor, fire `turnStart`, and tick that unit's
   * statuses. Returns the acting unit, or null if the battle can't continue.
   */
  nextActor(): Unit | null {
    const unit = this.clock.advanceToNextActor();
    if (!unit) return null;
    this.bus.emit("turnStart", { unit });
    tickStatuses(unit);
    return unit;
  }

  /**
   * Walk a unit through a sequence of tiles, emitting `unitLeaveTile` /
   * `unitEnterTile` for each step so entities (traps, snares) and forced-move
   * combos fire. `forced` marks push/pull entries (D19).
   */
  moveUnit(unit: Unit, path: readonly GridCoord[], forced = false): void {
    // A `forced` step is an internal sub-effect of a shove (the skill action
    // already logs); a normal move lowers to a logged `move` action through apply.
    if (forced) this.execMove(unit, path, true);
    else this.apply({ kind: "move", unit: unit.id, path: [...path] });
  }

  /** The raw walk (the move-action body): emit leave/enter per step, refresh auras. */
  private execMove(unit: Unit, path: readonly GridCoord[], forced: boolean): void {
    for (const tile of path) {
      this.bus.emit("unitLeaveTile", { unit, tile: unit.pos });
      unit.pos = { col: tile.col, row: tile.row };
      this.bus.emit("unitEnterTile", { unit, tile, forced });
    }
    // Moving breaks the Deployment dig-in stance (D63); a no-op in combat.
    if (path.length > 0) unit.dugIn = false;
    // Positions changed → recompute the Heavy Knight's tarpit ring (D40).
    refreshAuras(this.units);
  }

  /**
   * Resolve a basic attack, firing damage/defeat events. Passes the full roster
   * so **flanking** (D36) applies. Returns damage dealt.
   */
  attack(attacker: Unit, target: Unit): number {
    const r = this.apply({ kind: "attack", unit: attacker.id, target: target.id });
    return r.ok ? r.damage ?? 0 : 0;
  }

  /** True if `caster` may use `skill` right now (not cooling down, D37). */
  canUseSkill(caster: Unit, skill: SkillDef): boolean {
    return !onSkillCooldown(caster, skill.id);
  }

  /**
   * The shared **commit half** of a skill use: arm its cooldown (if any) and —
   * unless the D60 free-move flow keeps the turn open (`commitTurn: false`) — end
   * the caster's turn, spending CT per the skill's `spend`. Used by `useSkill`,
   * `useHeal`, and `cleave` so the cooldown-arm + turn-end pair lives in one place.
   */
  private commitSkill(caster: Unit, skill: SkillDef, commitTurn: boolean): void {
    if (skill.cost?.cooldown) armSkillCooldown(caster, skill.id, skill.cost.cooldown);
    // Raw end (not the logged wrapper): the skill/cleave action already records the
    // turn commit, so re-routing through apply here would double-log an endTurn.
    if (commitTurn) this.execEndTurn(caster, spendFor(skill));
  }

  /**
   * Resolve a job skill against a target (firing its bus events) and — unless
   * `commitTurn` is false — end the caster's turn, spending CT per the skill's
   * cost. The single entry the render layer uses for the skill buttons. Honors the
   * **ability economy** (D37): a **charged** skill commits now and resolves later
   * on the clock (caster-death fizzles it); a skill with a **cooldown** arms it;
   * both still spend the Act.
   *
   * **`commitTurn: false`** (the D60 free-move turn) resolves the effect and arms
   * its cooldown/charge but leaves the turn *open* — the render layer keeps the
   * caster on the clock so it can spend any leftover movement, then ends the turn
   * itself. The AI and the headless sim keep the default (the skill ends the turn).
   */
  useSkill(caster: Unit, skill: SkillDef, target: Unit, opts: { commitTurn?: boolean } = {}): SkillOutcome {
    const r = this.apply({ kind: "skill", unit: caster.id, skill, target: target.id, commitTurn: opts.commitTurn ?? true });
    return r.ok ? r.outcome ?? {} : {};
  }

  /**
   * Push `target` away from `caster` (D19 forced movement, the Knight's Shove):
   * step it `tiles` tiles along the orthogonal away-vector, **stopping at a
   * blocker** (a wall or an occupied tile); forced entry onto an entity tile
   * fires it (via `moveUnit`'s `forced` flag). An optional `bonusAttack` deals a
   * shove hit. Returns how far it actually moved + any damage.
   */
  resolveShove(caster: Unit, target: Unit, tiles: number, bonusAttack = 0): SkillOutcome {
    // Walk the shove one tile at a time toward the landing the pure `shoveLanding`
    // core computes (D64 single-source-of-truth: the telegraph reads the *same*
    // geometry the resolver does, so the push arrow and into-trap read can't
    // drift). Each step goes through `moveUnit` so entities (traps) fire en route.
    const dc = Math.sign(target.pos.col - caster.pos.col);
    const dr = Math.sign(target.pos.row - caster.pos.row);
    const { moved } = shoveLanding(
      caster.pos,
      target.pos,
      tiles,
      (c) => this.grid.isWalkable(c),
      (c) => this.units.some((u) => u.alive && u !== target && u.pos.col === c.col && u.pos.row === c.row),
    );
    for (let i = 0; i < moved; i++) {
      this.moveUnit(target, [{ col: target.pos.col + dc, row: target.pos.row + dr }], true);
    }
    const out: SkillOutcome = {};
    if (bonusAttack !== 0 && target.alive) {
      out.damage = resolveAttack(caster, target, this.bus, caster.attack + bonusAttack, this.units);
    }
    void moved;
    return out;
  }

  /**
   * The Soldier's **Turtle Formation** (D66): brace the line — apply Guarded to
   * every ally orthogonally adjacent to the caster (an "AoE Defend"; per-ally,
   * lasting to that ally's next turn, like Defend). Needs the roster, so it resolves
   * here rather than via the unit-pair {@link resolveSkill}. Returns the Guarded id
   * when it braced anyone.
   */
  resolveGuardAllies(caster: Unit, amount: number, duration: number): SkillOutcome {
    let braced = 0;
    for (const u of this.units) {
      if (isActive(u) && u.side === caster.side && u !== caster && isAdjacent(u.pos, caster.pos)) {
        applyStatus(u, guarded(duration, amount));
        braced += 1;
      }
    }
    return braced > 0 ? { status: GUARDED } : {};
  }

  /**
   * The Heavy Knight's **Cleave** (D40 directional AoE): hit every foe in the
   * three-tile 90° arc facing `dir` (the orthogonal tile + its two flanking
   * diagonals). `dir` is a unit step vector. Flanking applies per hit. Ends the
   * caster's turn. Returns the foes hit + total damage.
   */
  cleave(caster: Unit, skill: SkillDef, dir: GridCoord): { hits: number; damage: number } {
    const r = this.apply({ kind: "cleave", unit: caster.id, skill, dir });
    return r.ok ? { hits: r.hits ?? 0, damage: r.damage ?? 0 } : { hits: 0, damage: 0 };
  }

  /** The raw arc resolution (the cleave-action body) — hit every foe in the 90° arc. */
  private execCleave(caster: Unit, skill: SkillDef, dir: GridCoord): { hits: number; damage: number } {
    const bonus = skill.effect.kind === "cleave" ? skill.effect.bonusAttack : 0;
    // The arc geometry comes from the shared `cleaveArc` core (D64) so the
    // telegraph washes exactly the tiles this resolver sweeps — one source of truth.
    const arc: GridCoord[] = cleaveArc(caster.pos, dir);
    const key = (g: GridCoord) => `${g.col},${g.row}`;
    const arcKeys = new Set(arc.map(key));
    let hits = 0;
    let damage = 0;
    for (const u of this.units) {
      if (u.alive && u.side !== caster.side && arcKeys.has(key(u.pos))) {
        damage += resolveAttack(caster, u, this.bus, caster.attack + bonus, this.units, this.damageScale(caster, u));
        hits += 1;
      }
    }
    return { hits, damage };
  }

  /**
   * The Medic's **Heal** (D40 combat↔logistics bridge): consume `herbId` from
   * the shared stash and heal `target` with the herb's rider (salve/stimulant/
   * antidote). Arms the Heal cooldown and ends the turn. A no-op (no turn spent)
   * if cooling down or the herb isn't carried. `commitTurn: false` leaves the turn
   * open for the D60 free-move flow (the render layer ends it).
   */
  useHeal(caster: Unit, skill: SkillDef, target: Unit, herbId: string, inv: Inventory, opts: { commitTurn?: boolean } = {}): SkillOutcome {
    if (!this.canUseSkill(caster, skill)) return {};
    const out = resolveMedHeal(caster, target, herbId, inv, this.bus);
    if (out.healed === undefined) return out; // herb not carried — no commit
    this.commitSkill(caster, skill, opts.commitTurn ?? true);
    return out;
  }

  /** End a unit's turn: fire `turnEnd` and spend its CT (act costs more). */
  endTurn(unit: Unit, spend: TurnSpend): void {
    this.apply({ kind: "endTurn", unit: unit.id, spend });
  }

  // --- Deployment-phase verbs (D63 unification) -----------------------------

  /**
   * Reposition a unit during Deployment — the same logged walk as a combat move
   * (so it's undoable and springs any entity it crosses), and it breaks the unit's
   * dig-in stance. Distinct from `move` only so {@link replay} can tell the deploy
   * prelude from the combat turn loop.
   */
  deployMove(unit: Unit, path: readonly GridCoord[]): void {
    this.apply({ kind: "deployMove", unit: unit.id, path: [...path] });
  }

  /**
   * Cast a dual-context ability during Deployment (D67) — resolves the effect with no CT
   * commit (the deploy clock owns the turn); a distinct **drained** verb so {@link replay}
   * keeps it in the deploy prelude rather than re-applying it as a post-seed combat action.
   */
  deploySkill(unit: Unit, skill: SkillDef, target: Unit): void {
    this.apply({ kind: "deploySkill", unit: unit.id, skill, target: target.id });
  }

  /** Hunker for a reduced capture chance when the net's turn comes (D63). */
  digIn(unit: Unit): void {
    this.apply({ kind: "digIn", unit: unit.id });
  }

  /**
   * Lay a player trap on `pos`, consuming one kit from the wired stash (D11/D63).
   * On success returns the registered entity + any character levels gained; on a
   * refusal (no kit, tile taken, or no stash wired) returns the reason for the hint.
   */
  placeTrap(unit: Unit, pos: GridCoord, effect: PlaceTrapEffect, id: string): { ok: true; trap?: RecoverableEntity; levels: number } | { ok: false; reason: string } {
    const r = this.apply({ kind: "placeTrap", unit: unit.id, pos, effect, id });
    return r.ok ? { ok: true, trap: r.trap, levels: r.levels ?? 0 } : { ok: false, reason: r.reason };
  }

  /** Bind a unit captured by the closing net (D7/D63) — the deploy "enemy turn" outcome. */
  capture(unit: Unit): void {
    this.apply({ kind: "capture", unit: unit.id });
  }

  /** The raw turn-end (the endTurn-action body): fire `turnEnd`, spend the CT. */
  private execEndTurn(unit: Unit, spend: TurnSpend): void {
    this.bus.emit("turnEnd", { unit });
    this.clock.spend(unit, spend);
  }

  /**
   * Run a full AI turn for `unit`: plan via the given {@link BattlePolicy} (the
   * **pilot** policy by default, D56), execute it through the bus, and end the
   * turn. Returns the plan for the render layer to animate. "Enemy" is historical —
   * the same path drives either side headlessly (the sim passes a policy per side).
   */
  runEnemyTurn(unit: Unit, policy: BattlePolicy = PILOT_POLICY): AIPlan {
    const plan = policy.plan(unit, this.units, this.grid, {
      isCharging: (u) => this.clock.isCharging(u),
    });
    // Lower the plan to a CombatAction[] and run each through the one interpreter —
    // the AI path now shares the exact execution route with player input (D42/D56).
    for (const action of planActions(plan)) this.apply(action);
    return plan;
  }

  /** Current win/lose state. */
  outcome(): BattleOutcome {
    return battleOutcome(this.units);
  }

  /** Tiles a side can currently see (vision seam, D18). */
  visibleTiles(side: Side): Set<string> {
    return computeVisibleTiles(this.units, side);
  }
}

/**
 * Lower an {@link AIPlan} (intent-as-data, D42) to the {@link CombatAction}s that
 * realize it — the *plan → actions* half of the AI/player convergence. Mirrors the
 * old `runEnemyTurn` ordering exactly: an optional move, then **either** a
 * turn-ending ability (the snare) **or** an optional attack followed by an explicit
 * `endTurn`. A skill commits the turn itself, so no `endTurn` follows it.
 */
function planActions(plan: AIPlan): CombatAction[] {
  const unit = plan.unit.id;
  const actions: CombatAction[] = [];
  if (plan.path.length > 0) actions.push({ kind: "move", unit, path: plan.path.map((t) => ({ ...t })) });
  if (plan.ability && plan.target?.alive) {
    actions.push({ kind: "skill", unit, skill: plan.ability, target: plan.target.id, commitTurn: true });
    return actions; // the skill ends the turn (commitSkill spends the CT)
  }
  if (plan.target?.alive) actions.push({ kind: "attack", unit, target: plan.target.id });
  actions.push({ kind: "endTurn", unit, spend: { moved: plan.path.length > 0, acted: plan.target !== null } });
  return actions;
}

/**
 * **Replay** a recorded action {@link log} from an initial roster and assert it
 * reconstructs the same battle (the `replay(initial, log) === state` invariant —
 * the combat analog of the purse journal's `sum(log) === gold`). Combat state is a
 * graph, not a scalar, so it rebuilds by **re-running** rather than summing: build a
 * fresh {@link Battle} from `initialUnits` (a pre-construction snapshot), seed it
 * identically, then drive the deterministic, RNG-free turn loop — for each
 * {@link Battle.nextActor} (which ticks the clock + statuses identically), apply the
 * recorded actions for that turn (up to and including the one that {@link
 * commitsTurn commits} it) instead of planning. Returns the rebuilt battle.
 *
 * `initialUnits` is **mutated** (the {@link Battle} constructor stamps passives) —
 * pass throwaway clones of the pre-seed roster. `opts` must carry the **same**
 * {@link BattleOptions} (seed + variance) the original battle used, so any seeded
 * rolls re-derive identically; `moraleBonus` re-applies the initiative warming.
 */
export function replay(
  grid: TileGrid,
  initialUnits: Unit[],
  log: readonly CombatAction[],
  opts: BattleOptions & { moraleBonus?: number } = {},
): Battle {
  const battle = new Battle(grid, initialUnits, opts);
  // Drain the Deployment prelude (D63 unification): deploy verbs always lead the
  // log and aren't part of a CT turn, so apply them before seeding + driving combat.
  let i = 0;
  while (i < log.length && isDeployAction(log[i])) battle.apply(log[i++]);
  battle.seed(opts.moraleBonus ?? 0);
  while (i < log.length) {
    const actor = battle.nextActor();
    if (!actor) break;
    // Apply this actor's recorded turn: every turn's actions end in exactly one
    // committing action (an endTurn, a cleave, or a turn-committing skill).
    while (i < log.length) {
      const action = log[i++];
      battle.apply(action);
      if (commitsTurn(action)) break;
    }
  }
  return battle;
}
