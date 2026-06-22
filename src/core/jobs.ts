/**
 * Jobs as data (M4).
 *
 * A job is a named bundle of {@link SkillDef}s — pure data, no subclasses. A
 * unit's `jobId` links it here; {@link unitSkills} reads back its skills (filtered
 * by phase). M4 ships one combat job, the **Soldier**, whose three skills hook
 * the **Battle** phase and exercise all three effect kinds (damage / status /
 * heal). Adding a job — or a whole non-combat role later — is adding a record to
 * {@link JOBS}, nothing more.
 *
 * Pure logic: no Phaser, no DOM.
 */

import type { Unit, UnitStats } from "./units";
import type { Phase, SkillDef } from "./skills";
import { PASSIVE, FLANK } from "./combat";
import { guarded, exposed, swift, immobilized } from "./status";

/**
 * Per-stat growth weights (D39): a job level-up banks **+1 to every main stat**
 * (the universal floor) **plus** these job-weighted bonuses. Keyed by stat so a
 * future Seer's magic weighting slots in with no engine change.
 */
export type GrowthTable = Partial<Record<keyof UnitStats, number>>;

/** A job definition — a named, described set of skills. */
export interface JobDef {
  id: string;
  name: string;
  description: string;
  skills: SkillDef[];
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
   * healer is adding a number. Support roles (Chef, Medic, …) contribute; pure
   * combatants leave it undefined (0).
   */
  restPoints?: number;
  /**
   * Per-night Upkeep budget lines this job owns (D15). The Chef owns Food, the
   * Blacksmith Repairs; collapsed to a single gold figure in {@link "./upkeep"}.
   */
  upkeep?: { food?: number; repairs?: number };
  /**
   * True for camp-only roles (Chef, Merchant) that act in Meta but never take the
   * field — kept in the roster for Upkeep/RP/morale, excluded from combat.
   */
  noncombat?: boolean;
}

/**
 * The Soldier — a front-line combat job. Its skills are all Battle-phase Acts:
 *
 * - **Power Strike** — a heavier melee hit (damage effect).
 * - **Hamstring** — a melee hit that Immobilizes (status effect). Duration 2 so
 *   it survives the target's next turn-start tick and actually costs them a move
 *   (the AI honours `isImmobilized`).
 * - **Second Wind** — self-heal (heal effect).
 */
export const SOLDIER: JobDef = {
  id: "soldier",
  name: "Soldier",
  description: "Front-line fighter: heavy strikes, a crippling blow, and grit.",
  skills: [
    {
      id: "power-strike",
      name: "Power Strike",
      description: "A heavy melee blow (+6 attack) against an adjacent foe.",
      phase: "battle",
      target: "enemy",
      range: 1,
      spend: "act",
      effect: { kind: "damage", bonusAttack: 6 },
    },
    {
      id: "hamstring",
      name: "Hamstring",
      description: "Strike an adjacent foe and Immobilize them for a turn.",
      phase: "battle",
      target: "enemy",
      range: 1,
      spend: "act",
      effect: {
        kind: "status",
        status: { id: "immobilized", name: "Immobilized", duration: 2 },
      },
    },
    {
      id: "second-wind",
      name: "Second Wind",
      description: "Catch your breath and recover 10 HP.",
      phase: "battle",
      target: "self",
      range: 0,
      spend: "act",
      effect: { kind: "heal", amount: 10 },
    },
  ],
};

/**
 * The Survivalist — the signature **Deployment**-phase job (D3). Carries a
 * placeable trap (the first real field entity, D4): placed before battle, it
 * springs on an enemy in Combat.
 */
export const SURVIVALIST: JobDef = {
  id: "survivalist",
  name: "Survivalist",
  description: "Field-craft specialist: lays traps before the fight begins.",
  restPoints: 1,
  skills: [
    {
      id: "set-trap",
      name: "Set Trap",
      description: "Place a trap that deals 12 damage to the first enemy onto it.",
      phase: "deployment",
      target: "camp",
      range: 0,
      spend: "act",
      effect: { kind: "placeTrap", damage: 12 },
    },
  ],
};

/**
 * The Chef — the signature **Meta/camp**-phase job (D3). Cooking raises party
 * morale (D8) and banks a between-battle heal applied to the party at the start
 * of the next fight.
 */
export const CHEF: JobDef = {
  id: "chef",
  name: "Chef",
  description: "Cooks for the party: lifts morale and banks a hearty heal.",
  restPoints: 3,
  upkeep: { food: 1 }, // the Chef lowers the per-unit food cost (D15)
  noncombat: true,
  skills: [
    {
      id: "cook-stew",
      name: "Cook Stew",
      description: "Raise morale and bank +8 HP healing for each unit next battle.",
      phase: "meta",
      target: "party",
      range: 0,
      spend: "act",
      usesPerNode: 1, // one stew per camp (D35) — costless, so the node-cap is its limiter
      effect: { kind: "morale", morale: 1, partyHeal: 8 },
    },
  ],
};

/**
 * The Merchant — the signature **economy** job (D3/D61). The old gold-minting
 * **Trade** camp skill was retired (D61): the Merchant doesn't *print* gold, it is
 * **ACCESS + SELL** — it raises a node's market floor ({@link "./overworld".merchantFloor})
 * and works the {@link "./economy-actions".merchantBuy}/{@link "./economy-actions".merchantSell}
 * verbs (goods <-> gold at the node's market tier). Hence **no meta camp skill**.
 */
export const MERCHANT: JobDef = {
  id: "merchant",
  name: "Merchant",
  description: "Works the economy: finds markets anywhere and trades goods for gold.",
  noncombat: true,
  skills: [],
};

/**
 * The Noble — the signature **Influence** economy job (D62). A standing-bearer who
 * works the *political* economy rather than the field: their **presence** accrues
 * Influence as the caravan travels, **Patronize** courts patrons (gold → standing),
 * and that per-expedition standing backs the mid-battle **bribe** that sways an enemy
 * ({@link "./economy-actions".bribeEnemy}, D30/D33). Like the Merchant it's
 * **noncombat** — it carries no battle skills; its verbs *are* the Influence economy.
 * Fielding a Noble is what {@link "./economy-actions".hasNoble} keys off, the real-job
 * gate that replaced the interim Intelligence-≥-3 proxy ("a Noble is present" is at
 * last a job, not a stat threshold). Hence **no combat/meta skill** here.
 */
export const NOBLE: JobDef = {
  id: "noble",
  name: "Noble",
  description: "Works the standing economy: courts patrons for Influence and sways enemies with bribes.",
  noncombat: true,
  skills: [],
};

/**
 * The Banker — the third **economy** class (D30, the goods·time·reputation triad with
 * Merchant and Noble). A **noncombat** financier whose verbs work the **carried purse**
 * and never the guild treasury (D34): **Invest** (the purse accrues flat interest each
 * node-step), **Borrow** (buy-on-debt, auto-repaid from incoming loot), and **Guard the
 * Purse** (theft protection that blunts a thief's skim). The verbs live in
 * {@link "./economy-actions"}; like the Merchant and Noble it carries no battle skill —
 * fielding a Banker is what {@link "./economy-actions".hasBanker} keys off to unlock them.
 */
export const BANKER: JobDef = {
  id: "banker",
  name: "Banker",
  description: "Works the purse economy: interest on the carried purse, loans against future loot, and theft protection.",
  noncombat: true,
  skills: [],
};

// --- The M12 combat-depth roster (D40) — 2 active + 1 passive each ----------
//
// The passive is each class's identity anchor (stamped onto the bearer by
// stampPassives + read by combat resolution); the actives are the verbs. The
// **2nd active unlocks at job level 2** (unlockLevel: 2) — the rest-beat payoff.
// Stats live in `baseline`; `growth` is the per-level stat weighting (D39).

/** Cooldowns/charges for the kits (CT), all tunable data. */
export const KIT = {
  /** Mend's charge gauge speed (lower = longer charge). */
  mendCharge: 34,
  /** Heal's cooldown so it can't repeat every turn. */
  healCooldown: 180,
  /** Shove displacement in tiles. */
  shoveTiles: 1,
} as const;

/** The **Heavy Knight** — space-control bruiser; the tarpit anchor (C via tempo). */
export const HEAVY_KNIGHT: JobDef = {
  id: "heavy-knight",
  name: "Heavy Knight",
  description: "Space-control bruiser: warps the geometry, taxes proximity.",
  passives: { [PASSIVE.tarpit]: 1 },
  baseline: { speed: 12, maxHp: 34, attack: 11, defense: 4, moveRange: 4, sightRadius: 4, attackRange: 1 },
  growth: { maxHp: 3, defense: 1 },
  skills: [
    {
      id: "cleave",
      name: "Cleave",
      description: "Strike every foe in a chosen direction (a 90° melee arc).",
      phase: "battle",
      target: "enemy",
      range: 1,
      spend: "act",
      unlockLevel: 1,
      effect: { kind: "cleave", bonusAttack: 0, reach: 3 },
    },
    {
      id: "shove",
      name: "Shove",
      description: "Push an adjacent foe 1 tile (into blockers/traps); manufactures isolation.",
      phase: "battle",
      target: "enemy",
      range: 1,
      spend: "act",
      unlockLevel: 2,
      effect: { kind: "forced-move", tiles: KIT.shoveTiles, bonusAttack: 0 },
    },
  ],
};

/** The **Hunter** — ranged prey-hunter; punishes the afflicted (Deadeye). */
export const HUNTER: JobDef = {
  id: "hunter",
  name: "Hunter",
  description: "Ranged prey-hunter: keep spacing, lock prey, ramp it down.",
  passives: { [PASSIVE.deadeye]: 4 },
  baseline: { speed: 10, maxHp: 20, attack: 9, defense: 1, moveRange: 4, sightRadius: 6, attackRange: 3 },
  growth: { attack: 2, speed: 1 },
  skills: [
    {
      id: "reposition",
      name: "Reposition",
      description: "Dart extra tiles to kite or hold spacing (keeps Mark).",
      phase: "battle",
      target: "self",
      range: 0,
      spend: "move",
      unlockLevel: 1,
      effect: { kind: "status", status: swift(1, 2) },
    },
    {
      id: "mark-prey",
      name: "Mark Prey",
      description: "Lock onto a foe; consecutive hits on it ramp damage (a channel).",
      phase: "battle",
      target: "enemy",
      range: 3,
      spend: "act",
      unlockLevel: 2,
      effect: { kind: "channel" },
    },
  ],
};

/** The **Scout** — playmaker / flank engine; manufactures isolation + marks the kill. */
export const SCOUT_JOB: JobDef = {
  id: "scout",
  name: "Scout",
  description: "Playmaker & field-craft: manufacture isolation, plant and disarm snares, let the team eat.",
  passives: { [PASSIVE.flankSolo]: 1, [PASSIVE.flankBonus]: FLANK.bonus + 3 },
  baseline: { speed: 14, maxHp: 24, attack: 9, defense: 2, moveRange: 5, sightRadius: 6, attackRange: 1 },
  growth: { speed: 2, moveRange: 1 },
  skills: [
    {
      // Field-craft (extends the Survivalist's, which still exists as its own job): the
      // fast playmaker plants and disarms snares. The Scout's snare also Immobilizes its
      // prey — a richer trap than the Survivalist's plain Set Trap — setting up Deadeye.
      id: "set-snare",
      name: "Set Snare",
      description: "Plant a snare in Deployment: 8 damage and Immobilizes the first enemy onto it (sets up Deadeye).",
      phase: "deployment",
      target: "camp",
      range: 0,
      spend: "act",
      effect: { kind: "placeTrap", damage: 8, status: immobilized(2) },
    },
    {
      id: "dash",
      name: "Dash",
      description: "Reposition to reach a flank tile or dive a line (+move this turn).",
      phase: "battle",
      target: "self",
      range: 0,
      spend: "move",
      unlockLevel: 1,
      effect: { kind: "status", status: swift(1, 3) },
    },
    {
      id: "expose",
      name: "Expose",
      description: "A melee strike that marks: damage AND Exposed (foe takes +damage).",
      phase: "battle",
      target: "enemy",
      range: 1,
      spend: "act",
      unlockLevel: 2,
      effect: {
        kind: "damage",
        bonusAttack: 2,
        onHit: { ...exposed(2) },
      },
    },
  ],
};

/** The **Medic** — sustain backbone & clock-manager; its game is timing. */
export const MEDIC: JobDef = {
  id: "medic",
  name: "Medic",
  description: "Sustain backbone: heal harder the more wounded, save with a charge.",
  passives: { [PASSIVE.triage]: 0.5 },
  baseline: { speed: 9, maxHp: 20, attack: 4, defense: 2, moveRange: 3, sightRadius: 4, attackRange: 1 },
  growth: { maxHp: 2 },
  restPoints: 2,
  skills: [
    {
      id: "heal",
      name: "Heal",
      description: "Consume a herb: heal + a rider (salve/+heal · stimulant/+speed · antidote/cleanse).",
      phase: "battle",
      target: "ally",
      range: 1,
      spend: "act",
      unlockLevel: 1,
      cost: { cooldown: KIT.healCooldown },
      effect: { kind: "med-heal" },
    },
    {
      id: "mend",
      name: "Mend",
      description: "A committed timing-heal that scales with level (charged).",
      phase: "battle",
      target: "ally",
      range: 2,
      spend: "act",
      unlockLevel: 2,
      cost: { charge: KIT.mendCharge },
      effect: { kind: "heal", amount: 18 },
    },
  ],
};

/**
 * The **Snare-Trapper** (D42 enemy ability use): a bandit debuffer whose Snare
 * Immobilizes a foe at range — giving the Medic's antidote-cleanse and the
 * Hunter's Deadeye something to act on in-slice.
 */
export const SNARE_TRAPPER: JobDef = {
  id: "snare-trapper",
  name: "Snare-Trapper",
  description: "Bandit trapper: roots the unwary with thrown snares.",
  skills: [
    {
      id: "snare",
      name: "Snare",
      description: "Immobilize a foe up to 2 tiles away.",
      phase: "battle",
      target: "enemy",
      range: 2,
      spend: "act",
      effect: { kind: "status", status: immobilized(2) },
    },
  ],
};

/**
 * The **universal Defend** action (D41): every unit can brace (instant Act →
 * self-Guarded until its next turn). Re-homes the Guarded status (earned, not
 * granted) — the brace any fielded unit can fall back on. Not on any job —
 * surfaced for all.
 */
export const DEFEND: SkillDef = {
  id: "defend",
  name: "Defend",
  description: "Brace: reduce incoming damage until your next turn.",
  phase: "battle",
  target: "self",
  range: 0,
  spend: "act",
  effect: { kind: "status", status: guarded(1) },
};

/**
 * The job registry — the single source jobs are loaded from. Written with literal
 * keys (not `[SOLDIER.id]`) so the keys survive into the type and {@link JobId} can
 * derive from them; `satisfies` still type-checks every value as a {@link JobDef}.
 */
export const JOBS = {
  soldier: SOLDIER,
  survivalist: SURVIVALIST,
  chef: CHEF,
  merchant: MERCHANT,
  noble: NOBLE,
  banker: BANKER,
  "heavy-knight": HEAVY_KNIGHT,
  hunter: HUNTER,
  scout: SCOUT_JOB,
  medic: MEDIC,
  "snare-trapper": SNARE_TRAPPER,
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
 * Stamp a unit's job passives (D40) onto `unit.passives` so combat resolution
 * reads them (the Scout's solo-flank, the Hunter's Deadeye, the Medic's Triage,
 * the Heavy Knight's tarpit). Idempotent; call at battle setup.
 */
export function stampPassives(unit: Unit): void {
  const passives = getJob(unit.jobId)?.passives;
  if (passives) unit.passives = { ...passives };
}

/**
 * The skills a unit has via its job, optionally filtered to one phase. Returns
 * an empty list for a unit with no job.
 */
export function unitSkills(unit: Unit, phase?: Phase): SkillDef[] {
  const job = getJob(unit.jobId);
  if (!job) return [];
  return phase ? job.skills.filter((s) => s.phase === phase) : job.skills;
}
