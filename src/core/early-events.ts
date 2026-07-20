/**
 * Early events — the arrival layer + the gated encounter-bypass (D80).
 *
 * Split out of `node-events.ts` (R3, #119): a light event on the road *before* a
 * node's main encounter, decoupled from node-kind, plus the tailored node-bound
 * events (The Blockade) and the bypass economy. Pure code motion: behaviour
 * unchanged. The random pool reuses the node-event registry records by id
 * ({@link "./node-events".mustGetEvent}); the standing weighting rides the same
 * {@link "./node-events".eventWeightAt} the node pick uses.
 *
 * Pure logic: no Phaser, no DOM.
 */

import type { RunState } from "./run";
import type { MapNode } from "./overworld";
import { streamFor } from "./rng";
import { Labels } from "./rng-labels";
import { influenceTier, type InfluenceTier } from "./economy";
import { spend } from "./purse-journal";
import { rankOf } from "./num";
import {
  emptyOutcome,
  mustGetEvent,
  eventWeightAt,
  INFLUENCE_ORDER,
  type EventDef,
  type EventOutcome,
} from "./node-events";

// --- Early events: the arrival layer (D80) ----------------------------------

/**
 * The **early-event** tuning (D80) — a light event on the road *before* a node's main encounter,
 * decoupled from node-kind. **Occasional, never every node** (the D16/D35 anti-agony stance).
 * This first cut draws from the **random, node-agnostic pool** (reusing existing texture events);
 * tailored node-bound events + the gated encounter-bypass are a follow-up.
 */
export const EARLY_EVENT = {
  /** Per-node chance an early event fires on the road (illustrative — the structure is canon). */
  chance: 0.3,
  /**
   * The random pool (D80): auto-resolving texture events reused as arrival-layer beats — the
   * *pickpocket* (thief) and the standing-gated *patron* welcome. Interactive ones (a roadside
   * market trade) and tailored node-bound events extend this later.
   */
  pool: ["thief", "patron-welcome"] as const,
} as const;

/**
 * The **early event** a node hosts on the road (D80), or `null` for the common no-event case — a
 * deterministic, occasional pick from the random pool off `streamFor(seed, "early:<nodeId>")` (a
 * distinct stream from the node-event pick, so the two never collide). Skipped on **event** nodes
 * (they already run an event as their main content) and on **authored/pinned** nodes (their beat
 * stays hand-built). Standing-weighted like the node pick, so a gated boon (patron) only appears
 * once the party's Influence has earned it.
 */
export function earlyEventForNode(run: RunState, node: MapNode): EventDef | null {
  if (node.kind === "event" || node.eventId) return null;
  // A tailored, node-bound event (rare, high-impact) takes precedence over the random pool (D80).
  const tailored = tailoredEarlyEventFor(run, node);
  if (tailored) return tailored;
  const rng = streamFor(run.seed, Labels.early(node.id));
  if (!rng.chance(EARLY_EVENT.chance)) return null; // the common case — a quiet road
  const tier = influenceTier(run.overworld.influence);
  const pool = EARLY_EVENT.pool.map(mustGetEvent).filter((e) => eventWeightAt(e, tier) > 0);
  if (pool.length === 0) return null;
  return rng.pickWeighted(pool, (e) => eventWeightAt(e, tier));
}

/** Resolve an early event (D80) — applies its {@link EventDef.autoResolve} to the run and returns the outcome. */
export function resolveEarlyEvent(run: RunState, node: MapNode, def: EventDef): EventOutcome {
  return def.autoResolve(run, node);
}

// --- Tailored early events + the gated encounter-bypass (D80) ----------------

/** Tailored-event / bypass tuning (D80) — all illustrative, the structure is canon. */
export const BYPASS = {
  /** How rare a tailored event is on an eligible (non-final combat) node. */
  chance: 0.18,
  /** Passage fee = base + layer × perLayer (a deeper blockade demands more). */
  feeBase: 30,
  feePerLayer: 15,
  /** The standing floor to be *offered* passage at all (a stranger gets no parley). */
  floor: "respected" as InfluenceTier,
  /** Bypass EXP per member = base + layer × perLayer — solid, but below a won fight (never strictly better). */
  xpBase: 20,
  xpPerLayer: 5,
} as const;

/** The passage fee to bypass a node's encounter (D80) — scales with map depth. */
export function bypassFee(node: MapNode): number {
  return BYPASS.feeBase + node.layer * BYPASS.feePerLayer;
}

/** The flat EXP each member keeps for bypassing a node's encounter (D80). */
export function bypassXp(node: MapNode): number {
  return BYPASS.xpBase + node.layer * BYPASS.xpPerLayer;
}

/**
 * **The Blockade** (D80) — the first tailored node-bound event: a hostile force bars the road at a
 * combat node. **Cut through** (decline → the encounter proceeds as normal, full loot), or **buy
 * passage** — gated on gold *and* an Influence floor, and **forgoing the loot**: you keep your HP
 * and the EXP but not the plunder (the {@link EventOutcome.bypass} short-circuits the fight). Never
 * strictly better than fighting — a situational call tied to the recovery economy.
 */
export const BLOCKADE: EventDef = {
  id: "blockade",
  kind: "toll", // a pay-to-pass fee — reuses the toll kind rather than minting a new one
  name: "The Blockade",
  teaser: "A blockade bars the road — cut through, or buy passage (gold + standing, but no plunder).",
  weight: 1,
  autoResolve(_run, _node) {
    // Headless / decline default: cut through — the encounter proceeds (no bypass, deterministic).
    return emptyOutcome("toll", "The caravan cut through the blockade.");
  },
  choices(run, node) {
    const fee = bypassFee(node);
    const canAfford = run.camp.gold >= fee;
    const standing = influenceTier(run.overworld.influence);
    const earned = rankOf(INFLUENCE_ORDER, standing) >= rankOf(INFLUENCE_ORDER, BYPASS.floor);
    return [
      {
        id: "pay",
        label: `Buy passage (${fee}g · needs ${BYPASS.floor})`,
        cost: fee,
        available: canAfford && earned,
        detail: !earned
          ? `Your standing isn't enough — needs ${BYPASS.floor}.`
          : !canAfford
            ? `Not enough purse gold (${fee}g).`
            : "Skip the fight: keep your HP and the EXP, but forgo the loot.",
      },
      { id: "fight", label: "Cut through", available: true, detail: "Take the encounter as normal — full loot." },
    ];
  },
  choose(run, node, choiceId) {
    if (choiceId === "pay") {
      const fee = bypassFee(node);
      spend(run.camp, fee, "toll", `Passage @ ${node.id}`, { nodeId: node.id, night: run.night });
      const out = emptyOutcome("toll", `Bought passage for ${fee}g — the fight is skipped, the plunder forgone.`);
      out.goldDelta = -fee;
      out.bypass = true; // the scene short-circuits the encounter (grants the bypass EXP, records the night)
      return out;
    }
    return emptyOutcome("toll", "The caravan cut through the blockade.");
  },
};

/** The tailored events, keyed by eligibility. Currently just {@link BLOCKADE}; authored maps pin more. */
const TAILORED_EVENTS: readonly EventDef[] = [BLOCKADE];

/**
 * The **tailored** early event a node hosts (D80), or `null` — a rare, deterministic pick off
 * `streamFor(seed, "tailored:<nodeId>")` (a distinct stream from both the node-event and the random
 * early-event picks). Only **non-final combat** nodes are eligible: a bypass skips a *fight*, and
 * the final node is the objective (never skippable). High-impact and rare, so it takes precedence
 * over the random pool when it fires.
 */
export function tailoredEarlyEventFor(run: RunState, node: MapNode): EventDef | null {
  if (node.kind !== "combat") return null;
  if (node.layer >= run.map.layers - 1) return null; // the final node is never bypassable
  const rng = streamFor(run.seed, Labels.tailored(node.id));
  if (!rng.chance(BYPASS.chance)) return null;
  return rng.pick(TAILORED_EVENTS);
}
