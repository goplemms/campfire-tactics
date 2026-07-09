/**
 * Support / economy job records (D70–D73) — the non-combat classes, as data.
 *
 * Split out of `jobs.ts` (R3, #130): the **Survivalist** (field-craft + {@link FORAGE}),
 * the **Cook** (recovery + {@link COOK_STEW}/{@link FEAST}), the **Merchant** (trade,
 * {@link FIND_TRADE}/{@link SAVVY_BARTER}), the **Noble** and **Banker** (the standing /
 * purse economies), their kit tuning blocks, and the {@link UNIVERSAL_SKILLS} every unit
 * carries ({@link DEFEND}/{@link DIG_IN}). The `jobs.ts` engine imports these to assemble
 * {@link "./jobs".JOBS} and derive the {@link "./jobs".SKILLS} registry. Pure code motion:
 * behaviour unchanged.
 *
 * The Cook Stew's computed cost keeps the lazy {@link computeUpkeep} import (a closure-only
 * reference — no init-time cycle), the one cyclic edge preserved from the original file.
 *
 * Pure logic: no Phaser, no DOM.
 */

import type { JobDef } from "../jobs";
import type { SkillDef } from "../skills";
import { guarded } from "../status";
import { computeUpkeep } from "../upkeep"; // Cook Stew's computed cost (lazy — closure only, no init-time cycle)

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
export const SURVIVALIST_JOB: JobDef = {
  id: "survivalist",
  name: "Survivalist",
  description: "Field-craft specialist: lays traps before the fight, and forages supplies at a clearing.",
  restPoints: 1,
  skills: [
    {
      id: "set-trap",
      name: "Set Trap",
      description: "Place a trap that deals 12 damage to the first enemy onto it.",
      target: "camp",
      range: 0,
      spend: "act",
      cost: { material: { id: "trap-kit", count: 1 } }, // consumes a carried kit (#113 material price)
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
export const COOK_JOB: JobDef = {
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
/**
 * **Merchant Sell** (D61/#112, R4/A) — the Merchant's honest gold faucet: convert one carried
 * good into purse gold at the node's effective market tier (goods → gold). Cost is **selfLimited**
 * (the carried stock is the limiter — you can't sell what you don't carry), the escape hatch the
 * two-axis menu declares for exactly this shape. The verb {@link "./economy-actions".merchantSell}
 * (still callable market-gated, brokered by a live Merchant for use-XP) reads its cost + effect
 * from this record; the `sell` effect body is {@link "./economy-actions".applySellEffect}.
 */
export const MERCHANT_SELL: SkillDef = {
  id: "merchant-sell",
  name: "Merchant Sell",
  description: "Sell a carried good for purse gold at the node's market — the Merchant's honest goods → gold faucet.",
  target: "self",
  range: 0,
  spend: "act",
  overworldCost: { selfLimited: true },
  effect: { kind: "sell" },
};

export const MERCHANT_JOB: JobDef = {
  id: "merchant",
  name: "Merchant",
  description: "Works the economy: appraises markets, drums up trade anywhere, and drives a hard bargain.",
  presence: { marketTierBonus: 1 }, // Appraisal — lifts an existing market one tier
  skills: [FIND_TRADE, SAVVY_BARTER, MERCHANT_SELL],
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
/** Patronize's gold price — a literal mirroring `ECONOMY.noble.patronizeCost` (=12). */
const PATRONIZE_GOLD = 12;

/**
 * **Patronize** (D62/#112, R4/A) — the Noble's active Influence faucet: spend purse gold to court
 * patrons (gold → standing), layered on the passive Renown accrual. Two-axis cost: **once per node**
 * × the gold price. Effect body: {@link "./economy-actions".applyPatronizeEffect}; the verb
 * {@link "./economy-actions".patronize} (party-gated on a fielded Noble) reads its cost here.
 */
export const NOBLE_PATRONIZE: SkillDef = {
  id: "patronize",
  name: "Patronize",
  description: "Court patrons — spend purse gold for Influence (gold → standing), once per node.",
  target: "self",
  range: 0,
  spend: "act",
  overworldCost: { usesPerNode: 1, gold: PATRONIZE_GOLD },
  effect: { kind: "patronize" },
};

export const NOBLE_JOB: JobDef = {
  id: "noble",
  name: "Noble",
  description: "Works the standing economy: courts patrons for Influence and sways enemies with bribes.",
  // Renown (D71/D72): the Noble's presence accrues Influence each node-step — the standing
  // anchor as data, read by accrueDeclaredFaucets in breakCamp (mirrors ECONOMY.noble.incomePerStep = 1).
  faucet: { influencePerStep: 1 },
  skills: [NOBLE_PATRONIZE],
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
/** Banker theft-protection cost (D61) — a literal mirroring `ECONOMY.banker.protectionCost` (=25). */
const BANKER_PROTECT_GOLD = 25;

/**
 * **Invest the Purse** (D30/#112, R4/A) — the Banker's TIME-SHIFT verb: engage flat purse interest
 * that accrues each node-step. A toggle, **once per node** (re-armed at Break Camp). Effect body:
 * {@link "./economy-actions".applyEngageInterestEffect}; the verb {@link "./economy-actions".bankerEngageInterest}
 * (party-gated on a fielded Banker) reads its cost here.
 */
export const BANKER_INTEREST: SkillDef = {
  id: "banker-interest",
  name: "Invest the Purse",
  description: "Engage flat purse interest that accrues as the caravan advances — purse only, never the treasury (once per node).",
  target: "self",
  range: 0,
  spend: "act",
  overworldCost: { usesPerNode: 1 },
  effect: { kind: "engageInterest" },
};

/**
 * **Borrow** (D30/#112, R4/A) — the Banker's BUY-ON-DEBT verb: advance gold to the purse now,
 * auto-repaid from incoming run gold. **One loan arrangement per node**. Effect body:
 * {@link "./economy-actions".applyBorrowEffect}; the verb {@link "./economy-actions".bankerBorrow}
 * (party-gated on a fielded Banker) reads its cost here + supplies the amount.
 */
export const BANKER_BORROW: SkillDef = {
  id: "banker-borrow",
  name: "Borrow",
  description: "Overspend now against future loot — advanced to the purse, auto-repaid from incoming run gold (once per node).",
  target: "self",
  range: 0,
  spend: "act",
  overworldCost: { usesPerNode: 1 },
  effect: { kind: "borrow" },
};

/**
 * **Guard the Purse** (D30/#112, R4/A) — the Banker's SECURE verb: buy theft protection, a [0,1)
 * skim reduction that blunts both the mid-battle thief and the thief event node. Gold-priced.
 * Effect body: {@link "./economy-actions".applyGuardPurseEffect}; the verb
 * {@link "./economy-actions".bankerProtect} (party-gated on a fielded Banker) reads its cost here.
 */
export const BANKER_GUARD: SkillDef = {
  id: "banker-protect",
  name: "Guard the Purse",
  description: "Buy theft protection — blunt a thief's skim, battle thief and event node alike (purse only).",
  target: "self",
  range: 0,
  spend: "act",
  overworldCost: { gold: BANKER_PROTECT_GOLD },
  effect: { kind: "guardPurse" },
};

export const BANKER_JOB: JobDef = {
  id: "banker",
  name: "Banker",
  description: "Works the purse economy: interest on the carried purse, loans against future loot, and theft protection.",
  skills: [BANKER_INTEREST, BANKER_BORROW, BANKER_GUARD],
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
