/**
 * Combat job records (M12 combat-depth roster, D40) — authored job data.
 *
 * Split out of `jobs.ts` (R3, #130): the five combat classes — the **Soldier**
 * (formation anchor, D66), the **Heavy Knight** (space-control bruiser), the
 * **Hunter** (ranged prey-hunter), the **Medic** (sustain backbone), and the
 * **Snare-Trapper** (D42 enemy debuffer) — plus their shared {@link KIT} tuning
 * block. The `jobs.ts` engine imports these to assemble {@link "./jobs".JOBS} and
 * derive the {@link "./jobs".SKILLS} registry. Pure code motion: behaviour unchanged.
 *
 * Pure logic: no Phaser, no DOM.
 */

import type { JobDef } from "../jobs";
import { PASSIVE } from "../combat";
import { exposed, swift, immobilized } from "../status";

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
export const SOLDIER_JOB: JobDef = {
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
export const HEAVY_KNIGHT_JOB: JobDef = {
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
export const HUNTER_JOB: JobDef = {
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

/** The **Medic** — sustain backbone & clock-manager; its game is timing. */
export const MEDIC_JOB: JobDef = {
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
export const SNARE_TRAPPER_JOB: JobDef = {
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
