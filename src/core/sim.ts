/**
 * Headless run simulator (D55) — the balance + robustness rig.
 *
 * Plays whole runs to a terminal with the AI driving **both** sides, riding only
 * the first-class {@link RunLoop} seams (`autoTraverse` → `autoBattle`) and the
 * {@link PlaytestLog}. It owns **no rules of its own**, so every new
 * encounter/job/node/objective is covered the day it lands — never a parallel
 * reimplementation. Two uses:
 *
 *  - **Robustness / fuzz:** many seeds must *terminate*, never *throw*, and replay
 *    *deterministically* — the regression net for the soft-lock class (D55).
 *  - **Difficulty sanity:** the **naive bot's** completion rate is a *conservative
 *    floor* — it plays tactically dumb and the headless path skips deployment, the
 *    meta-economy and the full kit, so a **high** completion rate means "too easy",
 *    while the **end-layer histogram** locates difficulty walls.
 *
 * The naive bot is exactly the existing pick-first-reachable traversal; a pluggable
 * meta / battle **policy** (the enemy-AI A/B seam) is the planned next layer.
 *
 * Pure logic: no Phaser, no DOM.
 */

import type { RunState } from "./run";
import { RunLoop } from "./runloop";
import { createPlaytestLog, summarizePlaytest, type PlaytestSummary } from "./playtest-log";
import type { EncounterResult } from "./authored";
import type { BattlePolicy } from "./ai";

/** Per-run knobs for the simulator. */
export interface SimOptions {
  /**
   * Battle policies to drive auto-play (D56) — set one or both to **A/B AI
   * variants** over identical seeds. Defaults to the pilot policy on both sides.
   */
  policy?: { player: BattlePolicy; enemy: BattlePolicy };
}

/** The outcome of one simulated run. */
export interface RunResult {
  seed: string | number;
  expeditionId?: string;
  /** Reached a real terminal (vs bailing on the `maxNodes` guard — a stall). */
  terminated: boolean;
  /** `complete` = won the run · `over` = lost · `stall` = guard bail · `crash` = threw. */
  status: "complete" | "over" | "stall" | "crash";
  /** Error text if the run threw (a crash to investigate). */
  error?: string;
  /** Layer of the last node played — where the run ended (the difficulty-wall finder). */
  endLayer: number;
  endNodeId?: string;
  summary: PlaytestSummary;
}

/**
 * Mint a run via `makeRun`, attach a fresh telemetry log, and auto-traverse it to a
 * terminal — capturing any throw rather than propagating it (a crash is data). The
 * factory must build a **fresh party each call** (auto-play mutates HP/permadeath).
 */
export function simulateRun(makeRun: () => RunState, opts: SimOptions = {}): RunResult {
  const run = makeRun();
  const loop = new RunLoop(run);
  loop.log = createPlaytestLog(run, String(run.seed));
  if (opts.policy) loop.policy = opts.policy;
  let error: string | undefined;
  try {
    loop.autoTraverse();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const last = run.history[run.history.length - 1];
  const status = error ? "crash" : run.complete ? "complete" : loop.isTerminal() ? "over" : "stall";
  return {
    seed: run.seed,
    expeditionId: run.expeditionId,
    terminated: loop.isTerminal(),
    status,
    error,
    endLayer: last?.layer ?? 0,
    endNodeId: last?.nodeId,
    summary: summarizePlaytest(loop.log),
  };
}

/** Simulate a batch of run factories (one entry per seed/expedition). */
export function batchSimulate(makers: ReadonlyArray<() => RunState>, opts: SimOptions = {}): RunResult[] {
  return makers.map((m) => simulateRun(m, opts));
}

/** The lever-engagement keys, in display order (mirrors {@link PlaytestSummary}). */
const ENGAGED_KEYS = [
  "goldPressure",
  "skippedFood",
  "tookCaptureRisk",
  "moraleMoved",
  "leveled",
  "restedInPlace",
  "storagePressure",
] as const;

/** The aggregate readout over a batch — the digest the CLI/guard test reads. */
export interface SimDigest {
  runs: number;
  completed: number;
  over: number;
  stalled: number;
  crashed: number;
  /** Naive-bot completion rate — the conservative difficulty *floor* (D55). */
  completionRate: number;
  medianNights: number;
  /** Summed encounter outcomes across the batch. */
  encounterOutcomes: Record<EncounterResult, number>;
  /** Where runs ended, by node layer (difficulty-wall finder). */
  endLayerHistogram: Record<number, number>;
  /** Fraction of runs that engaged each logistics lever. */
  leverEngagement: Record<(typeof ENGAGED_KEYS)[number], number>;
  permadeathsPerRun: number;
  medianGoldEarned: number;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Roll a batch of {@link RunResult}s into a single {@link SimDigest}. */
export function aggregate(results: ReadonlyArray<RunResult>): SimDigest {
  const runs = results.length;
  const encounterOutcomes: Record<EncounterResult, number> = { win: 0, "objective-failure": 0, wipe: 0 };
  const endLayerHistogram: Record<number, number> = {};
  const leverEngagement = Object.fromEntries(ENGAGED_KEYS.map((k) => [k, 0])) as SimDigest["leverEngagement"];
  let permadeaths = 0;
  for (const r of results) {
    endLayerHistogram[r.endLayer] = (endLayerHistogram[r.endLayer] ?? 0) + 1;
    for (const k of ENGAGED_KEYS) if (r.summary.engaged[k]) leverEngagement[k] += 1;
    permadeaths += r.summary.permadeaths;
    for (const o of ["win", "objective-failure", "wipe"] as EncounterResult[]) {
      encounterOutcomes[o] += r.summary.outcomes[o];
    }
  }
  const completed = results.filter((r) => r.status === "complete").length;
  return {
    runs,
    completed,
    over: results.filter((r) => r.status === "over").length,
    stalled: results.filter((r) => r.status === "stall").length,
    crashed: results.filter((r) => r.status === "crash").length,
    completionRate: runs ? completed / runs : 0,
    medianNights: median(results.map((r) => r.summary.nights)),
    encounterOutcomes,
    endLayerHistogram,
    leverEngagement: Object.fromEntries(
      ENGAGED_KEYS.map((k) => [k, runs ? leverEngagement[k] / runs : 0]),
    ) as SimDigest["leverEngagement"],
    permadeathsPerRun: runs ? permadeaths / runs : 0,
    medianGoldEarned: median(results.map((r) => r.summary.goldEarned)),
  };
}

/** Render a {@link SimDigest} as a compact, human-readable block. */
export function formatDigest(label: string, d: SimDigest): string {
  const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
  return [
    `── ${label} (${d.runs} runs) ──`,
    `  completed ${d.completed} (${pct(d.completionRate)}) · lost ${d.over} · stalled ${d.stalled} · crashed ${d.crashed}`,
    `  median nights ${d.medianNights} · median gold earned ${d.medianGoldEarned} · permadeaths/run ${d.permadeathsPerRun.toFixed(2)}`,
    `  encounters: win ${d.encounterOutcomes.win} · obj-fail ${d.encounterOutcomes["objective-failure"]} · wipe ${d.encounterOutcomes.wipe}`,
    `  ended at layer: ${Object.entries(d.endLayerHistogram)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([l, n]) => `L${l}:${n}`)
      .join(" ")}`,
    `  levers engaged: ${ENGAGED_KEYS.map((k) => `${k} ${pct(d.leverEngagement[k])}`).join(" · ")}`,
  ].join("\n");
}
