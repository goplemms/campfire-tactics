/**
 * Playtest telemetry — the logistics-integrity instrument.
 *
 * The logistics levers (gold allocation, resource/upkeep pressure, the
 * deployment gamble, morale, leveling) are only worth anything if a real
 * session actually *exercises* them. This recorder rides the run loop's seams
 * (camp → encounter → rest) and snapshots the lever state at each step, so a
 * playtest run yields a reviewable timeline **plus** a one-glance summary of
 * which levers came into play and whether they bit. That's the question to
 * settle before strangers play: did skipping food, hoarding gold, or risking a
 * deep deploy ever actually change their run?
 *
 * Pure logic: no Phaser, no DOM, and — deliberately — no wall-clock or RNG.
 * Steps are ordered by a monotonic `seq` so the log stays deterministic and
 * headlessly testable. The render layer stamps wall-clock and offers the
 * download (see `game/playtest-log-ui.ts`).
 */
import type { RunState } from "./run";
import { currentNode } from "./run";
import { moraleTier, type MoraleTier } from "./camp";
import { slotsUsed, slotsFree } from "./inventory";
import type { EncounterResult } from "./authored";
import type { ResolveResult, CampResult, RestResult, InPlaceRestResult, EventResolution, TrapEngagement } from "./runloop";

/** A single fighter's vitals at a snapshot moment. */
export interface UnitVitals {
  id: string;
  jobId?: string;
  hp: number;
  maxHp: number;
  fatigue: number;
  alive: boolean;
  captured: boolean;
}

/** The full lever state captured at one step — the row a reviewer reads. */
export interface LeverSnapshot {
  seq: number;
  night: number;
  nodeId: string;
  layer: number;
  kind: string;
  /** The expedition purse (D34): the at-risk gold the player allocates. */
  purse: number;
  morale: number;
  moraleTier: MoraleTier;
  rp: number;
  /** Accrued worn-gear debt from voluntary under-funding (D47). */
  gearWear: number;
  storageUsed: number;
  storageFree: number;
  storageCap: number;
  party: UnitVitals[];
}

/** A condensed upkeep receipt — where the skip-food / under-fund lever shows up. */
export interface UpkeepDigest {
  paid: number;
  skipped: ("food" | "repairs")[];
  underfunded: ("food" | "repairs")[];
  moraleDelta: number;
}

/** A logged step, discriminated by `at` (the run-loop seam it came from). */
export type PlaytestEvent =
  | { at: "camp"; snapshot: LeverSnapshot; upkeep: UpkeepDigest }
  | {
      at: "encounter";
      snapshot: LeverSnapshot;
      result: EncounterResult;
      goldEarned: number;
      captured: string[];
      rescued: string[];
      permadeaths: string[];
      /** Units that gained a character or job level on this win (D53). */
      leveled: string[];
      /** Enemy-trap engagement at this node (D12/D54) — zeroes when none staged. */
      traps: TrapEngagement;
    }
  | {
      at: "rest-node";
      snapshot: LeverSnapshot;
      upkeep: UpkeepDigest;
      goldSpent: number;
      hpHealed: number;
      moraleGained: number;
      fatigueRestored: number;
      debtCleared: number;
    }
  | { at: "in-place-rest"; snapshot: LeverSnapshot; applied: boolean; goldSpent: number; hpHealed: number }
  | { at: "event-node"; snapshot: LeverSnapshot; goldDelta: number };

/** A captured playtest session: an ordered timeline of lever steps. */
export interface PlaytestLog {
  runId: string;
  expeditionId?: string;
  seq: number;
  events: PlaytestEvent[];
}

/** Open a fresh log for a run (the render stamps a human-readable runId). */
export function createPlaytestLog(run: RunState, runId: string): PlaytestLog {
  return { runId, expeditionId: run.expeditionId, seq: 0, events: [] };
}

/** Snapshot the levers at the run's current step. Pure read — never mutates. */
export function snapshot(log: PlaytestLog, run: RunState): LeverSnapshot {
  const node = currentNode(run);
  return {
    seq: log.seq++,
    night: run.night,
    nodeId: node.id,
    layer: node.layer,
    kind: node.kind,
    purse: run.camp.gold,
    morale: run.camp.morale,
    moraleTier: moraleTier(run.camp.morale),
    rp: run.rp,
    gearWear: run.camp.gearWear,
    storageUsed: slotsUsed(run.inventory),
    storageFree: slotsFree(run.inventory),
    storageCap: slotsUsed(run.inventory) + slotsFree(run.inventory),
    party: run.party.map((u) => ({
      id: u.id,
      jobId: u.jobId,
      hp: u.hp,
      maxHp: u.maxHp,
      fatigue: u.fatigue ?? 0,
      alive: u.alive,
      captured: u.captured,
    })),
  };
}

function digestUpkeep(upkeep: CampResult["upkeep"]): UpkeepDigest {
  return {
    paid: upkeep.paid,
    skipped: [...upkeep.skipped],
    underfunded: [...upkeep.underfunded],
    moraleDelta: upkeep.moraleDelta,
  };
}

/** Record the nightly camp upkeep (where the skip-food / under-fund lever lands). */
export function recordCamp(log: PlaytestLog | undefined, run: RunState, res: CampResult): void {
  if (!log) return;
  log.events.push({ at: "camp", snapshot: snapshot(log, run), upkeep: digestUpkeep(res.upkeep) });
}

/** Record an encounter's graded resolution (gold, captures, leveling). */
export function recordEncounter(log: PlaytestLog | undefined, run: RunState, res: ResolveResult): void {
  if (!log) return;
  const leveled = Object.entries(res.levels)
    .filter(([, l]) => l.charLevels > 0 || l.jobLevels > 0)
    .map(([id]) => id);
  log.events.push({
    at: "encounter",
    snapshot: snapshot(log, run),
    result: res.result,
    goldEarned: res.goldEarned,
    // On a non-win the captured become rescue quests; on a win they're freed.
    captured: res.rescueQuests.map((q) => q.unitId),
    rescued: [...res.rescued],
    permadeaths: [...res.permadeaths],
    leveled,
    traps: { ...res.traps },
  });
}

/** Record a premium rest-node recovery. */
export function recordRestNode(log: PlaytestLog | undefined, run: RunState, res: RestResult): void {
  if (!log) return;
  log.events.push({
    at: "rest-node",
    snapshot: snapshot(log, run),
    upkeep: digestUpkeep(res.upkeep),
    goldSpent: res.upkeep.paid,
    hpHealed: res.healed.reduce((sum, h) => sum + h.hp, 0),
    moraleGained: res.moraleGained,
    fatigueRestored: res.fatigueRestored.length,
    debtCleared: res.debtCleared,
  });
}

/** Record a repeatable in-place rest. */
export function recordInPlaceRest(log: PlaytestLog | undefined, run: RunState, res: InPlaceRestResult): void {
  if (!log) return;
  log.events.push({
    at: "in-place-rest",
    snapshot: snapshot(log, run),
    applied: res.applied,
    goldSpent: res.goldSpent,
    hpHealed: res.hpHealed,
  });
}

/** Record an event node's gold swing. */
export function recordEventNode(log: PlaytestLog | undefined, run: RunState, res: EventResolution): void {
  if (!log) return;
  log.events.push({ at: "event-node", snapshot: snapshot(log, run), goldDelta: res.outcome.goldDelta });
}

// --- The summary: did each lever come into play, and did it bite? -----------

/** The per-session readout that answers the logistics-integrity question. */
export interface PlaytestSummary {
  runId: string;
  expeditionId?: string;
  nights: number;
  encounters: number;
  /** Outcome tallies (win / objective-failure / wipe). */
  outcomes: Record<EncounterResult, number>;
  // Gold lever
  goldEarned: number;
  goldSpentUpkeep: number;
  purseStart: number;
  purseEnd: number;
  purseMin: number;
  // Resource lever
  foodSkips: number;
  underfundedNights: number;
  peakGearWear: number;
  peakFatigue: number;
  // Morale lever
  moraleMin: number;
  moraleMax: number;
  moraleTiersSeen: MoraleTier[];
  // Deployment lever
  captures: number;
  permadeaths: number;
  // Progression
  levelUps: number;
  // Trap lever (D12/D54) — summed enemy-trap engagement across the run's encounters.
  traps: TrapEngagement;
  /**
   * The headline: did each lever *come into play at all*? A `false` here is the
   * loud signal — a lever the player never felt this session.
   */
  engaged: {
    goldPressure: boolean;
    skippedFood: boolean;
    tookCaptureRisk: boolean;
    moraleMoved: boolean;
    leveled: boolean;
    restedInPlace: boolean;
    storagePressure: boolean;
    /**
     * The trap lever bit: an enemy trap was spotted, sprung, or disarmed. The loud
     * miss is `traps.staged > 0` with this false — a trap-field crossed the run
     * without the field ever being touched (the Node-3 teaching-beat check).
     */
    feltTraps: boolean;
  };
}

/** Below this purse, gold counts as having applied real pressure this session. */
const GOLD_PRESSURE_FLOOR = 10;

/** Derive the lever-engagement summary from a captured log. */
export function summarizePlaytest(log: PlaytestLog): PlaytestSummary {
  const outcomes: Record<EncounterResult, number> = { win: 0, "objective-failure": 0, wipe: 0 };
  let goldEarned = 0;
  let goldSpentUpkeep = 0;
  let foodSkips = 0;
  let underfundedNights = 0;
  let peakGearWear = 0;
  let peakFatigue = 0;
  let captures = 0;
  let permadeaths = 0;
  let levelUps = 0;
  let restedInPlace = false;
  let storagePressure = false;
  const traps: TrapEngagement = { staged: 0, spotted: 0, sprung: 0, disarmed: 0, salvaged: 0 };

  const purses: number[] = [];
  const morales: number[] = [];
  const tiers = new Set<MoraleTier>();

  for (const ev of log.events) {
    const s = ev.snapshot;
    purses.push(s.purse);
    morales.push(s.morale);
    tiers.add(s.moraleTier);
    peakGearWear = Math.max(peakGearWear, s.gearWear);
    for (const u of s.party) peakFatigue = Math.max(peakFatigue, u.fatigue);
    if (s.storageFree === 0) storagePressure = true;

    if (ev.at === "camp" || ev.at === "rest-node") {
      goldSpentUpkeep += ev.upkeep.paid;
      if (ev.upkeep.skipped.includes("food")) foodSkips++;
      if (ev.upkeep.underfunded.length > 0) underfundedNights++;
    }
    if (ev.at === "encounter") {
      outcomes[ev.result]++;
      goldEarned += ev.goldEarned;
      captures += ev.captured.length;
      permadeaths += ev.permadeaths.length;
      levelUps += ev.leveled.length;
      traps.staged += ev.traps.staged;
      traps.spotted += ev.traps.spotted;
      traps.sprung += ev.traps.sprung;
      traps.disarmed += ev.traps.disarmed;
      traps.salvaged += ev.traps.salvaged;
    }
    if (ev.at === "in-place-rest" && ev.applied) restedInPlace = true;
  }

  const encounters = outcomes.win + outcomes["objective-failure"] + outcomes.wipe;
  const purseStart = purses[0] ?? 0;
  const purseEnd = purses[purses.length - 1] ?? 0;
  const purseMin = purses.length ? Math.min(...purses) : 0;
  const moraleMin = morales.length ? Math.min(...morales) : 0;
  const moraleMax = morales.length ? Math.max(...morales) : 0;

  return {
    runId: log.runId,
    expeditionId: log.expeditionId,
    // The run's night counter advances through play; its high-water mark is the
    // nights elapsed (a combat node logs camp + encounter on the *same* night).
    nights: log.events.length ? Math.max(...log.events.map((e) => e.snapshot.night)) : 0,
    encounters,
    outcomes,
    goldEarned,
    goldSpentUpkeep,
    purseStart,
    purseEnd,
    purseMin,
    foodSkips,
    underfundedNights,
    peakGearWear,
    peakFatigue,
    moraleMin,
    moraleMax,
    moraleTiersSeen: [...tiers],
    captures,
    permadeaths,
    levelUps,
    traps,
    engaged: {
      goldPressure: purseMin <= GOLD_PRESSURE_FLOOR || underfundedNights > 0,
      skippedFood: foodSkips > 0,
      tookCaptureRisk: captures > 0,
      moraleMoved: tiers.size > 1 || !tiers.has("Neutral"),
      leveled: levelUps > 0,
      restedInPlace,
      storagePressure,
      feltTraps: traps.spotted + traps.sprung + traps.disarmed > 0,
    },
  };
}
