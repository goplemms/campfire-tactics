/**
 * Unit data (D2 core/render split — plain TS, no Phaser/DOM).
 *
 * A unit is **data**, not a subclass (D4 ethos): a `UnitSpec` is the authored
 * stat block; {@link createUnit} inflates it into a live `Unit` carrying the
 * mutable battle runtime (position, HP, CT, statuses, per-unit counters). New
 * unit kinds are new data, never new classes.
 */

import type { GridCoord } from "./iso";
import type { StatusInstance } from "./status";
import type { JobId } from "./jobs";
import type { EventBus } from "./events";

/** Which side a unit fights for. */
export type Side = "player" | "enemy";

/** Per-job progression (D39): a job level + XP toward the next, per unit. */
export interface JobLevel {
  level: number;
  xp: number;
}

/** The minimal combat stat block (M3). All numbers are tuning values. */
export interface UnitStats {
  /** CT gauge fill per clock tick — governs turn frequency (D5). */
  speed: number;
  /** Maximum hit points. */
  maxHp: number;
  /** Raw attack power (damage before the defender's defense). */
  attack: number;
  /** Damage soak. */
  defense: number;
  /** How many tiles a unit may step in one turn. */
  moveRange: number;
  /** Vision radius for the fog-of-war seam (D18). */
  sightRadius: number;
  /**
   * Attack reach in tiles (Manhattan), D40. Defaults to 1 (melee). A ranged unit
   * (the Hunter, an enemy bowman) sets it higher and attacks without closing;
   * **flanking is melee-only** so a ranged attacker never earns the flank bonus.
   */
  attackRange?: number;
}
/** The authored description of a unit — the data a designer writes. */
export interface UnitSpec extends UnitStats {
  id: string;
  side: Side;
  pos: GridCoord;
  /** Display name; defaults to `id`. */
  name?: string;
  /** Starting HP; defaults to `maxHp`. */
  hp?: number;
  /** Optional job id (see {@link "./jobs"}); grants the unit its skills. */
  jobId?: JobId;
  /**
   * The **primary** job designation (D38); defaults to `jobId`. Sets the baseline
   * frame, XP rate, loadout, and class-gated content. Any job can be primary —
   * the combat/non-combat split is dissolved.
   */
  primaryJob?: JobId;
  /** Jobs this unit **holds** (D38), drawing skills from all; defaults to `[jobId]`. */
  heldJobs?: JobId[];
  /** Per-job levels (D39); defaults to empty (created on first XP grant). */
  jobLevels?: Record<string, JobLevel>;
  /**
   * Secondary loadout slots (D38): the primary's full kit **plus** this many
   * borrowed actives from other held jobs. Defaults to 1 (a tunable boon).
   */
  loadoutSlots?: number;
  /** Deployment safety stat (D7/D11); defaults to 0. Higher = preps deeper safely. */
  awareness?: number;
  /**
   * Intel-gathering stat (D10); defaults to 0. Higher raises the party's passive
   * intel floor (how much it sees before a fight). Distinct from awareness.
   */
  intelligence?: number;
  /**
   * Overworld fatigue (D29/D35); defaults to 0 ("Rested"). Overworld-only — spent
   * by overworld actions, restored by rest, **never** read by combat (D29).
   */
  fatigue?: number;
  /**
   * Character level (D32 leveling seam); defaults to 1. Grows via combat XP and a
   * passive trickle **while deployed** ({@link "./leveling"}); benched = no growth.
   */
  level?: number;
  /** Accumulated experience toward the next level (D32); defaults to 0. */
  xp?: number;
  /**
   * Named campaign **lord** flag (D27 stakes seam); defaults to false. A lord
   * riding a caravan that wipes carries the `lordLost` terminal flag — the
   * game-over/reload path itself is a later pass (not built in M9).
   */
  isLord?: boolean;
  /**
   * **Authored-cast** flag (D33 recruitment seam); defaults to false. The whole
   * new recruitment rule is temp↔permanent: a bribed/rescued **authored** unit
   * (this flag) joins the roster *permanently*, while a bribed **generic**
   * (rolled mercenary / plain enemy) only fights for the rest of the battle. The
   * authored-cast *data shape* (fixed identity + recruit hooks) is deferred (D33).
   */
  authored?: boolean;
  /**
   * **Thief archetype** flag (D30 theft vector); defaults to false. A thief enemy
   * skims the run **purse** mid-battle and tries to flee off-map with it — killed
   * before it escapes drops the loot, escaped keeps it ({@link "./theft"}).
   */
  thief?: boolean;
  /**
   * **Standing order** (D41) — a reserved auto-action (e.g. `"defend"`) a unit
   * carries until the player takes manual control. The first slice ships the
   * field + the Defend action; the auto-execution turn-loop is a later pass.
   */
  standingOrder?: string;
  /**
   * **Objective role** (D50) — a tag an objective binds to (e.g. the closing-gate
   * driver: `"sapper"`). Authored content sets it; objectives address the unit by
   * this tag or its id, so a generator can emit objectives without hand-wiring.
   */
  role?: string;
}

/**
 * A live unit in a battle. Extends its authored stats with the mutable runtime:
 * current `pos`, `hp`, the `ct` gauge, `alive` flag, applied `statuses`, and a
 * generic `counters` bag (the capture-meter shape, D12).
 */
export interface Unit extends UnitStats {
  readonly id: string;
  readonly side: Side;
  readonly name: string;
  /** Attack reach in tiles (D40); always set on a live unit (1 = melee). */
  attackRange: number;
  /** The unit's job, if any — the data that grants its skills. */
  readonly jobId?: JobId;
  /** Primary-job designation (D38); defaults to `jobId`. */
  primaryJob?: JobId;
  /** Jobs this unit holds (D38) — skills are drawn from all of them. */
  heldJobs: JobId[];
  /** Per-job levels (D39); grows via job XP, banking permanent stat gains. */
  jobLevels: Record<string, JobLevel>;
  /** Secondary loadout slots (D38): borrowed actives beyond the primary's kit. */
  loadoutSlots: number;
  /** Current tile. Replaced wholesale on a move (never mutated in place). */
  pos: GridCoord;
  hp: number;
  /** Charge-Time gauge; a unit takes a turn at `ct >= 100` (D5). */
  ct: number;
  alive: boolean;
  /** Deployment safety stat (D7/D11): bigger safe allowance, gentler exposure. */
  awareness: number;
  /** Intel-gathering stat (D10): raises the party's passive intel floor. */
  intelligence: number;
  /**
   * Overworld fatigue (D29/D35): spent by overworld actions, restored by rest.
   * **Overworld-only** — ignored by the CT clock and every combat stat (D29).
   */
  fatigue: number;
  /** Character level (D32): grows deployed, never benched ({@link "./leveling"}). */
  level: number;
  /** Experience toward the next level (D32). */
  xp: number;
  /** Named campaign lord (D27 stakes seam); a wipe carrying one flags `lordLost`. */
  isLord: boolean;
  /** Authored-cast member (D33): a bribed/rescued one joins the roster permanently. */
  authored: boolean;
  /** Thief archetype (D30): skims the purse mid-battle ({@link "./theft"}). */
  thief: boolean;
  /** Reserved standing order (D41), e.g. `"defend"`; undefined = manual control. */
  standingOrder?: string;
  /** Objective role tag (D50), e.g. the closing-gate `"sapper"`; objectives bind to it. */
  role?: string;
  /** Authored ambush body hidden until scouted (D44); a render/fog flag. */
  hidden?: boolean;
  /**
   * Captured (D7): bound on the map, doesn't take turns, excluded from the
   * initiative seed, but still "alive" — a rescuable sub-objective.
   */
  captured: boolean;
  /** Active statuses (D12); ticked on the unit's turn start. */
  statuses: StatusInstance[];
  /** Generic per-unit counters, e.g. a capture meter (D12). */
  counters: Record<string, number>;
  /**
   * Per-skill cooldowns in CT (D37 ability economy): skillId → remaining CT,
   * decremented each clock tick by the unit's effective speed (so "~200 CT" ≈ two
   * of the unit's turns). A skill is on cooldown while its entry is > 0.
   */
  cooldowns: Record<string, number>;
  /**
   * Passive parameters a unit's job grants (D40), stamped at roster setup
   * ({@link "./jobs".stampPassives}) and read by combat resolution — the Scout's
   * solo-flank, the Hunter's Deadeye, the Medic's Triage. Keyed by
   * {@link "./combat".PASSIVE}. Empty for a unit with no passive.
   */
  passives: Record<string, number>;
}

/** Inflate an authored {@link UnitSpec} into a live {@link Unit}. */
export function createUnit(spec: UnitSpec): Unit {
  return {
    id: spec.id,
    side: spec.side,
    name: spec.name ?? spec.id,
    jobId: spec.jobId,
    primaryJob: spec.primaryJob ?? spec.jobId,
    heldJobs: spec.heldJobs ?? (spec.jobId ? [spec.jobId] : []),
    jobLevels: spec.jobLevels ?? {},
    loadoutSlots: spec.loadoutSlots ?? 1,
    pos: { col: spec.pos.col, row: spec.pos.row },
    hp: spec.hp ?? spec.maxHp,
    maxHp: spec.maxHp,
    ct: 0,
    alive: true,
    awareness: spec.awareness ?? 0,
    intelligence: spec.intelligence ?? 0,
    fatigue: spec.fatigue ?? 0,
    level: spec.level ?? 1,
    xp: spec.xp ?? 0,
    isLord: spec.isLord ?? false,
    authored: spec.authored ?? false,
    thief: spec.thief ?? false,
    standingOrder: spec.standingOrder,
    role: spec.role,
    hidden: false,
    captured: false,
    speed: spec.speed,
    attack: spec.attack,
    defense: spec.defense,
    moveRange: spec.moveRange,
    sightRadius: spec.sightRadius,
    attackRange: spec.attackRange ?? 1,
    statuses: [],
    counters: {},
    cooldowns: {},
    passives: {},
  };
}

/**
 * A unit's effective primary job (D38): its explicit `primaryJob`, else its
 * `jobId`. The single accessor for the `primaryJob ?? jobId` idiom that recurred
 * across the leveling, roles, and render layers.
 */
export function primaryJobOf(unit: Pick<Unit, "primaryJob" | "jobId">): JobId | undefined {
  return unit.primaryJob ?? unit.jobId;
}

/**
 * Restore HP to a unit, clamped to its `maxHp` (the symmetric counterpart of
 * {@link "./combat".applyDamage}). The single place healing mutates a unit, so a
 * `unitHealed` event fires from one seam: pass a {@link EventBus} (and optionally
 * the `source` doing the healing) to emit it. Negative `amount`s are ignored.
 * Returns the HP actually restored.
 */
export function healUnit(unit: Unit, amount: number, bus?: EventBus, source?: Unit): number {
  const before = unit.hp;
  unit.hp = Math.min(unit.maxHp, unit.hp + Math.max(0, amount));
  const healed = unit.hp - before;
  if (healed > 0) bus?.emit("unitHealed", { unit, amount: healed, source });
  return healed;
}

/**
 * Wounded units (`hp < maxHp`) ordered **worst-off first** (by HP fraction) — the
 * triage order the rest/heal flows spend their budget down. Pure; does not mutate.
 */
export function woundedBySeverity(units: readonly Unit[]): Unit[] {
  return units
    .filter((u) => u.hp < u.maxHp)
    .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
}
