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
import type { EventBus } from "./event-bus";

/** Which side a unit fights for. */
export type Side = "player" | "enemy";

/** The opposing side — the single home for the `=== "player" ? "enemy" : "player"` idiom. */
export function opposite(side: Side): Side {
  return side === "player" ? "enemy" : "player";
}

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

/**
 * The per-unit equipment slots (D76): a small fixed loadout of **discrete worn
 * gear**, distinct from the party-wide shared stash (D14). One id per slot; an
 * empty slot is `undefined`. Equipped gear is **caravan-locked to the unit** (D25
 * "can't field one good sword twice"), so it lives here rather than in the stash.
 */
export type EquipSlot = "weapon" | "armor" | "accessory";

/** A unit's equipped items (D76) — slot → {@link "./equipment".EquipmentDef} id. */
export type UnitEquipment = Partial<Record<EquipSlot, string>>;

/**
 * A signed per-stat delta (D76) — the actual change applied to a unit's
 * {@link UnitStats} by a gear/equipment stamp, recorded key-by-key so a revert is
 * exact (including any 0-clamp). An empty map is an identity (no change).
 */
export type StatDelta = Partial<Record<keyof UnitStats, number>>;
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
   * How a bound captive may be **freed** (D52/D69) — the rescue-gate requirement
   * ({@link ReleaseRequirement}). Defaults to absent ⇒ `reach` (any adjacent ally). An
   * authored cuffed captive sets `{ kind: "lockpick" }` for the Thief-only "pick the cell".
   */
  release?: ReleaseRequirement;
  /**
   * **Thief archetype** flag (D30 theft vector); defaults to false. A thief enemy
   * skims the run **purse** mid-battle and tries to flee off-map with it — killed
   * before it escapes drops the loot, escaped keeps it ({@link "./theft"}).
   */
  thief?: boolean;
  /**
   * **Standing order** (D41/D81) — the unit's standing *behavior when not
   * player-driven*. For a player unit it's the reserved auto-action (e.g.
   * `"defend"`, D41 — the auto-execution turn-loop is a later pass); for an
   * **enemy** the AI planner dispatches on it (D81): `"hold"` = a leashed guard
   * that defends its **post** instead of charging. Undefined = the default
   * (manual control / the charging planner).
   */
  standingOrder?: string;
  /**
   * **Objective role** (D50) — a tag an objective binds to (e.g. the closing-gate
   * driver: `"sapper"`). Authored content sets it; objectives address the unit by
   * this tag or its id, so a generator can emit objectives without hand-wiring.
   */
  role?: string;
  /** Seed the unit's run-scoped {@link Unit.memory} flag bag (D65); defaults to empty. */
  memory?: Record<string, string | number | boolean>;
  /**
   * Pre-equipped per-unit gear (D76) — slot → equipment id; defaults to empty. A
   * generic unit starts bare; authored content (or in-run {@link "./equipment".equip})
   * fills slots. An empty loadout leaves a run byte-identical to the un-equipped one.
   */
  equipment?: UnitEquipment;
}

/**
 * A live unit in a battle. Extends its authored stats with the mutable runtime:
 * current `pos`, `hp`, the `ct` gauge, `alive` flag, applied `statuses`, and a
 * generic `counters` bag (the capture-meter shape, D12).
 */
/**
 * How a **bound captive** may be freed (D52/D69) — the requirement the rescue Act
 * enforces, generalizing the L1 "reach + Free" into a small **extensible union** so
 * authored content can gate a captive behind a capability (and, later, an item):
 *  - `reach` — the default (absent ⇒ this): any adjacent ally frees it (the Cook).
 *  - `lockpick` — the rescuer must hold the Expert Lockpick capability (the Thief) — the
 *    "pick the cell" infiltration taste, the first Thief-exclusive deploy payoff.
 * Extend the union (e.g. a `key`-carrying variant) at the first content that needs it,
 * not before. Evaluated by {@link "./deployment".canRelease}.
 */
export type ReleaseRequirement = { kind: "reach" } | { kind: "lockpick" };

export interface Unit extends UnitStats {
  readonly id: string;
  /**
   * The faction a unit fights for. Fixed for its whole life **except** the D30/D62 **sway**
   * (a bribed enemy turning coat): that logged `sway` action flips it, and undo restores it
   * from the checkpoint — so `side` is undoable state, not `readonly` identity.
   */
  side: Side;
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
  /** Standing behavior when not player-driven (D41/D81), e.g. `"defend"`, `"hold"`. */
  standingOrder?: string;
  /**
   * The tile a standing order anchors to (D81) — where the unit stood when it
   * took the order (its authored placement). A `"hold"` guard leashes to it and
   * walks back if displaced. Set at creation only for ordered units.
   */
  post?: GridCoord;
  /** Objective role tag (D50), e.g. the closing-gate `"sapper"`; objectives bind to it. */
  role?: string;
  /** Authored ambush body hidden until scouted (D44); a render/fog flag. */
  hidden?: boolean;
  /**
   * Per-unit **equipped gear** (D76) — the weapon/armor/accessory slots. Combat
   * reads its effect through the {@link gearStamp} (stamped at staging), not from
   * here directly. Defaults to empty (a bare unit); see {@link "./equipment"}.
   */
  equipment: UnitEquipment;
  /**
   * The aggregate **gear** delta stamped onto this unit for the current battle
   * (D52/D76) — the blanket gear-condition (iron-weapons edge + worn-gear penalty)
   * **plus** the unit's equipped gear ({@link equipment}), folded into one signed
   * {@link StatDelta} and an optional set of granted passives, recorded so it can be
   * reverted cleanly between battles ({@link "./gear-condition"}). Absent ⇒ no stamp.
   */
  gearStamp?: { stats: StatDelta; passives?: Record<string, number> };
  /**
   * Captured (D7): bound on the map, doesn't take turns, excluded from the
   * initiative seed, but still "alive" — a rescuable sub-objective.
   */
  captured: boolean;
  /**
   * How this unit — while a bound {@link captured} captive — may be **freed** (D52/D69):
   * the requirement the rescue Act enforces ({@link "./deployment".canRelease}). Absent ⇒
   * `reach` (any adjacent ally frees it, the L1 Cook). Set at creation for an authored
   * captive; the battle never mutates it (so it is not snapshotted for undo).
   */
  release?: ReleaseRequirement;
  /**
   * **Escaped off-map** (D84): a fleeing unit that reached a map edge and left.
   * Gone from the field — excluded from every active check ({@link isActive}),
   * off the clock, untargetable, not drawn — but not *dead* (no defeat event, no
   * kill credit). Set only by the logged `escape` action, so replay reproduces it.
   */
  escaped?: boolean;
  /**
   * Dug in (D63): hunkered during Deployment for a reduced capture chance when the
   * net's turn comes. A deployment-phase transient — set by the `digIn` action,
   * cleared by moving or capture, and reset between encounters. Combat never sets it.
   */
  dugIn?: boolean;
  /**
   * Concealed (D67 W6): not yet **engageable** — a pre-engagement veil rather than a
   * skill rule. `enterDeploy` sets it on the enemy roster (the foe is pre-positioned but
   * not yet a valid target — there is "no one to attack" in staging), and `beginBattle`
   * clears it for everyone (the encounter engages). {@link isValidSkillTarget} won't return
   * a concealed unit, so a combat action cast in pre-combat simply finds no target and sits
   * idle — no per-phase skill ban needed. The seam for **targetable** pre-combat foes (a
   * keep-assault stages defenders `concealed: false`) and future intel-reveal / ghost tokens.
   * Distinct from {@link hidden} — the D44 authored-**ambush** flag, which persists *into*
   * combat until scouted or sprung; this lifts the moment the battle opens.
   */
  concealed?: boolean;
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
  /**
   * Per-unit **memory** (D65) — a run-scoped flag bag a node event writes and a
   * later one reads (the meet-traveler → later-reveal chain). Lives on the
   * `run.party` unit, so it threads the whole run for free; cross-run / guild
   * persistence is deferred (D65 addendum). Keyed flag → value; empty for a
   * fresh unit. Read via {@link recalls}/{@link recall}, written via {@link remember}.
   */
  memory: Record<string, string | number | boolean>;
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
    post: spec.standingOrder ? { col: spec.pos.col, row: spec.pos.row } : undefined,
    role: spec.role,
    release: spec.release,
    hidden: false,
    captured: false,
    escaped: false,
    dugIn: false,
    concealed: false,
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
    memory: { ...(spec.memory ?? {}) },
    equipment: { ...(spec.equipment ?? {}) },
  };
}

/**
 * True if a unit is **active** (D7): alive, not captured, and still on the map. A
 * captured unit is still "alive" but bound; an **escaped** unit (D84) is alive but
 * *gone* — off the field entirely. Neither takes turns, threatens, nor holds a
 * side in the battle. The single predicate behind body-counting, the initiative
 * seed, threat ranges, the win check, and the AI's foe lists — which is exactly
 * why a lone fleeing survivor's exit ends the encounter as a player win.
 */
export function isActive(unit: Pick<Unit, "alive" | "captured" | "escaped">): boolean {
  return unit.alive && !unit.captured && !unit.escaped;
}

/**
 * The {@link isActive} units, optionally narrowed to one `side` — the single
 * filter the body-count / win-check / AI-foe-list call sites share, replacing the
 * inlined `u.alive && !u.captured && u.side === …` predicate.
 */
export function activeUnits(units: readonly Unit[], side?: Side): Unit[] {
  return units.filter((u) => isActive(u) && (side === undefined || u.side === side));
}

/** True if `side` has any {@link isActive} unit — the win-check primitive. */
export function hasActive(units: readonly Unit[], side: Side): boolean {
  return units.some((u) => isActive(u) && u.side === side);
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
 * The party members currently **fielded** (the overworld twin of {@link isActive}):
 * alive and not captured — the bodies the caravan can actually draw on between
 * nodes. A captured member is still "alive" but bound (D7) and fields nothing —
 * no brokering, no class-economy unlock, no stew. The single home for the
 * `u.alive && !u.captured` roster filter that was copy-pasted per call site.
 * (Unlike {@link isActive} it does not read `escaped` — that is a battle-scoped
 * flag; the roster filters never consulted it, and this stays pure motion.)
 */
export function fieldedUnits<U extends Pick<Unit, "alive" | "captured">>(party: readonly U[]): U[] {
  return party.filter((u) => u.alive && !u.captured);
}

/**
 * True if the party **fields a live, uncaptured member of job** `jobId` (by
 * {@link primaryJobOf}) — the class-in-the-party economy gate (D30/D62/D68):
 * a class in the party unlocks that class's economy, and a captured or dead
 * member unlocks nothing. The single spelling of the per-class
 * `u.alive && !u.captured && primaryJobOf(u) === "<job>"` idiom whose per-site
 * copies had drifted (the captured-Cook bug).
 */
export function fieldsJob(
  party: readonly Pick<Unit, "alive" | "captured" | "primaryJob" | "jobId">[],
  jobId: JobId,
): boolean {
  return fieldedUnits(party).some((u) => primaryJobOf(u) === jobId);
}

/**
 * Per-unit **memory** (D65) — write a run-scoped flag onto the unit's {@link
 * Unit.memory} bag. Defaults the value to `true` (the common "this happened"
 * marker); pass a string/number for richer linked state. Pure; mutates the bag.
 */
export function remember(unit: Unit, flag: string, value: string | number | boolean = true): void {
  unit.memory[flag] = value;
}

/**
 * True if the unit **recalls** `flag` as a truthy value (the linked-event gate
 * the `remembers` predicate reads). Use {@link recall} to read the raw value
 * (e.g. a stored `0`/`false`/`""`). Pure.
 */
export function recalls(unit: Pick<Unit, "memory">, flag: string): boolean {
  return Boolean(unit.memory[flag]);
}

/** The raw value remembered for `flag`, or `undefined` if never written (D65). Pure. */
export function recall(unit: Pick<Unit, "memory">, flag: string): string | number | boolean | undefined {
  return unit.memory[flag];
}

/** Forget a remembered `flag` (idempotent, D65). Pure; mutates the bag. */
export function forget(unit: Unit, flag: string): void {
  delete unit.memory[flag];
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
