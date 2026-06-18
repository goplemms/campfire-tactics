/**
 * Run state (M6, reframed for M7) — the seeded, permadeath roguelike run.
 *
 * Wraps the existing phase loop in a **run**: a persistent party roster,
 * inventory, gold/morale (camp), a Rest-Point pool, a night counter, the
 * difficulty id, the **threaded RNG**, and a history of outcomes. The run is the
 * single source of all run-time randomness: the map and each encounter derive
 * their generation stream deterministically from `seed`, so the **same seed
 * reproduces the run exactly**.
 *
 * **M7 — the overworld frame (D22).** The linear `encounterIndex` is gone; a run
 * now navigates a seeded branching **map** ({@link "./overworld"}). Position is a
 * **current node** (`mapNodeId`) plus the **path** of chosen nodes. The current
 * encounter resolves from the current node; {@link reachableNodes} lists the
 * forward choices and {@link chooseNode} commits one. The run ends on a **wipe**
 * (unchanged) or completes when a **final-layer** node is cleared.
 *
 * Permadeath: fallen (per the difficulty {@link "./mortality"} policy) and
 * abandoned-captured units **leave the roster**. The run is over when no roster
 * unit can fight on.
 *
 * Pure logic: no Phaser, no DOM.
 */

import { Rng, type RngState } from "./rng";
import { createUnit, type Unit } from "./units";
import { createInventory, type Inventory } from "./inventory";
import { createCamp, type Camp } from "./camp";
import { getDifficulty, type DifficultyPolicy } from "./mortality";
import { accrueDeployedXp } from "./leveling";
import { type EncounterDef } from "./generation";
import type { EncounterResult } from "./authored";
import type { EncounterSource } from "./staging";
import { getExpedition, type AuthoredExpedition } from "./expedition";
import {
  generateOverworld,
  getNode,
  reachableFrom,
  isFinalNode,
  nodeEncounter,
  type OverworldMap,
  type MapNode,
  type NodeKind,
} from "./overworld";
import {
  createOverworldEconomy,
  cloneOverworldEconomy,
  tickCooldowns,
  accruePurseInterest,
  type OverworldEconomy,
} from "./overworld-actions";

/** A recorded node outcome, for the run history / run-end screen. */
export interface EncounterRecord {
  /** The map node this record is for. */
  nodeId: string;
  /** The node's layer (its difficulty index for combat). */
  layer: number;
  kind: NodeKind;
  /** Combat only: the encounter shape (open-field/fortified). */
  type?: EncounterDef["type"];
  winner?: "player" | "enemy";
  /**
   * The graded combat outcome (D50/D51): `win | objective-failure | wipe`. The
   * end-screen reads the final node's record to tell *complete* (won the prize)
   * from *returned alive without it* (objective-failure) from *lost* (wipe).
   */
  result?: EncounterResult;
  goldEarned: number;
  fallen: string[];
  night: number;
}

/**
 * The live run state — everything a run needs to advance or be replayed.
 *
 * **The RunState surface.** `RunState` is plain data (so it snapshots/serializes,
 * see {@link snapshotRun}); its behaviour is free functions spread by feature
 * across the core, not methods. This file holds the spine — navigation
 * ({@link currentNode}, {@link reachableNodes}, {@link chooseNode}), roster
 * ({@link activeRoster}, {@link combatRoster}, {@link removeFromRoster}), and
 * lifecycle ({@link recordNight}, {@link runDifficulty}, {@link isRunOver},
 * {@link snapshotRun}) — and {@link "./runloop".RunLoop} is the stateful driver
 * that wraps it. The rest of the surface lives with its feature:
 *
 * - **{@link "./economy"}** — loot into the purse ({@link "./economy".gainRunGold}).
 * - **{@link "./economy-actions"}** — the Banker/Noble/Merchant verbs
 *   (`bankerBorrow`, `bankerEngageInterest`, `bankerProtect`, `merchantBuy`).
 * - **{@link "./node-events"}** — event-node resolution (`resolveEvent`,
 *   `eventChoices`, `chooseEventOption`).
 * - **{@link "./ledger"}** — the derived ledger + night gate (`buildLedger`,
 *   `nightEndGate`).
 * - **{@link "./fog"}** — map visibility (`visibleNodes`, `isNodeVisible`).
 * - **{@link "./forecast"}** — the route forecast (`projectForecast`).
 * - **{@link "./intel"}** — node previews (`previewNode`).
 * - **{@link "./theft"}** — purse-skim recovery (`recoverStolen`).
 *
 * New run behaviour belongs in the feature module, not bolted here — keep this
 * file the spine and update the list above so the surface stays discoverable.
 */
export interface RunState {
  /** The textual/numeric seed (re-enterable to reproduce the run). */
  seed: string | number;
  /** The threaded master RNG (all run-time randomness flows through it). */
  rng: Rng;
  /** The overworld map the run navigates — seed-derived, or hand-built (D22/D52). */
  map: OverworldMap;
  /**
   * The authored expedition this run is playing (D52), if any. Carries the catalog
   * key so a snapshot rebuilds the (un-generated) hand-built map; unset for a
   * procedural run. `runEncounter` reads it to resolve `authoredId` nodes.
   */
  expeditionId?: string;
  /** The current node id (starts at the map's start node). */
  mapNodeId: string;
  /** The route taken so far, oldest → current (starts `[startId]`). */
  path: string[];
  /** The persistent party roster (units leave it on permadeath). */
  party: Unit[];
  inventory: Inventory;
  camp: Camp;
  /** Banked Rest Points (D9 recovery pool). */
  rp: number;
  /**
   * The overworld action economy's per-run state (D35): per-ability node-step
   * cooldowns (the spine) + per-node bought intel tiers (Scout). Deterministic
   * run state — no live RNG (D22).
   */
  overworld: OverworldEconomy;
  /** Nights elapsed (the universal time unit, D9). */
  night: number;
  /** Difficulty id → the consequence policy the run consults (D9). */
  difficultyId: string;
  history: EncounterRecord[];
  /** True once the run has ended (a wipe, or a non-win battle). */
  over: boolean;
  /** True once a final-layer node has been cleared (run-complete, D23). */
  complete: boolean;
}

/** Options for {@link createRun}. */
export interface CreateRunOptions {
  party: Unit[];
  difficultyId?: string;
  gold?: number;
  storageCap?: number;
  morale?: number;
  inventory?: Record<string, number>;
  /** A hand-built map (D52); when omitted the map is generated from the seed. */
  map?: OverworldMap;
  /** The authored expedition id this run plays (D52), if any. */
  expeditionId?: string;
}

/** Create a fresh run from a seed. */
export function createRun(seed: string | number, opts: CreateRunOptions): RunState {
  const storageCap = opts.storageCap ?? 6;
  const map = opts.map ?? generateOverworld(seed);
  return {
    seed,
    rng: new Rng(seed),
    map,
    expeditionId: opts.expeditionId,
    mapNodeId: map.startId,
    path: [map.startId],
    party: opts.party,
    inventory: createInventory(storageCap, opts.inventory ?? {}),
    camp: createCamp({ gold: opts.gold ?? 0, storageCap, morale: opts.morale ?? 0 }),
    rp: 0,
    overworld: createOverworldEconomy(),
    night: 0,
    difficultyId: opts.difficultyId ?? "normal",
    history: [],
    over: false,
    complete: false,
  };
}

/**
 * Build a run **from a caravan** (M9, D25/D26) — the guild-tier entry point. A
 * `Guild` of N runs ({@link "./guild"}) dispatches a caravan by deriving a run
 * from its bundle: the caravan's **party** (a copy, so permadeath can splice it
 * without touching the assembled caravan), its per-caravan **storage cap**, its
 * **loaded supplies** (the starting inventory), and its **purse** (the run's gold
 * — `camp.gold` *is* the purse; the treasury is new on the guild, D34). The `seed`
 * is the **quest's** seed, so the same guild seed + same dispatch choices
 * reproduce each caravan's map + outcomes exactly (D22). The existing
 * {@link createRun} options overload stays for tests.
 */
export function createRunFromCaravan(
  seed: string | number,
  caravan: { party: Unit[]; storageCap: number; supplies: Record<string, number>; purse: number },
  opts: { difficultyId?: string; morale?: number } = {},
): RunState {
  return createRun(seed, {
    party: [...caravan.party],
    storageCap: caravan.storageCap,
    inventory: { ...caravan.supplies },
    gold: caravan.purse,
    difficultyId: opts.difficultyId,
    morale: opts.morale,
  });
}

/**
 * Boot a run from an {@link AuthoredExpedition} (D52) — the authored entry point.
 * Inflates the expedition's bundle (party specs, purse, supplies, storage cap)
 * onto the **hand-built** map and tags the run with the expedition id so
 * `runEncounter` resolves `authoredId` nodes and a snapshot can rebuild the map.
 * Everything downstream — routing, forecast, intel, graded resolution — is the
 * normal overworld path (D49). Pass an already-registered expedition.
 */
export function createRunFromExpedition(exp: AuthoredExpedition): RunState {
  return createRun(exp.seed, {
    party: exp.bundle.party.map(createUnit),
    storageCap: exp.bundle.storageCap,
    inventory: { ...exp.bundle.supplies },
    gold: exp.bundle.purse,
    difficultyId: exp.bundle.difficultyId,
    morale: exp.bundle.morale,
    map: exp.map,
    expeditionId: exp.id,
  });
}

/** The difficulty policy this run consults (D9). */
export function runDifficulty(run: RunState): DifficultyPolicy {
  return getDifficulty(run.difficultyId);
}

/** The node the run is currently positioned at (D22). */
export function currentNode(run: RunState): MapNode {
  return getNode(run.map, run.mapNodeId);
}

/** True if the current node is the run's final mission (clearing it completes it). */
export function isFinalRunNode(run: RunState): boolean {
  return isFinalNode(run.map, currentNode(run));
}

/**
 * The nodes reachable in one forward step from the current position (D22) — the
 * branch choices the player picks among. The final node has none.
 */
export function reachableNodes(run: RunState): MapNode[] {
  return reachableFrom(run.map, run.mapNodeId);
}

/**
 * **Break Camp** — the node-step tick at *departure* (D46). Decrements every
 * ability cooldown ({@link tickCooldowns}) and accrues the Banker's purse interest
 * ({@link accruePurseInterest}). The overworld clock's tick fires **here, when the
 * caravan leaves a finished node** — not at the event seam — so one night's action
 * allowance is timed across the whole visit (Make Camp → event → Survey → Break
 * Camp), exactly once per node-step. Called from {@link chooseNode} (the routing
 * departure) and from a repeatable in-place rest (each rest is its own node-step,
 * D47). A pure **purse** faucet — it never touches the guild treasury (D34).
 */
export function breakCamp(run: RunState): void {
  tickCooldowns(run.overworld);
  accruePurseInterest(run.overworld, run.camp);
  // The deployed trickle (D53): every deployed character earns a passive bump per
  // node-step on the road (benched roster lives on the guild, never passed here).
  accrueDeployedXp(run.party);
}

/**
 * Commit to a reachable node: **Break Camp** (the node-step tick at departure,
 * D46), then move the run's position there and extend the path. Throws if `id` is
 * not a forward choice from the current node. Returns the node (the orchestrator
 * then plays it — a combat fight or a rest recovery).
 */
export function chooseNode(run: RunState, id: string): MapNode {
  if (!reachableNodes(run).some((n) => n.id === id)) {
    throw new Error(`run: "${id}" is not reachable from "${run.mapNodeId}"`);
  }
  breakCamp(run); // depart the current node — the overworld clock ticks here (D46)
  run.mapNodeId = id;
  run.path.push(id);
  return currentNode(run);
}

/**
 * Resolve a node's encounter **run-scoped** (D49) — the single funnel for the
 * current encounter, forecast, intel and previews. An `authoredId` node bound to
 * the run's expedition catalog returns its fixed {@link AuthoredEncounter};
 * everything else generates procedurally (deterministic by seed + node id), so
 * replay is exact regardless of the path taken.
 */
export function runEncounter(run: RunState, node: MapNode): EncounterSource {
  if (node.authoredId && run.expeditionId) {
    const enc = getExpedition(run.expeditionId)?.encounters[node.authoredId];
    if (enc) return enc;
  }
  return nodeEncounter(run.seed, node);
}

/** The current node's encounter (run-scoped resolver, D49). */
export function currentEncounter(run: RunState): EncounterSource {
  return runEncounter(run, currentNode(run));
}

/** Roster units that are alive and not captured (incl. camp-only crew). */
export function activeRoster(run: RunState): Unit[] {
  return run.party.filter((u) => u.alive && !u.captured);
}

/**
 * Units that can take the field. The combat/non-combat split is **dissolved**
 * (D38) — any job can field — so this is the {@link activeRoster}; kept as a named
 * call so the intent reads at the seams that field a roster.
 */
export function combatRoster(run: RunState): Unit[] {
  return activeRoster(run);
}

/**
 * Remove a unit from the roster (permadeath, or an abandoned captive, D9).
 * Returns true if the unit was present.
 */
export function removeFromRoster(run: RunState, unit: Unit): boolean {
  const i = run.party.indexOf(unit);
  if (i < 0) return false;
  run.party.splice(i, 1);
  return true;
}

/**
 * Whether the run is over: no roster unit can fight on. A party of only
 * captured/fallen units is a wipe (captives become rescue follow-ups, but with
 * nobody left to mount the rescue the run ends).
 */
export function isRunOver(run: RunState): boolean {
  return combatRoster(run).length === 0;
}

/** True once a final-layer node has been cleared (run-complete, D23). */
export function isRunComplete(run: RunState): boolean {
  return run.complete;
}

/**
 * Record a played node (combat resolution or a rest) and advance the night
 * counter. Does **not** move map position — that's {@link chooseNode}'s job — but
 * it does re-evaluate the **wipe** terminal and, if the current node is the
 * **final** one and the player won, flags the run **complete** (D23). Returns the
 * run's terminal state (`over` from a wipe, or `complete`).
 *
 * This is the **End the Night** reconciliation seam (D46): it records the night
 * and re-evaluates the run terminal. The overworld clock's **tick** (cooldown
 * decrement + purse interest) no longer fires here — it moved to *departure*
 * ({@link breakCamp}, fired from {@link chooseNode}), so one night's allowance is
 * timed across the whole node visit rather than at the event seam.
 */
export function recordNight(run: RunState, record: Omit<EncounterRecord, "night">): boolean {
  run.history.push({ ...record, night: run.night });
  run.night += 1;
  run.over = run.over || isRunOver(run);
  // Graded final terminal (D51): clearing the final node = **complete** only when
  // all required objectives were **met** (a `win`); a graded combat record carries
  // its `result`, a non-combat record (rest/event) falls back to "not lost". Any
  // non-win resolution of the final node still **ends** the run (caravan returns
  // alive without the prize, or a wipe) — there's no node forward.
  if (isFinalRunNode(run)) {
    const won = record.result ? record.result === "win" : record.winner !== "enemy";
    if (!run.over && won) run.complete = true;
    else if (!won) run.over = true;
  }
  return run.over || run.complete;
}

/** Serialized run state for save/replay (the seed + route + RNG state). */
export interface RunSnapshot {
  seed: string | number;
  rngState: RngState;
  /**
   * The authored expedition id (D52), if any — a seed alone can't reproduce a
   * **hand-built** map, so the snapshot rebuilds it from the catalog by this id.
   */
  expeditionId?: string;
  /** The current node (the position to resume / regenerate from). */
  mapNodeId: string;
  /** The route taken so far — replays the same map + choices exactly. */
  path: string[];
  night: number;
  difficultyId: string;
  /**
   * The overworld economy state (D35): cooldowns + scouted tiers. Captured so a
   * save round-trips the action economy, not just the route.
   */
  overworld: OverworldEconomy;
}

/** Capture a snapshot sufficient to reproduce the run's map, route and position. */
export function snapshotRun(run: RunState): RunSnapshot {
  return {
    seed: run.seed,
    rngState: run.rng.state(),
    expeditionId: run.expeditionId,
    mapNodeId: run.mapNodeId,
    path: [...run.path],
    night: run.night,
    difficultyId: run.difficultyId,
    overworld: cloneOverworldEconomy(run.overworld),
  };
}
