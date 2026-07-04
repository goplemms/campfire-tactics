/**
 * Overworld fog — the **reach** axis of intel (D48).
 *
 * Intel has two independent axes (see [intel](../../docs/design/systems/intel.md)):
 * **depth** (how much you know about a single node — types → numbers → positions,
 * D10/D24, the `previewNode` ladder) and **reach** (how far ahead you can see *at
 * all*). This module is the reach axis: a **pure visibility mask** over the
 * seed-built map.
 *
 * Visibility is a forward BFS from the current node, cut at
 * `base + tier × bandStep` node-steps — **base ≈ half the map** (a *deep-planning*
 * tool, not an early wall), each intel band extending it, tunable to effectively
 * infinite (a large base = full visibility, the safe fallback). Two guardrails: the
 * **immediately-reachable nodes are ALWAYS visible** (you can never be unable to
 * choose — the map-invariant spirit), and the nodes you've **already visited** stay
 * known. Everything beyond the reach limit is fogged.
 *
 * The reach **tier** is the party's passive **Intelligence floor** ({@link
 * "./intel".intelFloor}) — the same floor that bands node previews — so a smarter
 * party plans deeper. The map is fully known internally; the fog adds **no
 * randomness** (no live RNG), so it is fully replayable for a seed (D22/D48).
 *
 * Pure logic: no Phaser, no DOM.
 */

import { intelFloor } from "./intel";
import { reachableFrom, getNode, type MapNode } from "./overworld";
import type { RunState } from "./run";

/** Reach tuning — the overworld fog's forward horizon (D48), all data (D4). */
export const REACH = {
  /**
   * Base forward visibility in node-steps — **≈ half the map** (the 7-layer
   * default ⇒ ~3 layers ahead). A deep-planning tool, not an early wall. Raise
   * toward the layer count for effectively-infinite visibility (the safe fallback).
   */
  base: 3,
  /** Extra forward node-steps each intel tier reveals (the band step). */
  bandStep: 1,
  /**
   * Survey's **fog-reach lever** (D80, effect C): forward node-steps a **surveyed** node reveals
   * *past itself*. A surveyed node is a vantage point — since you can only survey an immediately-
   * reachable node (1 hop), this must reach past the {@link base} horizon to matter, so it peers a
   * layer **beyond the base fog** along the scouted branch (base + 1 from the current node).
   * Illustrative — the structure (surveying extends reach along a branch) is canon.
   */
  surveyReach: 3,
} as const;

/** The forward visibility limit (in node-steps) at a given intel `tier` (D48). */
export function reachLimit(tier: number): number {
  return REACH.base + Math.max(0, tier) * REACH.bandStep;
}

/**
 * The nodes currently **visible** through the overworld fog (D48): the current
 * node, every node already on the run's path (known/visited), a forward BFS cut at
 * {@link reachLimit} of the party's intel tier, and — always — the
 * immediately-reachable choices (never stuck). A pure visibility mask over the
 * seed-built map; stable for a seed. Returned in stable map order.
 */
export function visibleNodes(run: RunState): MapNode[] {
  const limit = reachLimit(intelFloor(run.party));
  const start = getNode(run.map, run.mapNodeId);
  const seen = new Map<string, MapNode>();

  // Known: the current node + everything already travelled (behind the fog line).
  seen.set(start.id, start);
  for (const id of run.path) seen.set(id, getNode(run.map, id));

  // Forward BFS to the reach limit.
  let frontier: MapNode[] = [start];
  for (let depth = 0; depth < limit && frontier.length > 0; depth++) {
    const next: MapNode[] = [];
    for (const node of frontier) {
      for (const n of reachableFrom(run.map, node.id)) {
        if (!seen.has(n.id)) {
          seen.set(n.id, n);
          next.push(n);
        }
      }
    }
    frontier = next;
  }

  // Guardrail (D48): the immediate choices are ALWAYS visible — even at reach 0.
  for (const n of reachableFrom(run.map, start.id)) seen.set(n.id, n);

  // Survey's fog-reach lever (D80, effect C): each **surveyed** node is a vantage point — reveal a
  // few steps past it, so scouting a branch lets you plan deeper along it. Reads the same `scouted`
  // counter that drives the depth bump (effect A); a single Survey works both intel axes.
  for (const node of [...seen.values()]) {
    if ((run.overworld.scouted[node.id] ?? 0) <= 0) continue;
    // Walk the branch forward `surveyReach` steps from the vantage. Track a *local* visited set so
    // the walk traverses **through** already-visible layers to the fog edge, revealing the deep
    // nodes past it (a global `seen` check would halt at the first already-visible neighbour).
    const walked = new Set<string>([node.id]);
    let vantage: MapNode[] = [node];
    for (let step = 0; step < REACH.surveyReach && vantage.length > 0; step++) {
      const beyond: MapNode[] = [];
      for (const v of vantage) {
        for (const n of reachableFrom(run.map, v.id)) {
          if (walked.has(n.id)) continue;
          walked.add(n.id);
          seen.set(n.id, n); // reveal past the fog (a no-op if already visible)
          beyond.push(n);
        }
      }
      vantage = beyond;
    }
  }

  const rank = new Map(run.map.order.map((id, i) => [id, i]));
  return [...seen.values()].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
}

/** True if a node is visible through the fog right now (the render's mask, D48). */
export function isNodeVisible(run: RunState, nodeId: string): boolean {
  return visibleNodes(run).some((n) => n.id === nodeId);
}
