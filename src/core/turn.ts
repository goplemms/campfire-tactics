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

import type { Unit, Side } from "./units";
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
  type BattleOutcome,
} from "./combat";
import { tickStatuses } from "./status";
import { computeVisibleTiles } from "./vision";
import { PILOT_POLICY, type AIPlan, type BattlePolicy } from "./ai";
import { stampPassives } from "./jobs";
import {
  resolveSkill,
  resolveMedHeal,
  type SkillDef,
  type SkillOutcome,
} from "./skills";
import {
  commitsTurn,
  type CombatAction,
  type ActionResult,
  type UnitId,
} from "./combat-actions";

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

  constructor(grid: TileGrid, units: Unit[]) {
    this.grid = grid;
    this.units = units;
    this.bus = new EventBus();
    this.clock = new CTClock(units, this.bus);
    this.entities = new EntityRegistry(this.bus);
    // Stamp job passives + arm the tarpit aura from the starting formation (D40).
    for (const u of units) stampPassives(u);
    refreshAuras(units);
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

  /** Resolve a {@link UnitId} to its live unit in this battle's roster. */
  private unit(id: UnitId): Unit {
    const u = this.units.find((x) => x.id === id);
    if (!u) throw new Error(`Battle.apply: no unit with id "${id}"`);
    return u;
  }

  /**
   * **The single execution path** for a battle action (Phase 1 of the
   * combat-actions design): validate → mutate → emit → **append to the log**. Player
   * input and {@link AIPlan} both lower to {@link CombatAction}s and flow through
   * here, so the two paths can't drift. Returns an {@link ActionResult} carrying the
   * verb's natural outcome (so the public wrappers keep their original return
   * shapes); a **refused** action (e.g. a skill on cooldown) is *not* logged.
   *
   * Adding a battle action = a new {@link CombatAction} variant + a case here.
   */
  apply(action: CombatAction): ActionResult {
    switch (action.kind) {
      case "move": {
        this.execMove(this.unit(action.unit), action.path, false);
        this._log.push(action);
        return { ok: true };
      }
      case "attack": {
        const attacker = this.unit(action.unit);
        const target = this.unit(action.target);
        const damage = resolveAttack(attacker, target, this.bus, attacker.attack, this.units);
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
    const dc = Math.sign(target.pos.col - caster.pos.col);
    const dr = Math.sign(target.pos.row - caster.pos.row);
    let moved = 0;
    for (let i = 0; i < tiles; i++) {
      const next = { col: target.pos.col + dc, row: target.pos.row + dr };
      if (!this.grid.isWalkable(next)) break; // wall / off-map blocker
      if (this.units.some((u) => u.alive && u !== target && u.pos.col === next.col && u.pos.row === next.row)) {
        break; // another body blocks the push
      }
      this.moveUnit(target, [next], true);
      moved += 1;
    }
    const out: SkillOutcome = {};
    if (bonusAttack !== 0 && target.alive) {
      out.damage = resolveAttack(caster, target, this.bus, caster.attack + bonusAttack, this.units);
    }
    void moved;
    return out;
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
    const c = caster.pos;
    const arc: GridCoord[] =
      dir.col !== 0
        ? [{ col: c.col + dir.col, row: c.row }, { col: c.col + dir.col, row: c.row - 1 }, { col: c.col + dir.col, row: c.row + 1 }]
        : [{ col: c.col, row: c.row + dir.row }, { col: c.col - 1, row: c.row + dir.row }, { col: c.col + 1, row: c.row + dir.row }];
    const key = (g: GridCoord) => `${g.col},${g.row}`;
    const arcKeys = new Set(arc.map(key));
    let hits = 0;
    let damage = 0;
    for (const u of this.units) {
      if (u.alive && u.side !== caster.side && arcKeys.has(key(u.pos))) {
        damage += resolveAttack(caster, u, this.bus, caster.attack + bonus, this.units);
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
 * pass throwaway clones of the pre-seed roster.
 */
export function replay(
  grid: TileGrid,
  initialUnits: Unit[],
  log: readonly CombatAction[],
  moraleBonus = 0,
): Battle {
  const battle = new Battle(grid, initialUnits);
  battle.seed(moraleBonus);
  let i = 0;
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
