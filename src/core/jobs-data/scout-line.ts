/**
 * Scout-line job records (D68/D74) — the Scout and its prestige fork, as data.
 *
 * Split out of `jobs.ts` (R3, #130): the **Scout** (infiltrator / flank engine)
 * with its {@link RECON} dart + {@link SURVEY} field-craft, the prestige fork's
 * shared {@link HIDDEN_PASSAGE} spine, the **Assassin** and **Thief** prestige
 * jobs, and the fork tuning ({@link SUBTLE_BLADE_BONUS}, {@link SCOUT_PRESTIGE_FLOOR}).
 * The `jobs.ts` engine imports these to assemble {@link "./jobs".JOBS}. Pure code
 * motion: behaviour unchanged.
 *
 * Pure logic: no Phaser, no DOM.
 */

import type { JobDef } from "../jobs";
import type { SkillDef } from "../skills";
import { PASSIVE } from "../combat";
import { exposed, swift, immobilized, stealth } from "../status";

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
      target: "camp",
      range: 0,
      spend: "act",
      cost: { material: { id: "trap-kit", count: 1 } }, // consumes a carried kit (#113 material price)
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
