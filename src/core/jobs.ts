/**
 * Jobs as data (M4) — the **engine**.
 *
 * A job is a named bundle of {@link SkillDef}s — pure data, no subclasses. A
 * unit's `jobId` links it here; {@link unitSkills} reads back its skills (filtered
 * by phase). Adding a job — or a whole non-combat role later — is adding a record to
 * the `jobs-data/` content modules and a key to {@link JOBS}, nothing more.
 *
 * The authored job records themselves live in `jobs-data/` (R3, #130): the combat
 * roster in {@link "./jobs-data/combat"}, the Scout prestige line in
 * {@link "./jobs-data/scout-line"}, and the support/economy classes + the universal
 * skills in {@link "./jobs-data/support"}. This module keeps the **engine**: the
 * {@link JobDef} type surface, the {@link JOBS} assembly + {@link JobId}, the R1
 * {@link SKILLS} registry derivation, capabilities, {@link stampPassives}, and
 * {@link unitSkills}.
 *
 * Pure logic: no Phaser, no DOM.
 */

import { primaryJobOf, type Unit, type UnitStats } from "./units";
import type { Phase, SkillDef } from "./skills";
import { PASSIVE } from "./combat";
import type { PrestigeBranch } from "./grants";
import { SOLDIER_JOB, HEAVY_KNIGHT_JOB, HUNTER_JOB, MEDIC_JOB, SNARE_TRAPPER_JOB } from "./jobs-data/combat";
import { SCOUT_JOB, ASSASSIN_JOB, THIEF_JOB } from "./jobs-data/scout-line";
import { SURVIVALIST_JOB, COOK_JOB, MERCHANT_JOB, NOBLE_JOB, BANKER_JOB, UNIVERSAL_SKILLS } from "./jobs-data/support";

/**
 * Per-stat growth weights (D39): a job level-up banks **+1 to every main stat**
 * (the universal floor) **plus** these job-weighted bonuses. Keyed by stat so a
 * future Seer's magic weighting slots in with no engine change.
 */
export type GrowthTable = Partial<Record<keyof UnitStats, number>>;

/**
 * A **presence effect** (D72) — a benefit a job holds *by being fielded* (the non-combat
 * **presence anchor**, D70: the passive analogue). Data the readers fold in, not a
 * hardcoded fn — the Merchant's **Appraisal** lifts every existing market a tier.
 */
export interface JobPresence {
  /** Tiers a fielded member lifts every **existing** market (Appraisal: poor→basic→premium, capped). */
  marketTierBonus?: number;
}

/**
 * A **per-step faucet** (D72) — what a fielded member accrues each node-step by presence
 * (the Noble's **Renown** Influence trickle). Read by the breakCamp accruals as data.
 */
export interface JobFaucet {
  /** Influence accrued per node-step by a fielded member's presence (Renown). */
  influencePerStep?: number;
}

/** A job definition — a named, described set of skills. */
export interface JobDef {
  id: string;
  name: string;
  description: string;
  skills: SkillDef[];
  /**
   * **Presence** (D72) — a benefit that holds by being fielded (the non-combat presence
   * anchor, D70). Read structurally by {@link "./overworld".effectiveMarketTier}; declared
   * by the verb-kit content pass (Appraisal). The substrate ships the seam + fixtures.
   */
  presence?: JobPresence;
  /**
   * **Per-step faucet** (D72) — Influence (etc.) a fielded member accrues each node-step
   * by presence (Renown). Read by {@link "./economy-actions".accrueDeclaredFaucets} from
   * {@link "./run".breakCamp}; declared by the verb-kit content pass.
   */
  faucet?: JobFaucet;
  /**
   * Passive parameters this job stamps onto its bearer (D40), read by combat
   * resolution. Keyed by {@link "./combat".PASSIVE}. The identity anchor.
   */
  passives?: Record<string, number>;
  /**
   * The baseline stat frame the **primary** class sets (D39) — the frame growth
   * accrues onto. Used by the demo roster + leveling.
   */
  baseline?: UnitStats;
  /** Per-job-level stat growth weights (D39); the +1-all floor is universal. */
  growth?: GrowthTable;
  /**
   * Rest Points this role banks per night (D9 recovery) — data, so adding a
   * healer is adding a number. Support roles (Cook, Medic, …) contribute; pure
   * combatants leave it undefined (0).
   */
  restPoints?: number;
  /**
   * Per-night Upkeep budget lines this job owns (D15). The Cook owns Food, the
   * Blacksmith Repairs; collapsed to a single gold figure in {@link "./upkeep"}.
   */
  upkeep?: { food?: number; repairs?: number };
  /**
   * Prestige branches (D65): the **depth** evolutions this job can take, each gated
   * by a {@link "./grants".Predicate} (the default floor is `jobLevel ≥ N`). Chains
   * fall out — a prestige job may carry its own `.prestige`. The substrate shipped the
   * **field + evaluator** ({@link "./grants".eligiblePrestiges}); the **Scout** populates
   * it first (D68, the Assassin/Thief fork).
   */
  prestige?: PrestigeBranch[];
  /**
   * True for a **lockpick/trap-trained** job (D68): it can **disarm** spotted traps and
   * pick locks even without carrying a Set-Trap skill (the Thief's Expert Lockpick).
   * Read by {@link "./traps".canDisarm} — a capability, not a hard-coded jobId (D54).
   */
  lockpick?: boolean;
}

/**
 * The job registry — the single source jobs are loaded from. Written with literal
 * keys (not `[SOLDIER_JOB.id]`) so the keys survive into the type and {@link JobId} can
 * derive from them; `satisfies` still type-checks every value as a {@link JobDef}.
 */
export const JOBS = {
  soldier: SOLDIER_JOB,
  survivalist: SURVIVALIST_JOB,
  cook: COOK_JOB,
  merchant: MERCHANT_JOB,
  noble: NOBLE_JOB,
  banker: BANKER_JOB,
  "heavy-knight": HEAVY_KNIGHT_JOB,
  hunter: HUNTER_JOB,
  scout: SCOUT_JOB,
  assassin: ASSASSIN_JOB,
  thief: THIEF_JOB,
  medic: MEDIC_JOB,
  "snare-trapper": SNARE_TRAPPER_JOB,
} satisfies Record<string, JobDef>;

/**
 * Every registered job id, derived from {@link JOBS}. Type `jobId`/`primaryJob`
 * fields against this so a typo (or an unregistered class) is a **compile error**
 * instead of a silently job-less unit — the keystone for adding new classes safely.
 */
export type JobId = keyof typeof JOBS;

/** Look up a job by id. Accepts any string (callers handle the `undefined` miss). */
export function getJob(id: string | undefined): JobDef | undefined {
  return id === undefined ? undefined : JOBS[id as JobId];
}

/**
 * A job-data resolver (D65) — {@link getJob} by default. Injectable so the prestige
 * substrate's tests can resolve **throwaway fixture jobs** (never in {@link JOBS})
 * without polluting the registry; production always uses the default {@link getJob}.
 */
export type JobLookup = (id: string | undefined) => JobDef | undefined;

// --- The global skill registry (R1 #111) ------------------------------------

/**
 * The **global skill registry**: every authored {@link SkillDef}, derived at load
 * from {@link JOBS} + {@link UNIVERSAL_SKILLS}, keyed by skill id. This is what makes
 * the combat action log **serializable** (R1 #111): a logged action stores the skill
 * **id**, and {@link "./turn".Battle.apply} resolves the def here — the D27 save /
 * desync wire-format requirement. Skill ids are therefore a registered **namespace**:
 * the derivation throws at load if two *distinct* defs collide on one id (the same
 * def object shared across jobs — Hidden Passage — is fine).
 */
export const SKILLS: Record<string, SkillDef> = (() => {
  const out: Record<string, SkillDef> = {};
  const add = (skill: SkillDef, home: string) => {
    const seen = out[skill.id];
    if (seen && seen !== skill) {
      throw new Error(`SKILLS: skill id "${skill.id}" (on ${home}) collides with another authored skill`);
    }
    out[skill.id] = skill;
  };
  for (const job of Object.values(JOBS)) for (const s of job.skills) add(s, `job "${job.id}"`);
  for (const s of UNIVERSAL_SKILLS) add(s, "the universal skills");
  return out;
})();

/** Look up an authored skill by id. Accepts any string (callers handle the `undefined` miss). */
export function getSkill(id: string): SkillDef | undefined {
  return SKILLS[id];
}

/**
 * A skill-data resolver (the D65 injectable-lookup pattern) — {@link getSkill} by
 * default. Injectable ({@link "./turn".BattleOptions}) so tests can resolve
 * **throwaway fixture skills** (never in {@link SKILLS}) without polluting the
 * registry; production always uses the default {@link getSkill}.
 */
export type SkillLookup = (id: string) => SkillDef | undefined;

// --- Capabilities (D72) — the Capability gate of the action taxonomy --------

/**
 * A **capability** (D72) — a cross-cutting ability a unit *holds* (a passive / a job
 * flag), the **Capability** gate of the action catalogue (`docs/design/systems/actions.md`):
 * an action gated by *having* it, **not** by a hard-coded job id, so it auto-extends to
 * any future class that earns it. `healer` (the Medic's Triage passive — the camp-heal
 * gate) and `lockpick` (the Thief's Expert Lockpick — disarm / pick) are the two today.
 * Add a capability by adding an id here **and** a predicate to {@link CAPABILITY_PREDICATES}
 * (the mapped type makes the build demand the predicate).
 */
export type CapabilityId = "healer" | "lockpick";

/**
 * A predicate per {@link CapabilityId} (D72) — **exhaustive at compile time**: the mapped
 * type `{ [K in CapabilityId]: ... }` forces a predicate for every id (mirroring the
 * effect-handler registries). Each reads the unit's **effective primary** job (D65) via
 * the injected `lookup`, so the gate is fixture-injectable and respects prestige.
 */
export const CAPABILITY_PREDICATES: { [K in CapabilityId]: (unit: Unit, lookup: JobLookup) => boolean } = {
  healer: (unit, lookup) => (lookup(primaryJobOf(unit))?.passives?.[PASSIVE.triage] ?? 0) > 0,
  lockpick: (unit, lookup) => lookup(primaryJobOf(unit))?.lockpick === true,
};

/**
 * True if `unit` **holds** the capability `cap` (D72) — the Capability gate evaluator.
 * `lookup` resolves the job data ({@link getJob} by default; injected by fixtures so a
 * throwaway capability-bearing job is never registered in {@link JOBS}).
 */
export function unitHasCapability(unit: Unit, cap: CapabilityId, lookup: JobLookup = getJob): boolean {
  return CAPABILITY_PREDICATES[cap](unit, lookup);
}

/**
 * Human-readable lines describing a job's **presence / faucet** declarations (D72) — the
 * **card-surfacing hook**: a class's standing-by-presence read as data, so the render can
 * show "Markets +1 tier while fielded" / "+1 Influence per step" without a bespoke string
 * per class. Empty for a job that declares neither (every job today, until the kit pass).
 */
export function jobPresenceSummary(job: JobDef): string[] {
  const out: string[] = [];
  const lift = job.presence?.marketTierBonus ?? 0;
  if (lift > 0) out.push(`Markets read +${lift} tier while fielded`);
  const inf = job.faucet?.influencePerStep ?? 0;
  if (inf > 0) out.push(`+${inf} Influence per node-step`);
  return out;
}

/**
 * Stamp a unit's job passives (D40) onto `unit.passives` so combat resolution
 * reads them (the Scout's solo-flank, the Hunter's Deadeye, the Medic's Triage,
 * the Heavy Knight's tarpit). Idempotent; call at battle setup.
 */
export function stampPassives(unit: Unit, lookup: JobLookup = getJob): void {
  // Read the **effective primary** (D65 standardization): a prestiged unit's
  // primaryJob is the evolved job, while the readonly jobId stays the frozen
  // original — so passives must follow primaryJobOf, not jobId. Always replace
  // (clearing stale passives if the evolved job has none); byte-identical for a
  // non-prestiged unit, whose primaryJobOf === jobId.
  unit.passives = { ...(lookup(primaryJobOf(unit))?.passives ?? {}) };
}

/**
 * The skills a unit has via its job, optionally filtered to one phase. Returns
 * an empty list for a unit with no job.
 */
export function unitSkills(unit: Unit, phase?: Phase, lookup: JobLookup = getJob): SkillDef[] {
  // Effective primary (D65 standardization): a prestiged unit draws the evolved
  // job's skills, not its frozen jobId's. Byte-identical when primaryJobOf === jobId.
  const job = lookup(primaryJobOf(unit));
  if (!job) return [];
  return phase ? job.skills.filter((s) => s.phase === phase) : job.skills;
}
