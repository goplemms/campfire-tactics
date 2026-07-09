/**
 * The route forecast (D48) — the load-bearing half of the economic ledger (D45).
 *
 * The ledger asked *"this route + a rest at the end → purse at the bottom."*
 * Grounding it in the data exposed the governing fact: **cost is knowable, income
 * is fogged.** Upkeep ({@link "./upkeep".computeUpkeep}) is exact; loot
 * (`def.reward.gold`) is only ever seen **banded by intel tier** ({@link
 * "./intel".rewardHint}). So the forecast can't be a precise number without leaking
 * what intel hides — which *defines* its shape:
 *
 * - **Burn** = `upkeep × steps + visible node fees` — the deterministic cost
 *   backbone (upkeep *is* the travel cost, D28; tolls are the only extra, known
 *   ahead and routed-around, {@link "./node-events".nodeFee}).
 * - **Loot** = a **fogged range**, tightened by intel tier and **never revealed
 *   beyond the player's tier** (no fog-leak). Rest nodes earn nothing (cost-only).
 * - **Warning** fires on the **pessimistic** (low-band) loot floor — so it never
 *   reassures on gold you might not get — and **clears as intel raises the floor**
 *   (scouting a node can lift its warning; the asymmetric-floor ethos, D8/D11/D35).
 * - **Horizon** = one committed step (banded loot) + the runway to the nearest
 *   *visible* rest — not a whole-map projection (deep nodes are fog).
 *
 * A pure projection over the **visible** set ({@link "./fog".visibleNodes}), reusing
 * `computeUpkeep` + the reward bands + the visibility BFS — the `previewNode`
 * pattern one tier up. No live RNG; replayable for a seed.
 *
 * Pure logic: no Phaser, no DOM.
 */

import { runEncounter, type RunState } from "./run";
import {
  reachableFrom,
  getNode,
  type MapNode,
} from "./overworld";
import { computeUpkeep } from "./upkeep";
import { intelFloor, clampTier, REWARD_BANDS, rewardBand, type IntelTier } from "./intel";
import { scoutedTier } from "./overworld-state";
import { nodeFee } from "./node-events";
import { visibleNodes } from "./fog";

/** A fogged, intel-banded loot range for one node (D48). */
export interface LootBand {
  /** The **pessimistic** known floor — the warning evaluates here (never reassures). */
  floor: number;
  /** The optimistic ceiling; `undefined` = unbounded upside (top band / unknown). */
  ceiling?: number;
  /** A human label: a coarse band name, an approximate, or the exact figure. */
  label?: string;
}

/** The forecast for taking one immediately-reachable edge (D48). */
export interface EdgeForecast {
  nodeId: string;
  kind: MapNode["kind"];
  /** Deterministic known cost: one step of Upkeep + this node's visible fee. */
  costKnown: number;
  /** The fogged loot, banded by the player's intel tier on this node. */
  lootBand: LootBand;
  /** The purse after the step: pessimistic floor vs optimistic ceiling. */
  purseAfter: { floor: number; ceiling?: number };
  /** True if the pessimistic floor warns (the step might leave the purse broke). */
  warn: boolean;
}

/** The runway to the nearest *visible* rest (D48) — the deep-planning readout. */
export interface Runway {
  /** Per-step burn = the night's Upkeep total (the deterministic backbone). */
  burnPerStep: number;
  /** Node-steps to the nearest rest node *within the fog*; `undefined` if none visible. */
  nearestRestSteps?: number;
  /** Projected purse on reaching that rest (burn only — the pessimistic runway). */
  purseAtRest?: number;
}

/** The whole route forecast (D48) — embedded by the ledger (D45). */
export interface RouteForecast {
  /** The fog's visible set (the render masks everything else). */
  visibleNodes: MapNode[];
  runway: Runway;
  /** One entry per immediately-reachable edge (the "which edge next" decision). */
  perEdge: EdgeForecast[];
}

/**
 * Band a node's loot by intel `tier` (D48) — **never revealing beyond the tier**:
 * Tier 0 = unknown (floor 0, open upside), Tier 1 = a coarse band, Tier 2 = an
 * approximate, Tier 3 = exact. A pure projection of the (deterministic) reward.
 */
export function lootBandFor(gold: number, tier: IntelTier): LootBand {
  if (tier <= 0) return { floor: 0 }; // fogged income — pessimistic floor, open upside
  if (tier === 1) {
    // Coarse band: floor at this band's lower edge, ceiling at the next edge.
    const asc = [...REWARD_BANDS].sort((a, b) => a.min - b.min);
    let floor = 0;
    let ceiling: number | undefined;
    for (let i = 0; i < asc.length; i++) {
      if (gold >= asc[i].min) {
        floor = asc[i].min;
        ceiling = asc[i + 1]?.min; // undefined for the top ("rich") band
      }
    }
    return { floor, ceiling, label: rewardBand(gold) };
  }
  if (tier === 2) {
    const approx = Math.round(gold / 10) * 10;
    return { floor: Math.max(0, approx - 10), ceiling: approx + 10, label: `~${approx}g` };
  }
  return { floor: gold, ceiling: gold, label: `${gold}g` }; // exact
}

/** The intel tier the forecast reads a node at = passive floor + any Scout bump (D48). */
function nodeTier(run: RunState, node: MapNode): IntelTier {
  return clampTier(intelFloor(run.party) + scoutedTier(run.overworld, node.id));
}

/** A node's fogged loot band: combat = banded reward, rest = nothing, event = unknown. */
function nodeLoot(run: RunState, node: MapNode): LootBand {
  if (node.kind === "combat") {
    const def = runEncounter(run, node);
    return lootBandFor(def.reward.gold, nodeTier(run, node));
  }
  if (node.kind === "rest") return { floor: 0, ceiling: 0, label: "—" }; // cost-only
  return { floor: 0, ceiling: 0 }; // event: skim/cost — conservatively no income
}

/**
 * Node-steps to the nearest **visible** rest node ahead, by BFS over the fog's
 * visible set (D48) — so the runway is intel-gated too (seeing the *third* rest
 * ahead is what intel buys). `undefined` if no rest is visible.
 */
function nearestRestSteps(run: RunState, visibleIds: Set<string>): number | undefined {
  const start = getNode(run.map, run.mapNodeId);
  let frontier: MapNode[] = [start];
  const seen = new Set<string>([start.id]);
  for (let depth = 1; frontier.length > 0; depth++) {
    const next: MapNode[] = [];
    for (const node of frontier) {
      for (const n of reachableFrom(run.map, node.id)) {
        if (seen.has(n.id) || !visibleIds.has(n.id)) continue;
        if (n.kind === "rest") return depth;
        seen.add(n.id);
        next.push(n);
      }
    }
    frontier = next;
  }
  return undefined;
}

/**
 * Project the route forecast over the visible set (D48). Computes, for each
 * immediately-reachable edge, the deterministic cost (one step of burn + the node's
 * visible fee), the intel-banded loot range, the resulting purse floor/ceiling, and
 * a **floor-based** warning; plus the runway to the nearest visible rest. Pure.
 */
export function projectForecast(run: RunState): RouteForecast {
  const visible = visibleNodes(run);
  const visibleIds = new Set(visible.map((n) => n.id));
  const burnPerStep = computeUpkeep(run.party).total;
  const purse = run.camp.gold;

  const perEdge: EdgeForecast[] = reachableFrom(run.map, run.mapNodeId).map((node) => {
    const fee = nodeFee(run.seed, node);
    const costKnown = burnPerStep + fee;
    const lootBand = nodeLoot(run, node);
    const floor = purse - costKnown + lootBand.floor;
    const ceiling =
      lootBand.ceiling === undefined ? undefined : purse - costKnown + lootBand.ceiling;
    return {
      nodeId: node.id,
      kind: node.kind,
      costKnown,
      lootBand,
      purseAfter: { floor, ceiling },
      // Warn on the pessimistic floor: the step might leave the purse broke (D48).
      warn: floor < 0,
    };
  });

  const restSteps = nearestRestSteps(run, visibleIds);
  const runway: Runway = {
    burnPerStep,
    nearestRestSteps: restSteps,
    purseAtRest: restSteps === undefined ? undefined : purse - burnPerStep * restSteps,
  };

  return { visibleNodes: visible, runway, perEdge };
}
