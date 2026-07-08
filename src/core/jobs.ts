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

import { primaryJobOf, type Unit, type UnitStats } from "./units";
import type { Phase, SkillDef } from "./skills";
import { PASSIVE } from "./combat";
import { guarded, exposed, swift, immobilized, stealth } from "./status";
import type { PrestigeBranch } from "./grants";
import { computeUpkeep } from "./upkeep"; // Cook Stew's computed cost (lazy — closure only, no init-time cycle)

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
 * The **Soldier** — the **formation anchor** (D66): the first per-class pass and the
 * D40 retrofit (it predated the 2-active + 1-passive house style). Every piece is a
 * team multiplier — it hits harder *in a line* (Brother-in-arms), braces the line
 * (Turtle Formation), and breaks the foe's guard for the line (Debilitating Strike).
 * The clean inverse of the Scout (isolate + solo-flank); a complement to the Heavy
 * Knight (who controls *enemy* spacing). Stats are a sturdy mid-armor melee anchor.
 *
 * - **Brother-in-arms** (passive) — +1 attack damage per adjacent ally (capped, D66).
 * - **Debilitating Strike** (active) — a heavier blow that leaves the foe Exposed.
 * - **Turtle Formation** (active, L2) — brace: Guard every adjacent ally for a turn.
 */
export const SOLDIER: JobDef = {
  id: "soldier",
  name: "Soldier",
  description: "Formation anchor: stronger in a line — hits harder beside allies, braces them, and breaks the foe's guard.",
  passives: { [PASSIVE.brotherInArms]: 1 },
  baseline: { speed: 10, maxHp: 30, attack: 10, defense: 3, moveRange: 4, sightRadius: 4, attackRange: 1 },
  growth: { maxHp: 2, attack: 1 },
  skills: [
    {
      id: "debilitating-strike",
      name: "Debilitating Strike",
      description: "A heavy blow (+3 attack) that leaves an adjacent foe Exposed (takes extra damage) until its next turn.",
      phase: "battle",
      target: "enemy",
      range: 1,
      spend: "act",
      unlockLevel: 1,
      effect: { kind: "damage", bonusAttack: 3, onHit: { ...exposed(1) } },
    },
    {
      id: "turtle-formation",
      name: "Turtle Formation",
      description: "Brace the line: every ally beside you gains Guard (−2 damage) until its next turn.",
      phase: "battle",
      target: "self",
      range: 0,
      spend: "act",
      unlockLevel: 2,
      effect: { kind: "guard-allies", amount: 2 },
    },
  ],
};

/** Forage kit tuning (D73) — within-clearing pace × across-clearing fatigue + the yield; numbers pass. */
export const FORAGE_KIT = {
  /** Forages per clearing — the within-clearing budget (generous; no agony). */
  usesPerNode: 2,
  /** Fatigue per forage — the across-clearing stake (demanding, like Triage). */
  fatigue: 2,
  /** Bonus rolls at job level 1. */
  baseRolls: 1,
  /** Extra bonus rolls per Survivalist job level (floored). */
  rollsPerLevel: 0.5,
} as const;

/**
 * **Forage** (D73) — the Survivalist's clearing verb: comb the surroundings for supplies. The worked
 * example of the **two-budget model** — `usesPerNode` paces it *within* a clearing (twice a night),
 * `fatigue` is the *across*-clearing stake (forage hard for several un-rested nights and the forager
 * goes Weary → Exhausted). Always yields the guaranteed floor, then job-level-scaled rolls (a veteran
 * forager finds more), drawn deterministically via `streamFor` (replayable). Class-gated by living on
 * the Survivalist job (surfaced through {@link "./leveling".availableSkills}), like Survey on the Scout.
 */
export const FORAGE: SkillDef = {
  id: "forage",
  name: "Forage",
  description: "Comb the surroundings for supplies — a guaranteed find plus more the deeper your field-craft (twice per clearing).",
  phase: "meta",
  target: "camp",
  range: 0,
  spend: "act",
  overworldCost: { usesPerNode: FORAGE_KIT.usesPerNode, fatigue: FORAGE_KIT.fatigue },
  effect: {
    kind: "forage",
    guaranteed: ["wild-herbs"],
    table: [
      { id: "wild-herbs", weight: 3 },
      { id: "salve", weight: 1 },
    ],
    baseRolls: FORAGE_KIT.baseRolls,
    rollsPerLevel: FORAGE_KIT.rollsPerLevel,
  },
};

/**
 * The Survivalist — the signature **Deployment**-phase job (D3). Carries a
 * placeable trap (the first real field entity, D4): placed before battle, it
 * springs on an enemy in Combat. Forages supplies at a clearing (D73).
 */
export const SURVIVALIST: JobDef = {
  id: "survivalist",
  name: "Survivalist",
  description: "Field-craft specialist: lays traps before the fight, and forages supplies at a clearing.",
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
    FORAGE,
  ],
};

/** Cook kit tuning (D71) — RP banked + morale/cost; magnitudes are a numbers-pass concern. */
export const COOK_KIT = {
  /** Rest Points a stew banks (≈ one chunk at Normal — "a stew = a chunk of recovery"). */
  stewRp: 14,
  /** Morale a feast lifts before a hard fight (D8). */
  feastMorale: 2,
  /** Gold a feast costs — a special occasion, dearer than the everyday stew. */
  feastGold: 20,
} as const;

/**
 * **Cook Stew** (D71) — the Cook's recovery verb: cook the day's rations into a hearty meal,
 * **banking Rest Points** for the party (D9) and **satisfying the night's Food upkeep line**
 * (D15) — the mandatory food spend turned into recovery. Priced at *the night's Food value*
 * (a computed cost), so net gold is unchanged vs just paying food; the "free food that day"
 * (the `provisionMeal` effect → {@link "./upkeep".satisfyUpkeepLine}) is the anti-exploit
 * (D45 — can't cook for RP *and* skip the food line for the gold). Once per node.
 */
export const COOK_STEW: SkillDef = {
  id: "cook-stew",
  name: "Cook Stew",
  description: "Cook the day's rations into a hearty meal — bank Rest Points for the party and cover tonight's Food upkeep.",
  phase: "meta",
  target: "party",
  range: 0,
  spend: "act",
  overworldCost: { usesPerNode: 1, gold: (run) => computeUpkeep(run.party).lines.find((l) => l.id === "food")?.cost ?? 0 },
  effect: { kind: "provisionMeal", rp: COOK_KIT.stewRp },
};

/**
 * **Feast** (D71) — the Cook's morale verb: lay on a feast before a hard fight for a **big morale
 * lift** (D8). Costed/paced heavier than the everyday stew (a flat gold cost + once per node), so
 * it's a deliberate pre-battle rally, not a constant — the dedicated morale lever, freeing Cook
 * Stew to be pure recovery. Routed through the camp morale resolver (no heal of its own).
 */
export const FEAST: SkillDef = {
  id: "feast",
  name: "Feast",
  description: "Lay on a feast before a hard fight — a big morale lift for the whole party.",
  phase: "meta",
  target: "party",
  range: 0,
  spend: "act",
  overworldCost: { usesPerNode: 1, gold: COOK_KIT.feastGold },
  effect: { kind: "morale", morale: COOK_KIT.feastMorale, partyHeal: 0 },
};

/**
 * The **Cook** (D71, renamed from Chef) — the camp-support non-combat class. Its value is
 * **recovery**, as a food-economy anchor + two meal verbs (the non-combat 2+1):
 * - **Field Kitchen** (presence) — a Cook lowers the party's **Food upkeep** (`upkeep.food`, D15):
 *   cheaper food, and a cheaper Cook Stew.
 * - **Cook Stew** (active) — spend the day's food → bank Rest Points + satisfy the Food line.
 * - **Feast** (active) — a big morale lift before a hard fight.
 * Recovery is now **active** (cook to bank RP), so the passive `restPoints` is a small floor (D71).
 */
export const COOK: JobDef = {
  id: "cook",
  name: "Cook",
  description: "Camp-support: keeps the party fed cheaply, cooks the day's food into recovery, and rallies morale.",
  restPoints: 1, // a small floor — the Cook's recovery is now active (Cook Stew banks RP)
  upkeep: { food: 1 }, // Field Kitchen — the Cook lowers the per-unit food cost (D15)
  skills: [COOK_STEW, FEAST],
};

/** Merchant kit pacing (D70) — once-per-node verbs; magnitudes are a numbers-pass concern. */
export const MERCHANT_KIT = { findTradeUsesPerNode: 1, savvyBarterUsesPerNode: 1 } as const;

/**
 * **Find Trade** (D70) — the Merchant's ACCESS verb: drum up an **impromptu market** at a
 * barren (`none`) node so the caravan can trade where there'd be none. Reframes D61's old
 * always-on `merchantFloor` into a **paid action** (access costs a turn): the `openMarket`
 * effect sets a per-node flag {@link "./overworld".effectiveMarketTier} folds in (a `poor`
 * market for the node-step, cleared on Break Camp). Surfaced via `availableSkills` (D67/D72).
 */
export const FIND_TRADE: SkillDef = {
  id: "find-trade",
  name: "Find Trade",
  description: "Drum up an impromptu market here — trade at a poor market even where there is none (this node).",
  phase: "meta",
  target: "self",
  range: 0,
  spend: "act",
  overworldCost: { usesPerNode: MERCHANT_KIT.findTradeUsesPerNode },
  effect: { kind: "openMarket" },
};

/**
 * **Savvy Barter** (D70) — the Merchant's bargaining verb: the **next single deal** goes its
 * way (a buy at half price *or* a sale at +25%, whichever comes first). The `primeDeal` effect
 * sets a one-shot flag {@link "./economy-actions".merchantBuy}/{@link "./economy-actions".merchantSell}
 * consume on the next trade. Paced (once per node) — a timed treat, not a standing aura (D61).
 */
export const SAVVY_BARTER: SkillDef = {
  id: "savvy-barter",
  name: "Savvy Barter",
  description: "Drive a hard bargain — your next deal is a buy at half price or a sale at +25%.",
  phase: "meta",
  target: "self",
  range: 0,
  spend: "act",
  overworldCost: { usesPerNode: MERCHANT_KIT.savvyBarterUsesPerNode },
  effect: { kind: "primeDeal" },
};

/**
 * The **Merchant** — the trade-broker (D70, the first non-combat verb-kit). Its value is the
 * **economy**, as a presence anchor + two overworld verbs (the non-combat 2+1):
 * - **Appraisal** (presence) — a fielded Merchant lifts every *existing* market one tier
 *   ({@link "./overworld".effectiveMarketTier} reads `presence.marketTierBonus`); it does not
 *   conjure a market on a barren node (that's Find Trade).
 * - **Find Trade** (active) — open an impromptu `poor` market at a barren node (access as a paid action).
 * - **Savvy Barter** (active) — the next deal goes its way (½ buy / +¼ sale).
 * Raw Buy/Sell stay **universal** (market-gated, not job-gated); the Merchant still levels from
 * brokering a sale ({@link "./economy-actions".merchantSell}). Still **noncombat** (camp verbs only).
 */
export const MERCHANT: JobDef = {
  id: "merchant",
  name: "Merchant",
  description: "Works the economy: appraises markets, drums up trade anywhere, and drives a hard bargain.",
  presence: { marketTierBonus: 1 }, // Appraisal — lifts an existing market one tier
  skills: [FIND_TRADE, SAVVY_BARTER],
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
  // Renown (D71/D72): the Noble's presence accrues Influence each node-step — the standing
  // anchor as data, read by accrueDeclaredFaucets in breakCamp (mirrors ECONOMY.noble.incomePerStep = 1).
  faucet: { influencePerStep: 1 },
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

/** The Assassin's Subtle Blade opening-strike bonus (D68) — tunable. */
export const SUBTLE_BLADE_BONUS = 8;
/** The job-level floor a Scout must reach before a prestige branch opens (D68). */
export const SCOUT_PRESTIGE_FLOOR = 5;

/**
 * **Recon** (D74) — the Scout's combat/deployment *dart*: +3 tiles (the old Dash) to reach
 * a flank or infiltrate deep, where Quiet Footsteps' net-evasion compounds. Context derives
 * to pre-combat + combat from its `status` effect. The Scout's **L2 growth** (its combat kit
 * is already up at L1). Its former overworld face is now the standalone {@link SURVEY} — one
 * ability per context reads cleaner than a two-faced verb (D74 revisited).
 */
export const RECON: SkillDef = {
  id: "recon",
  name: "Recon",
  description: "Break for a flank — dart +3 tiles, slipping the net deeper pre-combat.",
  phase: "battle",
  target: "self", // combat/deploy: dart self. Context derives to pre-combat + combat.
  range: 0,
  spend: "move",
  unlockLevel: 2, // the Scout's L2 growth (D74) — Set Trap holds L1.
  effect: { kind: "status", status: swift(1, 3) }, // the dart (was Dash).
};

/**
 * **Survey** (D74) — the Scout's overworld field-craft: scout a node on the road ahead to
 * sharpen its banded intel (raise its preview tier, D24/D48). A standalone overworld ability
 * — its `survey` effect derives the `overworld` context — gated to the Scout's **L2 growth**,
 * the same tier the {@link RECON} dart unlocks. Aims at a *map node* via the action's
 * `targetNodeId` opt. (Split from Recon: the 2+1 kit budget is the *combat* baseline, and
 * context-specific utility like this sits outside it rather than overloading a combat verb.)
 */
export const SURVEY: SkillDef = {
  id: "survey",
  name: "Survey",
  description: "Scout a node on the road ahead — sharpen its intel and see a step past it.",
  phase: "meta",
  target: "camp",
  range: 0,
  spend: "act",
  unlockLevel: 2, // matches the Scout's L2 growth (was Recon's overworld face).
  // D80: a heavy effort skill (≈4 — one Survey tips a fresh Scout into the first fatigue band,
  // wiped by the next arrival) on a short cooldown (1 — ready again by the next night). Numbers
  // illustrative; the structure is canon.
  overworldCost: { cooldown: 1, fatigue: 4 },
  effect: { kind: "survey", tierBump: 1 },
};

/** The **Scout** — infiltrator / flank engine; manufactures isolation, slips the net, weakens the approach. */
export const SCOUT_JOB: JobDef = {
  id: "scout",
  name: "Scout",
  description: "Infiltrator & field-craft: range deep unseen, plant weakening traps, and strike from isolation.",
  passives: { [PASSIVE.quietFootsteps]: 1 },
  baseline: { speed: 14, maxHp: 24, attack: 9, defense: 2, moveRange: 5, sightRadius: 6, attackRange: 1 },
  growth: { speed: 2, moveRange: 1 },
  skills: [
    {
      // Field-craft: the fast infiltrator plants (and, holding a trap skill, disarms) traps.
      // The Scout's trap **Exposes** its prey — weakening the approach and still setting up the
      // Hunter's Deadeye (Exposed is a debuff). **L1 (D74)** — the fun starter (gated only on
      // carrying a trap-kit); the Scout fields its full combat kit from the start.
      id: "set-snare",
      name: "Set Trap",
      description: "Plant a trap in Deployment: 8 damage and Exposes the first enemy onto it (it takes +damage; sets up Deadeye).",
      phase: "deployment",
      target: "camp",
      range: 0,
      spend: "act",
      effect: { kind: "placeTrap", damage: 8, status: exposed(2) },
    },
    // The Scout's L2 growth (D74), split by context: Recon darts in battle/deployment,
    // Survey scouts a node on the overworld — one ability per surface, not a two-faced verb.
    RECON,
    SURVEY,
  ],
  // The fork (D68): a Scout that grinds to the floor and meets a branch trigger may
  // prestige in place. The Assassin is the lethal payoff of the flank identity.
  prestige: [
    {
      into: "assassin",
      when: {
        kind: "all",
        of: [
          { kind: "jobLevel", job: "scout", min: SCOUT_PRESTIGE_FLOOR },
          { kind: "remembers", flag: "assassin-mentor" },
        ],
      },
    },
    {
      into: "thief",
      when: {
        kind: "all",
        of: [
          { kind: "jobLevel", job: "scout", min: SCOUT_PRESTIGE_FLOOR },
          { kind: "remembers", flag: "thieves-guild-invite" },
        ],
      },
    },
  ],
};

/**
 * **Hidden Passage** (D68) — the shared spine of the Scout's prestige fork: both the
 * Assassin and the Thief vanish to operate unseen. Combat-only (the closing net doesn't
 * "see", so Stealth has no pre-combat use).
 */
const HIDDEN_PASSAGE: SkillDef = {
  id: "hidden-passage",
  name: "Hidden Passage",
  description: "Vanish — gain Stealth until your next turn: the enemy can't see or target you unless they stand adjacent.",
  phase: "battle",
  target: "self",
  range: 0,
  spend: "act",
  usableContext: ["combat"],
  effect: { kind: "status", status: stealth(1) },
};

/**
 * The **Assassin** (D68) — the Scout's lethal prestige: an unseen blade that opens on the
 * fresh and cripples the key target. Spine = Hidden Passage (Stealth); replaces Quiet
 * Footsteps → Subtle Blade and the field-craft → Surgical Precision.
 */
export const ASSASSIN_JOB: JobDef = {
  id: "assassin",
  name: "Assassin",
  description: "Unseen blade: vanish, open on a fresh target for a heavy strike, then cripple it.",
  passives: { [PASSIVE.subtleBlade]: SUBTLE_BLADE_BONUS },
  baseline: { speed: 15, maxHp: 22, attack: 12, defense: 1, moveRange: 5, sightRadius: 6, attackRange: 1 },
  growth: { attack: 2, speed: 1 },
  skills: [
    HIDDEN_PASSAGE,
    {
      // The cripple: a precise strike that leaves the prey Exposed AND Immobilized (the
      // multi-rider onHit). The L2 payoff.
      id: "surgical-precision",
      name: "Surgical Precision",
      description: "A precise strike (+3 damage) that leaves the foe Exposed and Immobilized until after its next turn.",
      phase: "battle",
      target: "enemy",
      range: 1,
      spend: "act",
      unlockLevel: 2,
      effect: { kind: "damage", bonusAttack: 3, onHit: [exposed(2), immobilized(2)] },
    },
  ],
};

/**
 * The **Thief** (D68) — the Scout's utility prestige: an unseen hand that works the node
 * economy and the locks. The non-combat-leaning branch (D65 emergent non-combat) — its
 * value is **verbs** (Deft Hands node-gold, Expert Lockpick disarm/pick), not a battle
 * kit. Spine = Hidden Passage (Stealth). `passives: {}` is intentional: it clears the
 * Scout's Quiet Footsteps on prestige (the Thief's anchor is economic, not combat).
 */
export const THIEF_JOB: JobDef = {
  id: "thief",
  name: "Thief",
  description: "Unseen hand: vanish, skim coin off the road, and pick the locks others can't.",
  passives: {},
  lockpick: true, // Expert Lockpick: disarm spotted traps + pick locks (read by canDisarm)
  baseline: { speed: 14, maxHp: 22, attack: 7, defense: 2, moveRange: 5, sightRadius: 6, attackRange: 1 },
  growth: { speed: 1, moveRange: 1 },
  skills: [HIDDEN_PASSAGE],
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
 * The universal **Dig In** (D63/D67): a deployment-only brace — hunker for a far lower
 * capture chance when the net closes, at the cost of the turn. Mirrors {@link DEFEND} as a
 * universal capability surfaced for every unit (not on any job), but **pre-combat only**
 * (`usableContext`). It *executes* via the `digIn` CombatAction verb (which sets
 * `Unit.dugIn`); the status here is descriptive, for surfacing + forecast.
 */
export const DIG_IN: SkillDef = {
  id: "dig-in",
  name: "Dig In",
  description: "Hunker on this tile — far lower capture chance when the net closes, at the cost of this turn.",
  phase: "deployment",
  target: "self",
  range: 0,
  spend: "act",
  usableContext: ["pre-combat"],
  effect: { kind: "status", status: { id: "dug-in", name: "Dug In", duration: 1, kind: "buff" } },
};

/**
 * The universal capabilities surfaced for every unit (D67) — folded into {@link
 * "./leveling".availableSkills} so the combat and pre-combat rows are one projection (no
 * hardcoded Defend append, no `canTrap` special case).
 */
export const UNIVERSAL_SKILLS: readonly SkillDef[] = [DEFEND, DIG_IN];

/**
 * The job registry — the single source jobs are loaded from. Written with literal
 * keys (not `[SOLDIER.id]`) so the keys survive into the type and {@link JobId} can
 * derive from them; `satisfies` still type-checks every value as a {@link JobDef}.
 */
export const JOBS = {
  soldier: SOLDIER,
  survivalist: SURVIVALIST,
  cook: COOK,
  merchant: MERCHANT,
  noble: NOBLE,
  banker: BANKER,
  "heavy-knight": HEAVY_KNIGHT,
  hunter: HUNTER,
  scout: SCOUT_JOB,
  assassin: ASSASSIN_JOB,
  thief: THIEF_JOB,
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
