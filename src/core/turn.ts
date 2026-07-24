/**
 * Battle orchestrator — the single entry the render layer drives.
 *
 * Wires the pieces together: a {@link CTClock} picks the next actor, the
 * {@link EventBus} announces moments (turn start/end, tile enter/leave, damage,
 * defeat), the {@link EntityRegistry} lets entities react, {@link combat}
 * resolves attacks, and {@link planEnemyTurn} runs the enemy. The render layer
 * calls `nextActor`, then `moveUnit` / `attack` / `endTurn` (or `runPolicyTurn`),
 * then checks `outcome` — it owns no rules.
 *
 * Pure logic: no Phaser, no DOM.
 */

import { activeUnits, opposite, type Unit, type Side } from "./units";
import type { GridCoord } from "./iso";
import type { TileGrid } from "./grid";
import type { Inventory } from "./inventory";
import { removeItem } from "./inventory";
import type { MaterialCost } from "./cost";
import { EventBus } from "./event-bus";
import { CTClock, type TurnSpend, onSkillCooldown, armSkillCooldown } from "./clock";
import { EntityRegistry } from "./entities";
import {
  resolveAttack,
  battleOutcome,
  refreshAuras,
  manhattan,
  type BattleOutcome,
} from "./combat";
import { tickStatuses, applyStatus, slowed } from "./status";
import { computeVisibleTiles } from "./vision";
import { PILOT_POLICY, edgeDistance, type AIPlan, type BattlePolicy } from "./ai";
import { orderOf } from "./standing-orders";
import { stampPassives, getSkill, type SkillLookup } from "./jobs";
import { isExhausted, exhaustionSlowSpeed, FATIGUE } from "./fatigue";
import {
  resolveSkill,
  resolveMedHeal,
  type SkillDef,
  type SkillOutcome,
  type PlaceTrapEffect,
} from "./skills";
import {
  type CombatAction,
  type BattleActionResult,
  type UnitId,
} from "./combat-actions";
import { placePlayerTrap } from "./traps";
import { captureUnit, freeCaptive, canRelease } from "./deployment";
import { applyGatesToGrid, openGateOnGrid, destroyGateOnGrid, lockGateOnGrid, canLockpickGate, canAttackGate, canKeyGate, canPullLever, damageGate, gatesOpenedByDeath, type Gate, type Lever } from "./gates";
import type { RecoverableEntity } from "./entities";
import { streamFor, type Rng } from "./rng";
import { Labels } from "./rng-labels";
import { captureCheckpoint, restoreCheckpoint, type BattleCheckpoint } from "./battle-undo";
import { exchangedDamageSince, type CombatLogEntry } from "./combat-log";
import type { TagContext } from "./tags";
import {
  resolveShove as resolveShoveEffect,
  resolveGuardAllies as resolveGuardAlliesEffect,
  execCleave as execCleaveEffect,
} from "./field-effects";
import { planActions } from "./battle-replay";

// The undo machinery + the replay driver live in sibling modules now (R3, #121);
// re-export the formerly-`turn.ts` public surface so the barrel + existing importers
// are unchanged (sanctioned migration re-exports).
export { snapshotUnit, restoreUnit } from "./battle-undo";
export { replay } from "./battle-replay";

/**
 * Construction-time battle settings (all optional, all defaulting to the
 * **deterministic** baseline so an unconfigured battle is byte-identical to the
 * pre-RNG behaviour). The seam the "range of possibility" soft-randomization rides.
 */
export interface BattleOptions {
  /**
   * Seed for this battle's **label-derived** RNG (`streamFor(seed, label)`). Stays
   * `0` by default; production wires `saltSeed(run.seed, Labels.battle(node.id, night))`
   * (runloop `stageBattle`) so each encounter draws distinct streams while the whole
   * run still reproduces from its run seed.
   */
  seed?: string | number;
  /**
   * **Damage-variance amplitude** (±fraction of final damage): `0` (default) is the
   * deterministic floor (no roll, no draw); `0.2` spreads each hit across ±20%.
   * Resolved only in {@link Battle.apply} (planning sees the mean).
   */
  variance?: number;
  /**
   * Skill-id resolver for the logged skill-by-id actions (R1 #111) —
   * {@link "./jobs".getSkill} (the global `SKILLS` registry) by default. Injectable
   * (the D65 pattern) so a test/replay can resolve **fixture skills** that were
   * never registered; production always uses the default.
   */
  skills?: SkillLookup;
  /**
   * Interactable **gates** (D103) — locked tiles that enclose/seal. The Battle blocks each locked
   * gate's tile on construction and opens matching cells automatically when a keyholder is defeated;
   * a Thief opens the rest via the `openGate` Act. Empty/absent ⇒ no gate wiring (zero cost).
   */
  gates?: Gate[];
  /** Interactable **levers** (D103) — pull-switches that toggle their target gates (the control-room seal). */
  levers?: Lever[];
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
  /** The encounter's interactable gates (D103) — locked tiles opened by lockpick / keyholder / breaking. */
  readonly gates: Gate[];
  /** The encounter's levers (D103) — pull-switches toggling their target gates (the control-room seal). */
  readonly levers: Lever[];

  /**
   * Which board phase this battle is in (D67): `"deploy"` (pre-combat staging — the
   * closing-net layer) or `"combat"`. Defaults to `combat`, so a bare staged battle (the
   * headless sim / a test driving combat directly) behaves exactly as before. The scene
   * calls {@link enterDeploy} for staging, and the logged `beginBattle` action flips it
   * back to `combat`. Maps to the `pre-combat`/`combat` skill `usableContext` axis, so the
   * one interpreter can commit (and later gate) a verb per the phase it's actually in.
   */
  phase: "deploy" | "combat" = "combat";

  /**
   * The **action log** (D4 event-sourcing of commands) — the combat analog of the
   * purse journal. {@link apply} appends each executed {@link CombatAction} here in
   * order; it is the substrate {@link replay} (and later undo / netcode / a sim
   * trace) reads. Combat state is a graph, not a conserved scalar, so it
   * reconstructs by **replay**, not by summing (`replay(log) === state`).
   */
  private readonly _log: CombatAction[] = [];

  /**
   * The **event log** (D117) — a *derived*, tick-stamped record of what **happened**
   * (damage dealt, turn ends), fed from the bus, read by `in-combat` ({@link tagContext})
   * and (later) the combat-log display. Reconstructed by replay (its events fire only in
   * `apply`), truncated by undo — see {@link "./combat-log"}. IDs, not `Unit` refs.
   */
  private readonly _eventLog: CombatLogEntry[] = [];

  /**
   * Resolves a logged skill id to its def (R1 #111) — the injectable half of the
   * skill-by-id log ({@link "./jobs".getSkill} by default, the D65 pattern).
   */
  private readonly skillLookup: SkillLookup;

  /**
   * Skill defs handed to the public wrappers ({@link useSkill}/{@link cleave}/
   * {@link useHeal}) or an {@link AIPlan}, keyed by id — so a **live** battle always
   * resolves what it executed, including ad-hoc fixture skills that were never
   * registered. A replay reconstructs a fresh Battle and never sees these; it
   * resolves via the (injectable) {@link skillLookup}.
   */
  private readonly knownSkills = new Map<string, SkillDef>();

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
    // Feed the derived event log (D117) from the bus. Both events fire only inside `apply`,
    // so a replay re-emits them in order (the log reconstructs) and undo truncates it.
    this.bus.on("unitDamaged", ({ unit, amount, source }) =>
      this._eventLog.push({ kind: "damage", time: this.clock.time, targetId: unit.id, sourceId: source?.id, amount }),
    );
    this.bus.on("turnEnd", ({ unit }) =>
      this._eventLog.push({ kind: "turnEnd", time: this.clock.time, unitId: unit.id }),
    );
    this.rngSeed = opts.seed ?? 0;
    this.variance = opts.variance ?? 0;
    this.skillLookup = opts.skills ?? getSkill;
    // Gates (D103): block each locked gate's tile so it encloses/seals from turn one, and open any
    // keyholder-gated cells the instant their keyholder is defeated (the Captain drops the keys).
    this.gates = opts.gates ?? [];
    this.levers = opts.levers ?? [];
    applyGatesToGrid(this.grid, this.gates);
    if (this.gates.length) this.bus.on("unitDefeated", ({ unit }) => this.openKeyholderGates(unit));
    // Stamp job passives + arm the tarpit aura from the starting formation (D40).
    for (const u of units) {
      stampPassives(u);
      // D73: a unit entering battle **Exhausted** fields a tempo debuff — Slowed for the encounter
      // (a CT cap to ~70% of base, never a power debuff). Fatigue is player-overworld state, so an
      // enemy (fatigue 0) is never exhausted; combat *reads* the meter here, never writes it.
      if (isExhausted(u.fatigue)) applyStatus(u, slowed(FATIGUE.slowDuration, exhaustionSlowSpeed(u.speed)));
    }
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
    return streamFor(this.rngSeed, Labels.battleDraw(label, this.drawCount++));
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
    return this.roll(Labels.dmg(attacker.id, defender.id)).float(1 - this.variance, 1 + this.variance);
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

  /** The derived event log in order (read-only) — the combat-log display + `in-combat` read this. */
  get eventLog(): readonly CombatLogEntry[] {
    return this._eventLog;
  }

  /**
   * A {@link "./tags".TagContext} over this live battle — feeds the *derived* tags
   * (`in-combat`) their battle state + the log-history query. `exchangedDamageSince` is
   * **first-arg-anchored**: the window is the *first* unit's last `turnEnd`.
   */
  tagContext(): TagContext {
    return {
      units: this.units,
      exchangedDamageSince: (aId, bId) => exchangedDamageSince(this._eventLog, aId, bId),
    };
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

  /**
   * Resolve a logged **skill id** to its def (R1 #111): wrapper-remembered defs
   * first (the exact object a live call handed in), then the injectable lookup
   * (the global registry by default). A miss **throws** — a log that names a skill
   * nobody can resolve must fail loudly, not silently skip.
   */
  private skillDef(id: string): SkillDef {
    const def = this.knownSkills.get(id) ?? this.skillLookup(id);
    if (!def) throw new Error(`Battle.apply: unknown skill "${id}" — not in SKILLS and no lookup provided`);
    return def;
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
    return captureCheckpoint(this.units, this._log.length, this._eventLog.length, this.drawCount, this.clock, this.entities, this.stash, this.gates);
  }

  /**
   * Spend a skill's declared **material price** from the wired stash (#113) — the commit-half
   * consumption for Set Trap (a fixed `trap-kit`) and the Medic's Heal (the `chosenId` herb).
   * A no-op with no price / no stash / no resolvable id. Runs inside {@link apply} (after the
   * pre-action checkpoint), so undo refunds it via the checkpoint's stash snapshot.
   */
  private consumeMaterial(price: MaterialCost | undefined, chosenId?: string): void {
    if (!price || !this.stash) return;
    const id = price.id ?? chosenId;
    if (id !== undefined) removeItem(this.stash, id, price.count);
  }

  /** Roll all mutable state (and the log) back to a checkpoint — the undo primitive. */
  private restoreCheckpoint(cp: BattleCheckpoint): void {
    this.drawCount = cp.drawCount;
    this._log.length = cp.logLen; // drop the actions taken since the checkpoint
    this._eventLog.length = cp.eventLogLen; // drop the events recorded since the checkpoint
    // The unit / clock / entity / stash restore + tarpit-aura re-derive live in the
    // battle-undo primitive (over explicit inputs).
    restoreCheckpoint(cp, this.units, this.clock, this.entities, this.stash, this.grid, this.gates);
  }

  /**
   * **The single execution path** for a battle action (Phase 1 of the
   * combat-actions design): validate → mutate → emit → **append to the log**. Player
   * input and {@link AIPlan} both lower to {@link CombatAction}s and flow through
   * here, so the two paths can't drift. Returns a {@link BattleActionResult} carrying the
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
  apply(action: CombatAction): BattleActionResult {
    const checkpoint = this.undoStack ? this.captureCheckpoint() : null;
    const result = this.dispatch(action);
    if (checkpoint && result.ok) this.undoStack!.push(checkpoint);
    return result;
  }

  /** Validate → mutate → emit → log a single action (the interpreter core). */
  private dispatch(action: CombatAction): BattleActionResult {
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
        // A standing-order transition on a MELEE blow landing (D84): the skittish
        // guard breaks into flight. Adjacency read at resolution; inside the apply
        // path, so replay re-derives the order swap identically.
        if (target.alive && manhattan(attacker.pos, target.pos) <= 1) {
          const next = orderOf(target)?.onMeleeStruck;
          if (next) {
            target.standingOrder = next;
            this.bus.emit("orderChanged", { unit: target, order: next });
          }
        }
        this._log.push(action);
        return { ok: true, damage };
      }
      case "skill": {
        const caster = this.unit(action.unit);
        const target = this.unit(action.target);
        const skill = this.skillDef(action.skill);
        if (!this.canUseSkill(caster, skill)) return { ok: false, reason: "cooling down" };
        // Engagement is **board state, not a per-phase skill ban** (D67 W7): a skill aimed at a
        // concealed unit has no engageable target, so it's refused. That *is* the stealth/alarm
        // invariant now — an attack cast in staging finds no one to hit (the foe is concealed
        // until the battle opens) — and it's the only target gate the verb needs. A scenario
        // that stages targetable pre-combat foes (a keep assault) leaves them un-concealed, and
        // the same attack just works. Self/ally targets are never concealed, so support is
        // unaffected. Replaces the old `usableContext` phase refusal.
        if (target.concealed) return { ok: false, reason: `${skill.name}: no engageable target` };
        const deploy = this.phase === "deploy";
        // The **one** skill verb across both phases (D67): the effect resolves identically,
        // and the *commit* is now almost identical too (D67 W5). Both phases **arm the
        // skill's cooldown** — an ability used in staging is genuinely used, cooling toward
        // combat. Only the **turn** is phase-aware: in **combat** the cast ends the caster's
        // turn per its spend (D60), scheduling a charge on the timeline if any (D5/D37); in
        // **pre-combat** the deploy clock owns the turn, so the cast doesn't spend CT / end
        // the turn here (the scene commits that at End Turn). A charged ability is combat-only
        // anyway (usableContext), so the charge branch never runs pre-combat.
        let outcome: SkillOutcome;
        if (skill.effect.kind === "forced-move") {
          outcome = this.resolveShove(caster, target, skill.effect.tiles, skill.effect.bonusAttack ?? 0);
        } else if (skill.effect.kind === "guard-allies") {
          outcome = this.resolveGuardAllies(caster, skill.effect.amount, skill.effect.duration ?? 1);
        } else if (!deploy && skill.cost?.charge) {
          // Commit to the timeline; the effect lands when its gauge fills (D5/D37). A **tile-mode**
          // charge (#149) captures the target's tile now and whiffs if the target leaves it (the
          // clock arms the target-moved fizzle from `target`+`targetTile`); the default **unit** mode
          // homes on the target wherever it moved (the friendly Mend). No shipped skill sets tile
          // mode today, so the captured-tile branch is dormant until content authors a hostile charge.
          const tileMode = skill.targetMode === "tile";
          this.clock.schedule({
            id: `charge:${caster.id}:${skill.id}:${this.clock.time}`,
            speed: skill.cost.charge,
            caster,
            ...(tileMode ? { target, targetTile: { col: target.pos.col, row: target.pos.row } } : {}),
            run: () => {
              if (target.alive) resolveSkill(skill, caster, target, this.bus, this.units);
            },
          });
          outcome = { charging: true };
        } else {
          outcome = resolveSkill(skill, caster, target, this.bus, this.units);
        }
        // Arm the cooldown in both phases; end the turn only in combat (deploy commits its
        // turn via the scene's End Turn). `!deploy && …` keeps the combat path byte-identical.
        this.commitSkill(caster, skill, !deploy && (action.commitTurn ?? true));
        this._log.push(action);
        return { ok: true, outcome };
      }
      case "cleave": {
        const caster = this.unit(action.unit);
        const skill = this.skillDef(action.skill);
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
        // Consume the declared material price in the commit half (#113): the kit spend rides the
        // apply path (after placement succeeded), so undo/replay ride the checkpoint's stash snapshot.
        this.consumeMaterial(action.material);
        this._log.push(action);
        return { ok: true, trap: res.trap, levels: res.levels };
      }
      case "capture": {
        captureUnit(this.unit(action.unit));
        this._log.push(action);
        return { ok: true };
      }
      case "escape": {
        // A fleeing unit on a map edge leaves the field (D84): gone, not dead — no
        // defeat event, no kill credit. isActive now excludes it, so the win check,
        // the clock, and every foe list read the vacancy at once.
        const runner = this.unit(action.unit);
        runner.escaped = true;
        this.bus.emit("unitEscaped", { unit: runner });
        this._log.push(action);
        return { ok: true };
      }
      case "rescue": {
        // The in-combat rescue Act (D52) — semantics unchanged (D9/D21): free the
        // captive and announce it. Logged (R1 #111) because freeing changes the
        // state graph (isActive, clock membership, the win check) — replay must
        // reconstruct it, and undo must be able to cross it.
        const captive = this.unit(action.target);
        const by = action.unit ? this.unit(action.unit) : undefined;
        // The captive's release gate (D52/D69): a lockpick-bound (cuffed) captive refuses a
        // rescuer without the Expert Lockpick capability — a no-op that mutates nothing and
        // isn't logged (mirrors a refused useHeal), so replay/undo never see a rejected free.
        if (!canRelease(captive, by)) return { ok: false, reason: "This captive needs a lockpick to free." };
        freeCaptive(captive);
        this.bus.emit("unitRescued", { unit: captive, by });
        this._log.push(action);
        return { ok: true };
      }
      case "openGate": {
        // The lockpick interact Act (D103): an adjacent Expert-Lockpick unit springs the gate,
        // clearing its tile's block. A refused open (not adjacent/capable, or no lockpick condition)
        // mutates nothing and isn't logged (mirrors a refused rescue), so replay/undo never see it.
        const gate = this.gates.find((g) => g.id === action.gate);
        if (!gate) return { ok: false, reason: "No such gate." };
        const opener = this.unit(action.unit);
        if (!canLockpickGate(gate, opener)) return { ok: false, reason: "Only an adjacent lockpick can open this gate." };
        openGateOnGrid(this.grid, gate);
        this.bus.emit("gateOpened", { gate, by: opener, cause: "lockpick" });
        this._log.push(action);
        return { ok: true };
      }
      case "keyGate": {
        // The living-keyholder Act (D108): the Warden turns his key on an adjacent locked gate he holds,
        // clearing the tile's block — the active counterpart to the death-trigger (openKeyholderGates).
        // Refused (no-op, unlogged) when not the keyholder / not adjacent / already open — mirrors openGate.
        const gate = this.gates.find((g) => g.id === action.gate);
        if (!gate) return { ok: false, reason: "No such gate." };
        const opener = this.unit(action.unit);
        if (!canKeyGate(gate, opener)) return { ok: false, reason: "Only the adjacent keyholder can key this gate." };
        openGateOnGrid(this.grid, gate);
        this.bus.emit("gateOpened", { gate, by: opener, cause: "keyholder" });
        this._log.push(action);
        return { ok: true };
      }
      case "attackGate": {
        // Break-Gate Act (D103): chip the door's durability by the attacker's attack; it breaks open at
        // 0. Refused (unlogged) when out of range / the gate isn't breakable — mutates nothing.
        const gate = this.gates.find((g) => g.id === action.gate);
        if (!gate) return { ok: false, reason: "No such gate." };
        const striker = this.unit(action.unit);
        if (!canAttackGate(gate, striker)) return { ok: false, reason: "Out of range, or this gate can't be broken." };
        const amount = striker.attack;
        const broke = damageGate(gate, amount);
        this.bus.emit("gateDamaged", { gate, by: striker, amount });
        if (broke) {
          // Destroyed, not merely opened (D106): the door is smashed to a permanent passable remnant —
          // the lever can never re-seal it, so the guards' battering is a one-way breach.
          destroyGateOnGrid(this.grid, gate);
          this.bus.emit("gateOpened", { gate, by: striker, cause: "destroyed" });
        }
        this._log.push(action);
        return { ok: true };
      }
      case "pullLever": {
        // The control-room seal (D103): toggle each target gate — an open door slams shut (unless a
        // living body stands on it — never seal someone into a wall), a locked one reopens. A refused
        // pull (out of reach) mutates nothing and isn't logged.
        const lever = this.levers.find((l) => l.id === action.lever);
        if (!lever) return { ok: false, reason: "No such lever." };
        const puller = this.unit(action.unit);
        if (!canPullLever(lever, puller)) return { ok: false, reason: "Move next to the lever to pull it." };
        for (const gid of lever.targets) {
          const gate = this.gates.find((g) => g.id === gid);
          if (!gate) continue;
          if (gate.broken) continue; // a smashed door is a permanent breach — the lever can't toggle rubble (D106)
          if (gate.locked) {
            openGateOnGrid(this.grid, gate);
            this.bus.emit("gateOpened", { gate, by: puller, cause: "lever" });
          } else if (!this.units.some((u) => u.alive && !u.captured && u.pos.col === gate.pos.col && u.pos.row === gate.pos.row)) {
            lockGateOnGrid(this.grid, gate);
            this.bus.emit("gateLocked", { gate, by: puller });
          }
        }
        this._log.push(action);
        return { ok: true };
      }
      case "sway": {
        // The Noble's BRIBE (D30/D62): a swayed enemy turns coat — flip its side to the
        // player and announce it (the token re-tints on the bus, like unitRescued). Logged
        // (mirrors rescue) so the defection replays and undo restores the side (snapshotted).
        const swayed = this.unit(action.target);
        swayed.side = "player";
        this.bus.emit("unitSwayed", { unit: swayed, by: action.unit ? this.unit(action.unit) : undefined });
        this._log.push(action);
        return { ok: true };
      }
      case "useHeal": {
        // The Medic's herb heal (D40) — logged (R1 #111): the herb spend comes from
        // the battle's wired stash (the same shared inventory production wires via
        // setStash), so replay reproduces the consumption and undo refunds it (the
        // checkpoint's stash snapshot). A refusal (cooling down / no stash / herb
        // not carried) mutates nothing and is not logged — exactly the old no-op.
        const caster = this.unit(action.unit);
        const target = this.unit(action.target);
        const skill = this.skillDef(action.skill);
        if (!this.canUseSkill(caster, skill)) return { ok: false, reason: "cooling down" };
        if (!this.stash) return { ok: false, reason: "No herb stash wired for the heal." };
        const outcome = resolveMedHeal(caster, target, action.herbId, this.stash, this.bus);
        if (outcome.healed === undefined) return { ok: false, reason: `${action.herbId} isn't carried` };
        // Consume the declared material price in the commit half (#113): the herb chosen at cast
        // time (`herbId`), the count from the skill's declared price. The resolver no longer spends
        // it, so undo/replay ride the checkpoint's stash snapshot (the D87 golden pin proves it).
        this.consumeMaterial(skill.cost?.material, action.herbId);
        // Same turn economy as before the move into apply: arm the cooldown, and end
        // the turn per `commitTurn` (default true; `false` is the D60 free-move flow).
        this.commitSkill(caster, skill, action.commitTurn ?? true);
        this._log.push(action);
        return { ok: true, outcome };
      }
      case "beginBattle": {
        // The pre-combat → combat boundary (D67): flip the phase, shed the deploy clock
        // configuration (detach the front, re-widen participation, clear the staging
        // timeline — see resetForCombat), and announce it. The clock now *is* the one the
        // deploy net ran on (D67 W2); reset is a no-op when replay never staged on it, so
        // the combat path stays byte-identical. The logged marker is what replay() drains
        // the deploy prelude up to.
        this.phase = "combat";
        this.clock.resetForCombat();
        // The encounter engages: lift the pre-combat veil so the foe is now a valid target
        // (D67 W6). A D44 ambush body keeps its own `hidden` flag — that persists into combat
        // until scouted/sprung — so this only clears the deployment-wide concealment.
        for (const u of this.units) u.concealed = false;
        this.bus.emit("battleBegan", {});
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

  /**
   * Free a bound unit via the in-combat **rescue Act** (D52) — a captured ally, or a new
   * on-board **captive recruit** (the L1 Cook) joining the fight. Lowers to the logged
   * `rescue` action (R1 #111) through {@link apply}: freeing a captive changes the state
   * graph (`isActive`, clock membership, the win check), so replay must reconstruct it
   * and undo must be able to cross it. The bus announcement (`unitRescued`) and the D9/D21
   * semantics are unchanged; the post-win auto-free is a separate resolution tally, not this.
   */
  rescue(captive: Unit, by?: Unit): void {
    this.apply({ kind: "rescue", target: captive.id, unit: by?.id });
  }

  /**
   * **Open a gate** by lockpicking (D103) — the interact Act. `by` (an adjacent Expert-Lockpick
   * unit) springs `gate`, clearing its tile's block. Lowers to the logged `openGate` action so the
   * open rides the state graph (replay reconstructs it, undo crosses it — the gate is checkpointed)
   * and announces `gateOpened`. A refused open (not adjacent/capable) is a no-op that mutates nothing.
   */
  openGate(gate: Gate, by: Unit): void {
    this.apply({ kind: "openGate", gate: gate.id, unit: by.id });
  }

  /**
   * **Attack a destructible gate** (D103) — the door-breaking Act. `by` chips `gate`'s durability by
   * its attack; the gate breaks open at 0. Lowers to the logged `attackGate` action so the chip + break
   * ride the state graph (replay reconstructs, undo crosses — the gate's hp/locked are checkpointed) and
   * announce `gateDamaged` / `gateOpened`. A refused hit (out of range / not breakable) mutates nothing.
   */
  attackGate(gate: Gate, by: Unit): void {
    this.apply({ kind: "attackGate", gate: gate.id, unit: by.id });
  }

  /**
   * **Turn a key** (D108) — the living-keyholder Act. `by` (the adjacent keyholder) opens the locked
   * `gate` as a fast Act. Lowers to the logged `keyGate` action so the open rides the state graph
   * (replay reconstructs, undo re-locks — the gate is checkpointed) and announces `gateOpened` (cause
   * `keyholder`). A refused turn (not the keyholder / not adjacent / already open) mutates nothing.
   */
  keyGate(gate: Gate, by: Unit): void {
    this.apply({ kind: "keyGate", gate: gate.id, unit: by.id });
  }

  /**
   * **Pull a lever** (D103) — the control-room seal. `by` (adjacent) toggles the locked state of the
   * lever's target gates: an open door slams shut (sealing the guards out), a locked one reopens.
   * Lowers to the logged `pullLever` action so the toggle rides the state graph (replay reconstructs,
   * undo crosses — the gates are checkpointed). A refused pull (out of reach) mutates nothing.
   */
  pullLever(lever: Lever, by: Unit): void {
    this.apply({ kind: "pullLever", lever: lever.id, unit: by.id });
  }

  /**
   * Open every locked keyholder cell the just-defeated `dead` unit was holding the keys to (D103) —
   * wired to `unitDefeated` in the constructor, so a kill that fells the Captain pops the cells as a
   * side effect of the killing action (replay re-fires it; undo re-locks via the checkpoint).
   */
  private openKeyholderGates(dead: Unit): void {
    for (const g of gatesOpenedByDeath(this.gates, dead)) {
      openGateOnGrid(this.grid, g);
      this.bus.emit("gateOpened", { gate: g, cause: "keyholder" });
    }
  }

  /**
   * **Sway** an enemy to the player's side (D30/D62 bribe) — the on-board half of the
   * Noble's bribe, after {@link "./economy-actions".bribeEnemy} has spent the Influence and
   * won the roll. Lowers to the logged `sway` action through {@link apply}: the side flip
   * rides the state graph (replay reconstructs it, undo crosses it) and announces `unitSwayed`
   * so the render re-tints the token — replacing the old render-side `side` type-cast. `by` is
   * the briber, named on the bus event.
   */
  bribe(enemy: Unit, by?: Unit): void {
    this.apply({ kind: "sway", target: enemy.id, unit: by?.id });
  }

  /** True if `caster` may use `skill` right now (not cooling down, D37). */
  canUseSkill(caster: Unit, skill: SkillDef): boolean {
    return !onSkillCooldown(caster, skill.id);
  }

  /**
   * The shared **commit half** of a skill use: arm its cooldown (if any) and —
   * unless the turn is kept open (`commitTurn: false`: the D60 free-move flow, **or**
   * a pre-combat cast, whose turn the deploy clock commits at End Turn) — end the
   * caster's turn, spending CT per the skill's `spend`. Used by `useSkill`, `useHeal`,
   * and `cleave` so the cooldown-arm + turn-end pair lives in one place (D67 W5: both
   * phases arm the cooldown; only combat ends the turn here).
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
    this.knownSkills.set(skill.id, skill); // the action logs the id (R1 #111); remember the def
    const r = this.apply({ kind: "skill", unit: caster.id, skill: skill.id, target: target.id, commitTurn: opts.commitTurn ?? true });
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
    return resolveShoveEffect(
      caster,
      target,
      tiles,
      bonusAttack,
      this.grid,
      this.units,
      this.bus,
      (u, path, forced) => this.moveUnit(u, path, forced),
    );
  }

  /**
   * The Soldier's **Turtle Formation** (D66): brace the line — apply Guarded to
   * every ally orthogonally adjacent to the caster (an "AoE Defend"; per-ally,
   * lasting to that ally's next turn, like Defend). Needs the roster, so it resolves
   * here rather than via the unit-pair {@link resolveSkill}. Returns the Guarded id
   * when it braced anyone.
   */
  resolveGuardAllies(caster: Unit, amount: number, duration: number): SkillOutcome {
    return resolveGuardAlliesEffect(caster, amount, duration, this.units);
  }

  /**
   * The Heavy Knight's **Cleave** (D40 directional AoE): hit every foe in the
   * three-tile 90° arc facing `dir` (the orthogonal tile + its two flanking
   * diagonals). `dir` is a unit step vector. Flanking applies per hit. Ends the
   * caster's turn. Returns the foes hit + total damage.
   */
  cleave(caster: Unit, skill: SkillDef, dir: GridCoord): { hits: number; damage: number } {
    this.knownSkills.set(skill.id, skill); // the action logs the id (R1 #111); remember the def
    const r = this.apply({ kind: "cleave", unit: caster.id, skill: skill.id, dir });
    return r.ok ? { hits: r.hits ?? 0, damage: r.damage ?? 0 } : { hits: 0, damage: 0 };
  }

  /** The raw arc resolution (the cleave-action body) — hit every foe in the 90° arc. */
  private execCleave(caster: Unit, skill: SkillDef, dir: GridCoord): { hits: number; damage: number } {
    return execCleaveEffect(caster, skill, dir, this.units, this.bus, (a, d) => this.damageScale(a, d));
  }

  /**
   * The Medic's **Heal** (D40 combat↔logistics bridge): consume `herbId` from
   * the shared stash and heal `target` with the herb's rider (salve/stimulant/
   * antidote). Arms the Heal cooldown and ends the turn. A no-op (no turn spent)
   * if cooling down or the herb isn't carried. `commitTurn: false` leaves the turn
   * open for the D60 free-move flow (the render layer ends it).
   *
   * Lowers to the logged `useHeal` action (R1 #111) through {@link apply}, so the
   * herb spend + heal replay and undo refunds the herb. `inv` **is** the battle's
   * herb stash — production passes the same run inventory it already wired via
   * {@link setStash}; a bare test battle gets wired here so the logged action has
   * battle-owned state to draw from.
   */
  useHeal(caster: Unit, skill: SkillDef, target: Unit, herbId: string, inv: Inventory, opts: { commitTurn?: boolean } = {}): SkillOutcome {
    this.setStash(inv);
    this.knownSkills.set(skill.id, skill); // the action logs the id (R1 #111); remember the def
    const r = this.apply({ kind: "useHeal", unit: caster.id, skill: skill.id, target: target.id, herbId, commitTurn: opts.commitTurn ?? true });
    return r.ok ? r.outcome ?? {} : {};
  }

  /** End a unit's turn: fire `turnEnd` and spend its CT (act costs more). */
  endTurn(unit: Unit, spend: TurnSpend): void {
    this.apply({ kind: "endTurn", unit: unit.id, spend });
  }

  // --- Phase (D67 unification) ----------------------------------------------

  /**
   * Enter the **pre-combat** (deployment) phase — the staging layer. While this holds, a
   * skill/move verb resolves its effect without committing a combat turn (the deploy clock
   * owns the turn). Set live by the scene; {@link replay} re-enters it when it detects a
   * deploy prelude. Not logged — the `beginBattle` boundary is what the log records.
   */
  enterDeploy(): void {
    this.phase = "deploy";
    // Conceal the enemy roster: pre-positioned, but not yet **engageable** (D67 W6). With no
    // valid enemy target, a combat action cast in staging finds no one to hit and sits idle —
    // the engagement invariant emerges from the board state, not a per-skill ban. A scenario
    // wanting targetable pre-combat foes (a keep assault) simply leaves them un-concealed.
    for (const u of this.units) if (u.side === "enemy") u.concealed = true;
  }

  /**
   * Cross the **pre-combat → combat boundary** (D67): log the transition (so replay can
   * delimit the deploy prelude), flip to the combat phase, and announce it (`battleBegan`,
   * which the render reacts to — lift the veil, retire the staging overlays).
   */
  beginBattle(): void {
    this.apply({ kind: "beginBattle" });
  }

  // --- Deployment-only verbs (D63/D67) --------------------------------------
  //
  // Repositioning and skill-casting in pre-combat now use the **same** `moveUnit` /
  // `useSkill` verbs as combat — the interpreter detects {@link phase} and skips the
  // combat turn-commit (see the `skill` case). Only the genuinely deploy-only verbs
  // below (no combat equivalent) remain distinct.

  /** Hunker for a reduced capture chance when the net's turn comes (D63). */
  digIn(unit: Unit): void {
    this.apply({ kind: "digIn", unit: unit.id });
  }

  /**
   * Lay a player trap on `pos`, consuming one kit from the wired stash (D11/D63).
   * On success returns the registered entity + any character levels gained; on a
   * refusal (no kit, tile taken, or no stash wired) returns the reason for the hint.
   * `material` is the declared kit price (#113) — consumed in the commit half of {@link apply}.
   */
  placeTrap(unit: Unit, pos: GridCoord, effect: PlaceTrapEffect, id: string, material?: MaterialCost): { ok: true; trap?: RecoverableEntity; levels: number } | { ok: false; reason: string } {
    const r = this.apply({ kind: "placeTrap", unit: unit.id, pos, effect, id, material });
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
   * turn. Returns the plan for the render layer to animate. Renamed from the
   * historical `runEnemyTurn` (#128): the same path drives **either** side headlessly
   * (the sim passes a policy per side), so it's a policy turn, not an enemy one.
   */
  runPolicyTurn(unit: Unit, policy: BattlePolicy = PILOT_POLICY): AIPlan {
    // Turn-open standing-order transition (D84): the wary guard, provoked by a foe
    // pressing its POST, commits to its next order — sticky (no bait-and-retreat
    // reset). Shapes only future plans (logged as concrete actions), so replay
    // needs no record of it.
    const wary = orderOf(unit)?.onFoeWithin;
    if (wary) {
      const post = unit.post ?? unit.pos;
      if (activeUnits(this.units, opposite(unit.side)).some((f) => manhattan(f.pos, post) <= wary.range)) {
        unit.standingOrder = wary.next;
        this.bus.emit("orderChanged", { unit, order: wary.next });
      }
    }
    const plan = policy.plan(unit, this.units, this.grid, {
      isCharging: (u) => this.clock.isCharging(u),
      gates: this.gates, // D103: a guard walled off by a locked destructible door batters it down
    });
    // Lower the plan to a CombatAction[] and run each through the one interpreter —
    // the AI path now shares the exact execution route with player input (D42/D56).
    if (plan.ability) this.knownSkills.set(plan.ability.id, plan.ability); // the lowered action logs the id (R1 #111)
    const actions = planActions(plan);
    // A fleeing unit that ends its move on a map edge LEAVES (D84) — the logged
    // escape slots before the turn-committing endTurn so replay's per-turn window
    // holds. The next active check reads the vacancy (a lone survivor's exit wins
    // the fight for the player).
    if (orderOf(unit)?.posture === "flee" && edgeDistance(this.grid, plan.destination) === 0) {
      actions.splice(actions.length - 1, 0, { kind: "escape", unit: unit.id });
    }
    for (const action of actions) this.apply(action);
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
