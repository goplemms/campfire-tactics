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

export class Battle {
  readonly grid: TileGrid;
  readonly units: Unit[];
  readonly bus: EventBus;
  readonly clock: CTClock;
  readonly entities: EntityRegistry;

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
    return resolveAttack(attacker, target, this.bus, attacker.attack, this.units);
  }

  /** True if `caster` may use `skill` right now (not cooling down, D37). */
  canUseSkill(caster: Unit, skill: SkillDef): boolean {
    return !onSkillCooldown(caster, skill.id);
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
    const commitTurn = opts.commitTurn ?? true;
    if (!this.canUseSkill(caster, skill)) return {};
    let outcome: SkillOutcome;
    if (skill.effect.kind === "forced-move") {
      outcome = this.resolveShove(caster, target, skill.effect.tiles, skill.effect.bonusAttack ?? 0);
      if (commitTurn) this.endTurn(caster, { acted: skill.spend === "act", moved: skill.spend === "move" });
      return outcome;
    }
    if (skill.cost?.charge) {
      // Commit to the timeline; the effect lands when its gauge fills.
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
    if (skill.cost?.cooldown) armSkillCooldown(caster, skill.id, skill.cost.cooldown);
    if (commitTurn) this.endTurn(caster, { acted: skill.spend === "act", moved: skill.spend === "move" });
    return outcome;
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
    if (!this.canUseSkill(caster, skill)) return { hits: 0, damage: 0 };
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
    this.endTurn(caster, { acted: true });
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
    if (skill.cost?.cooldown) armSkillCooldown(caster, skill.id, skill.cost.cooldown);
    if ((opts.commitTurn ?? true)) this.endTurn(caster, { acted: skill.spend === "act", moved: skill.spend === "move" });
    return out;
  }

  /** End a unit's turn: fire `turnEnd` and spend its CT (act costs more). */
  endTurn(unit: Unit, spend: TurnSpend): void {
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
    if (plan.path.length > 0) this.moveUnit(unit, plan.path);
    if (plan.ability && plan.target?.alive) {
      // A debuff ability (the snare) — useSkill ends the turn itself.
      this.useSkill(unit, plan.ability, plan.target);
      return plan;
    }
    if (plan.target && plan.target.alive) this.attack(unit, plan.target);
    this.endTurn(unit, {
      moved: plan.path.length > 0,
      acted: plan.target !== null,
    });
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
