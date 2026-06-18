/**
 * Intel (D10) — banded pre-battle knowledge via three lanes.
 *
 * You provision **blind-ish**; intel lifts the fog. It is **per-encounter,
 * party-wide, and banded** into tiers separated by breakpoints:
 *
 *   Tier 1 — **types** (what to pack) → Tier 2 — **numbers** (what to counter) →
 *   Tier 3 — **positions** (exactly how to deploy).
 *
 * Three complementary lanes climb the ladder:
 *   1. **Passive** — the **Intelligence** stat sets a free floor.
 *   2. **Scouting** — spend gold/a ration to buy a tier (risk lane omitted here).
 *   3. **Divination** — the **Seer** jumps a breakpoint (reagent) or, at master
 *      rank, reads free with a chance to jump multiple.
 *
 * A **Tier-3** read grants **starting vision** of the enemy's deployment, bridging
 * to the in-battle fog-of-war seam (D18) — surfaced here as a flag the runloop
 * wires to vision.
 *
 * Pure logic: no Phaser, no DOM.
 */

import type { Unit } from "./units";
import type { Rng } from "./rng";
import { getEnemyTemplate, type EncounterType } from "./generation";
import { getNode, type NodeKind } from "./overworld";
import { eventForNode } from "./node-events";
import { runEncounter, type RunState } from "./run";
import { isAuthoredEncounter, type EncounterSource } from "./staging";

/** Banded intel tier (D10). 0 = nothing known. */
export type IntelTier = 0 | 1 | 2 | 3;

/** The highest, position-revealing tier — grants starting vision (D18). */
export const MAX_TIER: IntelTier = 3;

/** What an intel read reveals about an encounter, gated by tier. */
export interface IntelReport {
  tier: IntelTier;
  /** Tier ≥ 1: the *kinds* of enemies present. */
  types?: string[];
  /** Tier ≥ 2: how *many*. */
  count?: number;
  /** Tier ≥ 3: *where* they start. */
  positions?: { name: string; col: number; row: number }[];
  /** Tier 3 ⇒ true: the party starts the battle seeing enemy deployment (D18). */
  grantsVision: boolean;
}

/** Intelligence breakpoints → the free passive floor tier (D10 banding). */
export const INTEL_BREAKPOINTS: readonly { minIntelligence: number; tier: IntelTier }[] = [
  { minIntelligence: 9, tier: 3 },
  { minIntelligence: 6, tier: 2 },
  { minIntelligence: 3, tier: 1 },
  { minIntelligence: 0, tier: 0 },
];

/**
 * Lane 1 — the passive **Intelligence** floor (D10): the free baseline tier the
 * party reads, from its highest-Intelligence member.
 */
export function intelFloor(party: readonly Unit[]): IntelTier {
  const best = party.reduce((m, u) => Math.max(m, u.intelligence ?? 0), 0);
  for (const bp of INTEL_BREAKPOINTS) {
    if (best >= bp.minIntelligence) return bp.tier;
  }
  return 0;
}

/** Clamp any number into a valid {@link IntelTier}. */
export function clampTier(t: number): IntelTier {
  return Math.max(0, Math.min(MAX_TIER, Math.round(t))) as IntelTier;
}

/**
 * Lane 2 — **scouting**: spend a resource to raise the read one tier (D10). The
 * caller owns the gold/ration cost; this just bumps the tier.
 */
export function scout(tier: IntelTier): IntelTier {
  return clampTier(tier + 1);
}

/**
 * Lane 3 — **divination** via the Seer (D10). Low rank spends a reagent to jump
 * **one** breakpoint (reliable). Master rank reads **free** with a chance to jump
 * **multiple** breakpoints (a variable windfall). Returns the new tier; pulls its
 * jump from the run's deterministic `rng`.
 */
export function seerDivine(tier: IntelTier, rng: Rng, masterRank = false): IntelTier {
  if (!masterRank) return clampTier(tier + 1); // reagent: reliable +1
  const jump = rng.chance(0.4) ? 2 : 1; // free, occasionally doubles
  return clampTier(tier + jump);
}

/**
 * Read an encounter at a given tier (D10): reveal types → numbers → positions as
 * the tier rises. Tier 3 sets `grantsVision`. Pure projection of the (already
 * deterministic) encounter — adds no randomness.
 */
export function readEncounter(def: EncounterSource, tier: IntelTier): IntelReport {
  // Normalize either source's enemies to `{ name, col, row }` (D49) — authored
  // placements read their template's name. A hidden ambush body stays unread
  // until you've scouted to **full** positional intel (tier 3): at that point you
  // spotted the trap, so it appears in the read and is no longer a battle surprise
  // (the mechanical reveal happens in staging — see `revealHidden`).
  const revealAmbush = tier >= MAX_TIER;
  const enemies = isAuthoredEncounter(def)
    ? def.enemies
        .filter((p) => !p.hidden || revealAmbush)
        .map((p) => ({
          name: getEnemyTemplate(p.templateId)?.name ?? p.templateId,
          col: p.pos.col,
          row: p.pos.row,
        }))
    : def.enemies.map((e) => ({ name: e.name ?? e.id, col: e.pos.col, row: e.pos.row }));

  const report: IntelReport = { tier, grantsVision: tier >= MAX_TIER };
  if (tier >= 1) report.types = [...new Set(enemies.map((e) => e.name))];
  if (tier >= 2) report.count = enemies.length;
  if (tier >= 3) report.positions = enemies;
  return report;
}

/**
 * The deployment edge scouting buys (D10 teeth). Knowing enemy strength and
 * position lets you set up deeper before you're exposed — a wider safe depth and
 * a lower exposure multiplier, scaling with the intel tier you've earned. Folds
 * in alongside the morale deploy bonus (D8) at the placement seam.
 */
export function intelDeployBonus(tier: IntelTier): { safeDepthBonus: number; exposureMultiplier: number } {
  return {
    safeDepthBonus: tier >= 3 ? 2 : tier >= 2 ? 1 : 0,
    exposureMultiplier: tier >= 3 ? 0.75 : tier >= 2 ? 0.85 : tier >= 1 ? 0.95 : 1,
  };
}

// --- Node pre-selection preview (D24, the overworld) ------------------------

/** Coarse reward bands, by gold (the Tier-1 reward hint, D24). */
export const REWARD_BANDS: readonly { min: number; label: string }[] = [
  { min: 140, label: "rich" },
  { min: 80, label: "good" },
  { min: 0, label: "modest" },
];

/** The reward band label for a gold figure. */
export function rewardBand(gold: number): string {
  for (const b of REWARD_BANDS) if (gold >= b.min) return b.label;
  return REWARD_BANDS[REWARD_BANDS.length - 1].label;
}

/**
 * A banded reward hint, gated by intel tier (D24): Tier 0 reveals nothing, Tier 1
 * a coarse **band**, Tier 2 an **approximate** figure, Tier 3 the **exact** gold.
 */
export function rewardHint(gold: number, tier: IntelTier): string | undefined {
  if (tier <= 0) return undefined;
  if (tier === 1) return rewardBand(gold);
  if (tier === 2) return `~${Math.round(gold / 10) * 10}g`;
  return `${gold}g`;
}

/** What the overworld shows about a candidate node before the player commits. */
export interface NodePreview {
  nodeId: string;
  kind: NodeKind;
  layer: number;
  /** Combat only: the encounter shape — **always** shown (D24). */
  encounterType?: EncounterType;
  /** Combat only: the banded intel read at the party's floor (+ any bump). */
  intel?: IntelReport;
  /** Combat only: a banded reward hint (see {@link rewardHint}). */
  rewardHint?: string;
  /** Rest only: a recovery hint (no enemies to read). */
  restHint?: string;
  /** Event only (M10): a hazard hint — the thief event skims the purse (D30). */
  eventHint?: string;
}

/**
 * Preview a reachable map node for the selection screen (D24, extends D10). The
 * node **kind** is always shown; for a **combat** node its **encounter type** is
 * always shown, and the party's **intel floor** reveals more about its
 * contents — banded exactly as {@link readEncounter} (types → numbers →
 * positions) — plus a banded {@link rewardHint}. A **rest** node previews a
 * recovery hint. A pure projection of the seed-built map + the deterministic
 * per-node encounter + the party's floor, so previews are **stable for a seed**
 * (no live RNG). `extraTier` models a bought/divined bump over the floor.
 */
export function previewNode(run: RunState, nodeId: string, extraTier = 0): NodePreview {
  const node = getNode(run.map, nodeId);
  const preview: NodePreview = { nodeId, kind: node.kind, layer: node.layer };
  if (node.kind === "rest") {
    preview.restHint = "A safe camp — rest and recover. No fight.";
    return preview;
  }
  if (node.kind === "event") {
    // The banded teaser of whichever event this node runs (M11, D24) — stable for
    // a seed, since the event is a deterministic per-node pick.
    preview.eventHint = eventForNode(run.seed, node).teaser;
    return preview;
  }
  const def = runEncounter(run, node);
  // An authored encounter has no procedural shape (D49); leave the type unshown.
  preview.encounterType = isAuthoredEncounter(def) ? undefined : def.type;
  const tier = clampTier(intelFloor(run.party) + extraTier);
  preview.intel = readEncounter(def, tier);
  preview.rewardHint = rewardHint(def.reward.gold, tier);
  return preview;
}
