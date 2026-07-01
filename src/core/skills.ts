/**
 * Skills as data (M4 / D3).
 *
 * A skill is a plain data record — never a subclass. It declares which **phase**
 * it hooks, what it **targets**, its **range**, the CT it **spends**, and a
 * declarative **effect** the resolver interprets against the battle. New skills
 * are new data; the battle loop needs no new branches. M4 exercises the
 * `battle`-phase skills; the other phases are laid as the D3 seam.
 *
 * Pure logic: no Phaser, no DOM.
 */

import { healUnit, type Unit } from "./units";
import type { EventBus } from "./events";
import type { StatusInstance } from "./status";
import { resolveAttack, manhattan, PASSIVE } from "./combat";
import { applyStatus, markPrey, cleanseOne, hastened } from "./status";
import { countOf, removeItem, type Inventory } from "./inventory";
import { abilityScaleBonus } from "./leveling";
import { assertNever } from "./num";
import type { CapabilityId } from "./jobs";
import type { OverworldCost } from "./overworld-actions";

/** The ordered phases of the game pipeline (D3). */
export type Phase = "meta" | "deployment" | "battle" | "resolution";

/**
 * The game-wide surfaces where a skill can be **used/surfaced** (D67) — a finer axis than
 * {@link Phase} (the pipeline tier `meta` splits into `overworld` + `guild`). Declared as
 * data on a skill; defaults from the skill's *shape* via {@link skillContexts}, so authors
 * rarely write it. Combat is the substrate; deployment is `pre-combat`.
 */
export type UsableContext = "overworld" | "guild" | "pre-combat" | "combat";

/**
 * Who a skill is aimed at. `self`/`enemy`/`ally` are battle targets (a unit);
 * `camp` (economy/morale) and `party` (a whole-party buff) are non-combat
 * targets resolved by the meta/deployment phases, not against a single unit.
 */
export type SkillTarget = "self" | "enemy" | "ally" | "camp" | "party";

/** A status rider authored on a skill (the `data` payload is optional — the builder may add it). */
export type RiderStatus = Omit<StatusInstance, "data"> & { data?: Record<string, unknown> };

/**
 * A heavier strike: deal damage as if the caster's attack were `+bonusAttack`,
 * optionally applying `onHit` to the target afterwards — one rider (the Soldier's
 * Debilitating Strike = Exposed) or a list (the Assassin's Surgical Precision =
 * Exposed + Immobilized). The strike still earns flanking when melee.
 */
export interface DamageEffect {
  kind: "damage";
  bonusAttack: number;
  /** Status(es) applied to the target on a hit — one, or a list. */
  onHit?: RiderStatus | RiderStatus[];
}
/**
 * Forced movement (D19): push the target away from the caster `tiles` tiles,
 * stopping at blockers; a forced entry onto an entity tile fires it. Resolved by
 * the {@link "./turn".Battle} (it needs the grid + roster).
 */
export interface ForcedMoveEffect {
  kind: "forced-move";
  tiles: number;
  /** Bonus damage dealt with the shove (0 = pure displacement). */
  bonusAttack?: number;
}
/**
 * Directional melee AoE (D40): hit every foe in the up-to-`reach` tiles of a
 * chosen-at-cast 90° arc. Resolved by {@link "./turn".Battle.cleave}.
 */
export interface CleaveEffect {
  kind: "cleave";
  bonusAttack: number;
  /** Tiles deep the arc reaches in the chosen direction. */
  reach: number;
}
/**
 * The Medic's herb-fuelled Heal marker (D40). The actual resolution consumes a
 * chosen herb from the stash via {@link resolveMedHeal} ({@link "./turn".Battle
 * .useHeal}); this record just surfaces the button.
 */
export interface MedHealEffect {
  kind: "med-heal";
}
/**
 * The Soldier's **Turtle Formation** (D66): a self-cast that braces the line —
 * apply Guarded to every ally adjacent to the caster (an "AoE Defend"). Needs the
 * roster, so it's resolved by {@link "./turn".Battle.resolveGuardAllies}, not the
 * unit-pair {@link resolveSkill}.
 */
export interface GuardAlliesEffect {
  kind: "guard-allies";
  /** Damage-reduction granted to each adjacent ally (the Guarded amount). */
  amount: number;
  /** Turns the Guard lasts (default 1 — until the ally's next turn, like Defend). */
  duration?: number;
}
/** Restore HP to the target (capped at maxHp). */
export interface HealEffect {
  kind: "heal";
  amount: number;
}
/** Apply a status to the target (buff or debuff). */
export interface StatusEffect {
  kind: "status";
  status: Omit<StatusInstance, "data"> & { data?: Record<string, unknown> };
}
/**
 * Open a maintained-stance **channel** on the caster, locked to the target
 * (D37) — the Hunter's Mark Prey. Consecutive hits on that prey ramp damage; the
 * caster keeps moving & acting; the stance ends on caster death / target-switch.
 */
export interface ChannelEffect {
  kind: "channel";
}
/**
 * A heal that also **scales with the target's missing HP** when the caster has
 * the Medic's Triage passive (D40): heals `amount` + `triage × missingHp`. With
 * no Triage it's a plain heal of `amount`.
 */
export interface TriageHealEffect {
  kind: "triage-heal";
  amount: number;
}
/** Remove one debuff from the target (the Medic's antidote cleanse, D40/D41). */
export interface CleanseEffect {
  kind: "cleanse";
}

/** Meta/camp: the Cook raises party morale and banks a between-battle heal. */
export interface MoraleEffect {
  kind: "morale";
  morale: number;
  /** HP healed to each unit at the start of the next battle. */
  partyHeal: number;
}
/** Deployment: a trap-layer places a trap dealing `damage` when sprung. */
export interface PlaceTrapEffect {
  kind: "placeTrap";
  damage: number;
  /**
   * An optional debuff the sprung trap inflicts (a snare → Immobilize). A debuffed
   * foe is what the Hunter's Deadeye punishes — so a trap-layer *sets up* the
   * Hunter's enhanced damage (the trapper↔Hunter synergy).
   */
  status?: StatusInstance;
}

/**
 * **Battle-phase** effects resolved **unit-vs-unit** by {@link resolveSkill} via the
 * {@link BATTLE_EFFECT_HANDLERS} registry. Adding a kind here forces a new registry
 * entry at compile time (the mapped-type exhaustiveness).
 */
export type BattleEffect =
  | DamageEffect
  | HealEffect
  | StatusEffect
  | ChannelEffect
  | TriageHealEffect
  | CleanseEffect;
/**
 * Battle effects that need more than a unit pair — the **grid/roster** (forced-move,
 * cleave) or the **shared stash** (med-heal). Resolved by dedicated {@link
 * "./turn".Battle} methods (`resolveShove`/`cleave`/`useHeal`), never by `resolveSkill`.
 */
export type FieldEffect = ForcedMoveEffect | CleaveEffect | MedHealEffect | GuardAlliesEffect;
/** **Meta/camp** effects resolved by {@link "./camp".applyCampSkill}. */
export type CampEffect = MoraleEffect;
/** **Deployment** effects realized when the field is built (the trap layer). */
export type DeploymentEffect = PlaceTrapEffect;

/**
 * **Overworld**: open an **impromptu market** at the current node — sets the per-node
 * "market opened here" flag ({@link "./overworld-actions".setNodeFlag}) that {@link
 * "./overworld".effectiveMarketTier} folds in (the Find-Trade *mechanism*). No payload —
 * the node is the actor's current one.
 */
export interface OpenMarketEffect {
  kind: "openMarket";
}
/**
 * **Overworld**: **prime** the one-shot "next deal" flag ({@link
 * "./overworld-actions".primeFlag}) a follow-up trade consumes (the Savvy-Barter
 * *mechanism*). No payload — the priming is the whole effect.
 */
export interface PrimeDealEffect {
  kind: "primeDeal";
}
/**
 * **Camp/overworld**: **provision a meal** — bank `rp` Rest Points (D9) **and satisfy the
 * Food Upkeep line** for the night (D15/D45), turning the mandatory food spend into
 * recovery with no double-charge (the Cook-Stew *mechanism* — Upkeep coupling + RP bank).
 */
export interface ProvisionMealEffect {
  kind: "provisionMeal";
  /** Rest Points banked into the run pool. */
  rp: number;
}
/**
 * **Overworld**: raise a reachable node's banded **intel preview** by `tierBump` tiers
 * (D24) — the Scout's Survey recon. Reads the chosen node from the action's
 * `opts.targetNodeId`; the one node-targeting overworld effect (skill target `camp`).
 * Migrated from the retired `OverworldAbility` registry into the unified home (D72).
 */
export interface SurveyNodeEffect {
  kind: "survey";
  /** How many tiers to bump the target node's preview by. */
  tierBump: number;
}
/**
 * **Overworld**: comb the surroundings for supplies (D73 — the Survivalist's clearing verb). Always
 * yields each `guaranteed` material (the no-wasted-action floor), then `baseRolls + floor(jobLevel ×
 * rollsPerLevel)` weighted draws from `table` — so a veteran forager finds more (non-combat
 * use-leveling, D32). Rolls derive from `streamFor` (node + night + the per-night use index), so they
 * are deterministic and replayable; the haul is capped by caravan storage (overflow is simply lost).
 */
export interface ForageEffect {
  kind: "forage";
  /** Material ids always found — the guaranteed floor (forage is never a wasted action). */
  guaranteed: string[];
  /** Weighted bonus-roll table: a material id and its relative draw weight. */
  table: { id: string; weight: number }[];
  /** Bonus rolls at job level 1. */
  baseRolls: number;
  /** Extra bonus rolls per job level (floored): `rolls = baseRolls + floor(level × rollsPerLevel)`. */
  rollsPerLevel: number;
}
/**
 * **Overworld / camp economy** effects (D72) — resolved by the exhaustive
 * {@link "./overworld-actions".OVERWORLD_EFFECT_HANDLERS} registry (the overworld twin of
 * {@link BattleEffect}'s, the way {@link CampEffect} resolves in {@link "./camp"}). The
 * generic *mechanisms* the non-combat triad needs (plus migrated Survey); a class's actual
 * verbs (Find Trade / Savvy Barter / Cook Stew) wire them onto a job in the content pass.
 */
export type OverworldActionEffect = OpenMarketEffect | PrimeDealEffect | ProvisionMealEffect | SurveyNodeEffect | ForageEffect;

/**
 * The declarative effect a skill applies when it resolves — **partitioned by the
 * interpreter that owns it** ({@link BattleEffect} / {@link FieldEffect} /
 * {@link CampEffect} / {@link DeploymentEffect} / {@link OverworldActionEffect}), so
 * where a kind resolves is part of the type, not a comment.
 */
export type SkillEffect = BattleEffect | FieldEffect | CampEffect | DeploymentEffect | OverworldActionEffect;

/**
 * Optional ability cost beyond the Act (D37). The combat economy is **time**:
 * `charge` commits now and resolves later on the clock; `cooldown` is a sparing
 * re-arm on instant utility. A skill with neither is the instant floor.
 */
export interface SkillCost {
  /**
   * Charge gauge speed (D5/D37): the effect resolves later, when a
   * {@link "./clock".ScheduledEffect} filling by this each tick reaches 100.
   * Lower = a longer charge ("~N turns"); ≥100 lands next tick.
   */
  charge?: number;
  /** CT cooldown armed after use (instant-utility spam-limit, ~150–250 CT). */
  cooldown?: number;
}

/** A skill definition — pure data authored in a job file. */
export interface SkillDef {
  id: string;
  name: string;
  description: string;
  /** Which phase of the pipeline this skill acts in (D3). */
  phase: Phase;
  /**
   * Optional override of where this skill may be surfaced/used (D67). When omitted,
   * {@link skillContexts} derives it from the skill's shape (effect kind + target + spend).
   * Set it only when the default is wrong (e.g. {@link "./jobs".DIG_IN} is pre-combat-only).
   */
  usableContext?: UsableContext[];
  /** Who it can be aimed at. */
  target: SkillTarget;
  /** Range in tiles (Manhattan). `self` skills use 0. */
  range: number;
  /** CT cost after use — battle skills are Acts (the expensive option, D5). */
  spend: "act" | "move";
  /** Optional charge/cooldown cost beyond the Act (D37). */
  cost?: SkillCost;
  /**
   * Job level at which this skill unlocks (D39). Defaults to 1 (available from
   * the start). The four kits start with their passive + one active and earn the
   * **2nd active at level 2** ({@link "./leveling".unlockedSkills}).
   */
  unlockLevel?: number;
  /**
   * For a **meta/camp** skill: the maximum times it may be fired **at a single
   * overworld node** (D35 spine). The overworld action economy gates every verb so
   * it can't be spammed; `usesPerNode` is the gate for a *costless* signature job
   * action (Cook's stew, Merchant's trade), reset each node-step ({@link
   * "./overworld-actions".tickCooldowns}). **Undefined ⇒ uncapped** — a skill that
   * pays its own way each cast (a Vancian charge, a gold/resource buy) is gated by
   * that cost and may fire as many times as it can afford. Enforced by {@link
   * "./overworld-actions".useCampSkillAtNode}; combat-phase skills ignore it (the CT
   * clock is their limiter).
   */
  usesPerNode?: number;
  /**
   * An optional **capability gate** (D72): the action is available only to a unit that
   * *holds* this {@link "./jobs".CapabilityId} (the Triage / lockpick shape — the
   * **Capability** gate of the action taxonomy), layered on the implicit **Class** gate
   * of living on a job. Evaluated by {@link "./jobs".unitHasCapability}; omitted ⇒ no
   * capability gate (the action's class/universal home is its only gate).
   */
  requires?: CapabilityId;
  /**
   * The **two-axis overworld cost** (D72) a between-nodes action declares — the full
   * {@link "./overworld-actions".OverworldCost} menu (cooldown / per-node cap / fatigue /
   * gold / influence / rp, computed prices and all), gating the action through the shared
   * {@link "./overworld-actions".checkOverworldCost} limiter. Omitted ⇒ derived from
   * `usesPerNode` alone (a costless signature action like Cook Stew), via
   * {@link "./overworld-actions".overworldCostOf}. Combat skills ignore it (the CT clock /
   * `cost` is their limiter); it's the overworld twin of {@link SkillCost}.
   */
  overworldCost?: OverworldCost;
  /**
   * The skill's effect. One effect per skill, one skill per surface: a combat verb resolves
   * on the board, an overworld verb ({@link "./jobs".SURVEY}, Cook Stew, Forage) between
   * nodes — the surface is read off {@link "./skills".skillContexts}, never a second face.
   */
  effect: SkillEffect;
}

/**
 * Where a skill may be surfaced/used, defaulting from its **shape** so availability is pure
 * data, not a per-ability annotation. As of D67 W7 there is **no engagement axis** — an
 * offensive skill is *not* classified combat-only. Every board skill is usable in **both**
 * board phases; whether an attack actually does anything pre-combat is decided by the board
 * (a concealed foe is no valid target — see {@link isValidSkillTarget}), so it simply sits
 * idle in staging rather than being banned. The rule, in one place:
 *
 * - **board** (every offensive/support/buff effect: damage/cleave/forced-move/channel/status/
 *   heal/med-heal/cleanse/guard-allies, and a move self-buff) ⇒ both `pre-combat` + `combat`;
 * - a **trap** ⇒ `pre-combat`; **camp/morale/recon** ⇒ `overworld`.
 *
 * The few genuinely **single-phase mechanics** carry an explicit {@link SkillDef.usableContext}
 * (Dig In is `pre-combat`; the Scout's stealth is `combat`) — those are phase-native, not the
 * engagement axis. The one remaining default exception is **charged** (it resolves on the CT
 * clock, a combat-only mechanic). The switch is exhaustive over the effect union.
 */
export function skillContexts(skill: SkillDef): UsableContext[] {
  if (skill.usableContext) return skill.usableContext;
  // A charged ability commits now and resolves *later on the CT clock* (D37) — a
  // combat-clock mechanic with no deploy-clock equivalent, so it's combat-only whatever
  // its effect shape (e.g. the Medic's charged Mend).
  if (skill.cost?.charge) return ["combat"];
  const e = skill.effect;
  switch (e.kind) {
    case "placeTrap":
      return ["pre-combat"];
    case "morale":
    case "openMarket":
    case "primeDeal":
    case "provisionMeal":
    case "survey":
    case "forage":
      // Camp/overworld economy + recon mechanisms (D72/D73) — surfaced on the between-nodes beat.
      return ["overworld"];
    case "med-heal":
      // The herb-stash heal (D40) — a support action like any other now (D67 W8): the deploy
      // herb-pick menu is wired, so the demo Medic can pre-heal a wounded unit in staging. It
      // spends a carried herb in either phase; only the surrounding turn-commit is phase-aware.
      return ["pre-combat", "combat"];
    case "damage":
    case "cleave":
    case "forced-move":
    case "channel":
    case "status":
    case "heal":
    case "triage-heal":
    case "cleanse":
    case "guard-allies":
      // Board skills — usable in either board phase. An offensive one finds no target in
      // pre-combat (the foe is concealed) and sits idle; no per-phase ban needed (D67 W7).
      return ["pre-combat", "combat"];
    default:
      return assertNever(e);
  }
}

/** What a resolved skill did, for the caller / render layer to report. */
export interface SkillOutcome {
  damage?: number;
  healed?: number;
  status?: string;
  /** The debuff id removed by a cleanse, if any. */
  cleansed?: string;
  /** True if the skill was committed as a charge and will resolve later (D37). */
  charging?: boolean;
}

/** The Medic's Heal tuning (D40) — magnitudes for the bridge, a numbers pass later. */
export const MED_HEAL = {
  /** Base HP a Heal restores before Triage scaling. */
  base: 8,
  /** Salve rider: extra HP healed. */
  salveBonus: 8,
  /** Stimulant rider: Hastened duration applied to the target. */
  stimulantDuration: 1,
} as const;

/** The rider the herb-keyed {@link MedHealEffect} applies on top of the heal. */
export type MedHealRider =
  | { kind: "none" }
  /** A Hastened status applied to the target (the stimulant rider). */
  | { kind: "hasten"; duration: number }
  /** Cleanse one debuff off the target (the antidote rider). */
  | { kind: "cleanse" };

/**
 * The Medic's **Heal** predict-core (D64 single-source-of-truth): the exact HP a
 * Heal would restore to `target`, plus the {@link MedHealRider} the chosen herb
 * applies — **pure, no mutation, no herb consumption**. Both the resolver
 * ({@link resolveMedHeal}) and the telegraph forecaster
 * ({@link "./ability-forecast".forecastSkill}) call this, so the previewed figure
 * is *byte-identical* to what resolution applies (the resolver never re-derives
 * the math; the forecast never duplicates it). Base scales with the Medic's job
 * level ({@link abilityScaleBonus}) and Triage passive (more missing HP → more
 * healing); salve adds {@link MED_HEAL.salveBonus}. The returned `amount` is the
 * *requested* heal before the maxHp cap — {@link applyHeal} clamps it, so callers
 * wanting the realized figure clamp to `target.maxHp - target.hp`.
 */
export function medHealAmount(
  medic: Unit,
  target: Unit,
  herbId: string,
): { amount: number; rider: MedHealRider } {
  const triage = medic.passives[PASSIVE.triage] ?? 0;
  const missing = target.maxHp - target.hp;
  let amount = MED_HEAL.base + abilityScaleBonus(medic) + Math.floor(triage * missing);
  if (herbId === "salve") amount += MED_HEAL.salveBonus;

  let rider: MedHealRider = { kind: "none" };
  if (herbId === "stimulant") rider = { kind: "hasten", duration: MED_HEAL.stimulantDuration };
  else if (herbId === "antidote") rider = { kind: "cleanse" };
  return { amount, rider };
}

/**
 * The Medic's **Heal** (D40 combat↔logistics bridge): consume one medical herb
 * from the shared stash and heal `target`, with a **rider keyed by the herb**:
 * salve → bigger heal; stimulant → Hastened; antidote → cleanse a debuff. Base
 * heal scales with the Medic's Triage passive (more wounded → more healing).
 * Returns an empty outcome (no heal) if the herb isn't carried. The heal figure +
 * rider come from the pure {@link medHealAmount} predict-core (D64) — this
 * resolver only *applies* them (consume herb, heal, apply the rider).
 */
export function resolveMedHeal(
  medic: Unit,
  target: Unit,
  herbId: string,
  inv: Inventory,
  bus?: EventBus,
): SkillOutcome {
  if (countOf(inv, herbId) < 1) return {};
  removeItem(inv, herbId, 1);

  const { amount, rider } = medHealAmount(medic, target, herbId);
  const out: SkillOutcome = applyHeal(medic, target, amount, bus);
  if (rider.kind === "hasten") {
    applyStatus(target, hastened(rider.duration));
    out.status = "hastened";
  } else if (rider.kind === "cleanse") {
    out.cleansed = cleanseOne(target)?.id;
  }
  return out;
}

/**
 * Predict-core for a plain {@link HealEffect} (D64): the HP a heal of `base` would
 * request, after the caster's job-level scaling ({@link abilityScaleBonus}). Pure;
 * shared by the `heal` resolver and the forecaster so the two never drift. Like
 * {@link medHealAmount} this is the *requested* amount before the maxHp cap.
 */
export function healAmount(caster: Unit, base: number): number {
  return base + abilityScaleBonus(caster);
}

/**
 * Predict-core for a {@link TriageHealEffect} (D64): a {@link healAmount} that
 * **also scales with the target's missing HP** when the caster has the Medic's
 * Triage passive — heals `base` + level-scale + ⌊triage × missingHP⌋. With no
 * Triage it's a plain `healAmount`. Pure; shared by the `triage-heal` resolver and
 * the forecaster (the spec's "computed" outcome reads exactly this).
 */
export function triageHealAmount(caster: Unit, target: Unit, base: number): number {
  const triage = caster.passives[PASSIVE.triage] ?? 0;
  const missing = target.maxHp - target.hp;
  return healAmount(caster, base) + Math.floor(triage * missing);
}

/** Restore HP to a target (capped at maxHp), firing `unitHealed`. */
export function applyHeal(
  caster: Unit,
  target: Unit,
  amount: number,
  bus?: EventBus,
): SkillOutcome {
  const healed = healUnit(target, amount, bus, caster);
  return { healed };
}

/** True if `target` is a legal target for `skill` cast by `caster`. */
export function isValidSkillTarget(
  skill: SkillDef,
  caster: Unit,
  target: Unit,
): boolean {
  switch (skill.target) {
    case "self":
      return target === caster && caster.alive;
    case "enemy":
      return (
        target.alive &&
        !target.concealed && // not yet engageable — the pre-combat veil (D67 W6)
        target.side !== caster.side &&
        manhattan(caster.pos, target.pos) <= skill.range
      );
    case "ally":
      return (
        target.alive &&
        target.side === caster.side &&
        manhattan(caster.pos, target.pos) <= skill.range
      );
    case "camp":
    case "party":
      // Non-combat targets — never a valid single-unit target.
      return false;
    default:
      return assertNever(skill.target, "isValidSkillTarget: unhandled target");
  }
}

/** What a {@link BattleEffect} handler resolves against — a caster/target pair + the bus & roster. */
interface BattleEffectCtx {
  caster: Unit;
  target: Unit;
  bus?: EventBus;
  units?: readonly Unit[];
}

/**
 * The **battle-effect registry** (the D3/D4 "effects are data, one interpreter"
 * ethos made structural): a handler per {@link BattleEffect} kind. The mapped type
 * `{ [K in BattleEffect["kind"]]: ... }` is **exhaustive at compile time** — every
 * kind must appear, and adding a kind to {@link BattleEffect} fails the build here
 * until its handler is written. Each handler is keyed to its own effect variant via
 * `Extract`, so `effect` is fully typed inside. Replaces the former throwing switch.
 */
const BATTLE_EFFECT_HANDLERS: {
  [K in BattleEffect["kind"]]: (effect: Extract<BattleEffect, { kind: K }>, ctx: BattleEffectCtx) => SkillOutcome;
} = {
  damage: (effect, { caster, target, bus, units }) => {
    const damage = resolveAttack(
      caster,
      target,
      bus,
      caster.attack + effect.bonusAttack + abilityScaleBonus(caster),
      units,
    );
    const out: SkillOutcome = { damage };
    if (effect.onHit && target.alive) {
      // One rider, or a list (Surgical Precision = Exposed + Immobilized).
      const riders = Array.isArray(effect.onHit) ? effect.onHit : [effect.onHit];
      for (const rider of riders) applyStatus(target, { ...rider });
      out.status = riders[0]?.id;
    }
    return out;
  },
  heal: (effect, { caster, target, bus }) =>
    applyHeal(caster, target, healAmount(caster, effect.amount), bus),
  "triage-heal": (effect, { caster, target, bus }) =>
    // Triage (D40): heal more the more wounded the target is. Without the
    // passive it's a plain heal of `amount`. Scales with job level (D39). The
    // figure comes from the shared predict-core so forecast == resolution (D64).
    applyHeal(caster, target, triageHealAmount(caster, target, effect.amount), bus),
  status: (effect, { target }) => {
    applyStatus(target, { ...effect.status });
    return { status: effect.status.id };
  },
  channel: (_effect, { caster, target }) => {
    // Maintained-stance channel: lock the mark onto the chosen prey (D37).
    markPrey(caster, target.id);
    return { status: "marked" };
  },
  cleanse: (_effect, { target }) => {
    const removed = cleanseOne(target);
    return { cleansed: removed?.id };
  },
};

/**
 * Apply a skill's effect to a target. Dispatches the effect through the
 * {@link BATTLE_EFFECT_HANDLERS} registry, emitting the relevant bus events
 * (damage / heal) so listeners and the render layer react. Returns what happened.
 * A non-battle effect (a {@link FieldEffect}/{@link CampEffect}/{@link
 * DeploymentEffect} routed here by mistake) throws — it resolves in its own phase
 * (see {@link "./turn".Battle} / {@link "./camp".applyCampSkill} / the trap layer).
 */
export function resolveSkill(
  skill: SkillDef,
  caster: Unit,
  target: Unit,
  bus?: EventBus,
  units?: readonly Unit[],
): SkillOutcome {
  const effect = skill.effect;
  const handler = (
    BATTLE_EFFECT_HANDLERS as Partial<Record<SkillEffect["kind"], (e: SkillEffect, ctx: BattleEffectCtx) => SkillOutcome>>
  )[effect.kind];
  if (!handler) {
    throw new Error(`resolveSkill: "${effect.kind}" is not a Battle-phase effect`);
  }
  return handler(effect, { caster, target, bus, units });
}
