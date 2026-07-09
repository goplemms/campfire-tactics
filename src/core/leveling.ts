/**
 * Leveling — the D32 growth seam (thin).
 *
 * M9 lands only the **seam** D32 calls for: a per-character `level`/`xp` (on
 * {@link "./units".Unit}) and the recorded rule **"deployed grows, benched
 * doesn't."** The full FFT model — secondary-class slotting, use-leveling of
 * secondary abilities, the slot UI — is a later pass (see D32). What's here is
 * just enough to prove the rule headlessly:
 *
 * - **Combat XP** ({@link grantXp}) — combat jobs level via combat, as today.
 * - **Deployed trickle** ({@link accrueDeployedXp}) — a passive trickle for the
 *   characters **deployed on an adventure** (a caravan's party). **Benched roster
 *   never accrues** — sitting in the guild hall is never free training.
 *
 * Pure logic: no Phaser, no DOM, no `Math.random` (leveling is deterministic).
 */

import { primaryJobOf, type Unit, type UnitStats } from "./units";
import { getJob, unitSkills, unitHasCapability, type JobLookup } from "./jobs";
import { UNIVERSAL_SKILLS } from "./jobs-data/support";
import type { SkillDef } from "./skills";
import { skillContexts, type UsableContext } from "./skills";
import type { EventBus } from "./event-bus";

/** Leveling tuning — all data, a numbers pass later (D32/D39). */
export const LEVELING = {
  /** XP needed to advance one **character** level (flat; a curve comes later). */
  xpPerLevel: 100,
  /** XP needed to advance one **job** level (D39). */
  xpPerJobLevel: 100,
  /** Passive XP a **deployed** character trickles per node-step on the road. */
  deployedTrickle: 5,
  /** Bonus XP for a successful non-combat ability use (the use-leveling hook). */
  abilityUseBonus: 10,
  /** Combat XP credited to the attacker for a defeat (kill credit, D53). */
  killXp: 25,
  /** Combat XP a unit earns for surviving a hit (the smaller defender bump, D53). */
  survivedHitXp: 4,
  /** Secondary held jobs earn XP at this fraction of the primary's rate (D39). */
  secondaryRate: 0.25,
  /** Additive ability magnitude per primary-job level above 1 (D39 scaling). */
  abilityScalePerLevel: 2,
  /** Character levels that each grant +1 loadout slot (the boon hook, D38/D39). */
  loadoutBoonLevels: [5, 10] as readonly number[],
} as const;

/**
 * The "main stats" the **+1-all universal floor** hits on a job level-up (D39).
 * Stats reached only via job weights (awareness/intelligence/future magic) are
 * not in this set — the growth table adds those.
 */
export const MAIN_STATS: readonly (keyof UnitStats)[] = [
  "maxHp",
  "attack",
  "defense",
  "speed",
  "moveRange",
];

/** The level a unit holds in `jobId` (1 if never trained). */
export function jobLevelOf(unit: Unit, jobId: string | undefined): number {
  return jobId ? unit.jobLevels[jobId]?.level ?? 1 : 1;
}

/**
 * Apply one job level-up's **permanent, cumulative stat gains** (D39): +1 to
 * every main stat (the universal floor) plus the job's growth-table weights.
 * Current HP rises with maxHp (a level-up heals by the gain). Kept forever,
 * regardless of current primary.
 */
export function applyJobLevelGains(unit: Unit, jobId: string): void {
  const growth = getJob(jobId)?.growth ?? {};
  for (const stat of MAIN_STATS) {
    (unit as unknown as Record<string, number>)[stat] += 1 + (growth[stat] ?? 0);
  }
  // Growth weights on non-main stats (e.g. a future magic stat) slot in too.
  for (const [stat, w] of Object.entries(growth)) {
    if (!MAIN_STATS.includes(stat as keyof UnitStats)) {
      (unit as unknown as Record<string, number>)[stat] += w ?? 0;
    }
  }
  unit.hp += 1 + (growth.maxHp ?? 0);
}

/**
 * Grant XP toward a **job** level (D39), applying cumulative stat gains for each
 * level crossed. Lazily creates the job's progression. Returns levels gained.
 */
export function grantJobXp(unit: Unit, jobId: string, amount: number): number {
  if (amount <= 0) return 0;
  const jl = (unit.jobLevels[jobId] ??= { level: 1, xp: 0 });
  jl.xp += amount;
  let gained = 0;
  while (jl.xp >= LEVELING.xpPerJobLevel) {
    jl.xp -= LEVELING.xpPerJobLevel;
    jl.level += 1;
    applyJobLevelGains(unit, jobId);
    gained += 1;
  }
  return gained;
}

/**
 * Grant XP and apply any level-ups, capping carry-over so a big award can raise
 * more than one level. Returns the number of levels gained (0 if none).
 */
export function grantXp(unit: Unit, amount: number): number {
  if (amount <= 0) return 0;
  unit.xp += amount;
  let gained = 0;
  while (unit.xp >= LEVELING.xpPerLevel) {
    unit.xp -= LEVELING.xpPerLevel;
    unit.level += 1;
    gained += 1;
  }
  if (gained > 0) applyCharacterBoons(unit);
  return gained;
}

// --- Combat-event XP accumulator (D53) --------------------------------------

/** A running tally of combat XP earned during a battle, keyed by unit id. */
export type CombatXpTally = Record<string, number>;

/**
 * Subscribe a combat-XP accumulator to a battle's bus (D53). It tallies — it does
 * **not** apply: a **defeat** credits the kill to the lethal `source`; **surviving
 * a hit** (the struck defender still standing after the blow) earns the smaller
 * bump. Self-/friendly-fire never scores. Commit the tally at resolution with
 * {@link commitCombatXp} (no mid-battle level-ups). Returns the live tally object.
 */
export function trackCombatXp(bus: EventBus, amounts = LEVELING): CombatXpTally {
  const tally: CombatXpTally = {};
  const add = (id: string, n: number) => {
    tally[id] = (tally[id] ?? 0) + n;
  };
  bus.on("unitDefeated", ({ source }) => {
    if (source) add(source.id, amounts.killXp);
  });
  bus.on("unitDamaged", ({ unit, amount, source }) => {
    // Surviving an enemy's hit bumps the struck defender (hp > 0 after the blow).
    if (amount > 0 && unit.hp > 0 && source && source.side !== unit.side) {
      add(unit.id, amounts.survivedHitXp);
    }
  });
  return tally;
}

/**
 * Commit a {@link CombatXpTally} to the units that survived resolution (D53) via
 * {@link routeCombatXp} — character + job axes. Only units present in `survivors`
 * receive their tally (downed/removed units forfeit it). Returns the per-unit
 * level gains for the resolution feedback.
 */
export function commitCombatXp(
  tally: CombatXpTally,
  survivors: readonly Unit[],
): Record<string, { charLevels: number; jobLevels: number }> {
  const gained: Record<string, { charLevels: number; jobLevels: number }> = {};
  for (const u of survivors) {
    const amount = tally[u.id] ?? 0;
    if (amount <= 0) continue;
    const g = routeCombatXp(u, amount);
    if (g.charLevels > 0 || g.jobLevels > 0) gained[u.id] = g;
  }
  return gained;
}

/**
 * The deployed trickle (D32): every **deployed** character (a caravan's party)
 * accrues a passive bump per node-step on the road. **Benched roster is not passed
 * in**, so it never grows — the whole point of the rule. Returns the per-unit
 * levels gained, keyed by unit id.
 */
export function accrueDeployedXp(
  deployed: readonly Unit[],
  amount = LEVELING.deployedTrickle,
): Record<string, number> {
  const gained: Record<string, number> = {};
  for (const u of deployed) {
    if (!u.alive) continue;
    const lv = grantXp(u, amount);
    if (lv > 0) gained[u.id] = lv;
  }
  return gained;
}

/** A successful non-combat ability use bumps the user (the use-leveling hook, D32). */
export function grantAbilityUseXp(unit: Unit): number {
  return grantXp(unit, LEVELING.abilityUseBonus);
}

/**
 * Apply character-level **boons** (D38/D39): a +1 loadout slot at each threshold
 * in {@link LEVELING.loadoutBoonLevels} the unit has reached. The character axis
 * is breadth — future job evolutions / advanced-job gating hang here too.
 */
export function applyCharacterBoons(unit: Unit): void {
  const earned = LEVELING.loadoutBoonLevels.filter((lv) => unit.level >= lv).length;
  unit.loadoutSlots = Math.max(unit.loadoutSlots, 1 + earned);
}

/**
 * Additive ability magnitude from the caster's **primary** job level (D39): each
 * level above 1 adds {@link LEVELING.abilityScalePerLevel}. So Mend heals more,
 * and a class's strikes hit harder, as its job levels — the visible payoff.
 */
export function abilityScaleBonus(unit: Unit): number {
  return (jobLevelOf(unit, unit.primaryJob) - 1) * LEVELING.abilityScalePerLevel;
}

/**
 * The skills a unit **newly unlocked** by crossing from `fromLevel` to `toLevel` (D74) — its
 * job skills whose `unlockLevel` lands in `(fromLevel, toLevel]`, across **all** surfaces
 * (combat / deployment / overworld). Drives the resolution "you leveled → unlocked X" readout
 * (vs {@link availableSkills}, the per-context cumulative set). Empty when the level-up crossed
 * no threshold.
 */
export function skillsUnlockedBetween(unit: Unit, fromLevel: number, toLevel: number): SkillDef[] {
  return unitSkills(unit).filter((s) => {
    const lvl = s.unlockLevel ?? 1;
    return lvl > fromLevel && lvl <= toLevel;
  });
}

/**
 * The skills a unit can surface/use in a given **context** (D67/#123) — the level-gated job
 * skills **plus the universal capabilities** ({@link "./jobs-data/support".DEFEND} / {@link
 * "./jobs-data/support".DIG_IN}), all filtered to those whose {@link skillContexts} includes
 * `context`. The **one authoritative surfacing projection** for every surface (the retired
 * `phase` axis / `unlockedSkills` are gone, #123): combat calls `availableSkills(u, "combat")`;
 * deployment `"pre-combat"`; the overworld `"overworld"`.
 */
export function availableSkills(unit: Unit, context: UsableContext, lookup: JobLookup = getJob): SkillDef[] {
  const lvl = jobLevelOf(unit, primaryJobOf(unit));
  const jobSkills = unitSkills(unit, lookup).filter(
    (s) =>
      (s.unlockLevel ?? 1) <= lvl &&
      // The Capability gate (D72): a `requires` skill surfaces only for a unit holding it
      // (no-op for every skill today — none declares `requires`; proven by fixtures).
      (!s.requires || unitHasCapability(unit, s.requires, lookup)) &&
      skillContexts(s).includes(context),
  );
  const universals = UNIVERSAL_SKILLS.filter((s) => skillContexts(s).includes(context));
  return [...jobSkills, ...universals];
}

/**
 * Route combat XP (D39): the **character** level and the **primary** job earn at
 * full rate; **secondary** held jobs trickle at {@link LEVELING.secondaryRate}.
 * Returns levels gained on each axis. This is the routing the demo/run uses;
 * {@link grantXp} stays the character-only path.
 */
export function routeCombatXp(
  unit: Unit,
  amount: number,
): { charLevels: number; jobLevels: number } {
  const charLevels = grantXp(unit, amount);
  let jobLevels = 0;
  const primary = primaryJobOf(unit);
  if (primary) jobLevels += grantJobXp(unit, primary, amount);
  for (const j of unit.heldJobs) {
    if (j !== primary) grantJobXp(unit, j, Math.floor(amount * LEVELING.secondaryRate));
  }
  return { charLevels, jobLevels };
}
