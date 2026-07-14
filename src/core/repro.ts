/**
 * **Repro Dump** (debug tooling) — a full-fidelity, serializable capture of a live
 * {@link RunState}, and the inverse that rehydrates it.
 *
 * Why this exists (and why {@link "./run".snapshotRun} isn't enough): `snapshotRun`
 * saves only `seed + route + econ` and rebuilds everything else by **replaying the route
 * from the seed** — but replay takes the *auto/naive* path (auto-resolved events,
 * auto-battled combats), so it can't reproduce a player's **interactive** choices (which
 * recovery verbs they spent, how they resolved a gift discard, where they deployed). A
 * freeze usually depends on exactly that interactive state, so reproducing it needs the
 * **live mutable state captured directly** — party HP/fatigue/xp/statuses, inventory,
 * camp gold/morale, overworld flags — not a replay.
 *
 * A {@link ReproDump} is that direct capture: the whole `RunState` as plain data, with the
 * two non-plain fields handled — `rng` becomes its serialized {@link RngState}, and the map
 * is carried verbatim (it is plain data; authored-encounter resolution still keys off the
 * carried `expeditionId`). {@link dumpRun} → {@link serializeDump} produces the JSON a
 * tester pastes; {@link parseDump} → {@link restoreRun} boots straight back into that exact
 * state. Pure logic: **no Phaser, no DOM, no `Math.random`** — the render layer
 * (`game/repro-capture.ts`) owns the capture hook, hotkey, and restore boot.
 */
import { Rng, type RngState } from "./rng";
import { type Unit } from "./units";
import { type Inventory } from "./inventory";
import { type Camp } from "./camp";
import { type RescueQuest } from "./mortality";
import { type OverworldMap } from "./overworld";
import { type OverworldState } from "./overworld-state";
import type { RunState, NightRecord } from "./run";

/** The current dump schema version — bumped when the shape changes so a stale paste is rejected loudly. */
export const REPRO_DUMP_VERSION = 1 as const;

/**
 * A complete, serializable snapshot of a run's live state (see the module doc). Every field
 * is the `RunState` field verbatim, except `rng` → {@link RngState}. The map is carried whole
 * so restore needs no regeneration (authored maps aren't seed-derivable anyway).
 */
export interface ReproDump {
  /** Schema version — {@link REPRO_DUMP_VERSION} at capture; {@link parseDump} rejects a mismatch. */
  v: typeof REPRO_DUMP_VERSION;
  seed: string | number;
  rngState: RngState;
  expeditionId?: string;
  map: OverworldMap;
  mapNodeId: string;
  path: string[];
  party: Unit[];
  inventory: Inventory;
  camp: Camp;
  rp: number;
  overworld: OverworldState;
  night: number;
  difficultyId: string;
  history: NightRecord[];
  rescueQuests: RescueQuest[];
  over: boolean;
  complete: boolean;
  flags: Record<string, boolean>;
}

// --- Non-finite-safe JSON (D-repro) -----------------------------------------
// A StatusInstance's `duration` may be `Infinity` (a status that never self-expires);
// plain JSON.stringify would silently turn that into `null` and corrupt the restore. The
// replacer/reviver below round-trip Infinity/-Infinity/NaN through string sentinels so the
// dump is byte-for-byte lossless.
const POS_INF = "__Infinity__";
const NEG_INF = "__-Infinity__";
const NAN_TOKEN = "__NaN__";

function reproReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) {
    if (value === Infinity) return POS_INF;
    if (value === -Infinity) return NEG_INF;
    return NAN_TOKEN; // NaN
  }
  return value;
}

function reproReviver(_key: string, value: unknown): unknown {
  if (value === POS_INF) return Infinity;
  if (value === NEG_INF) return -Infinity;
  if (value === NAN_TOKEN) return NaN;
  return value;
}

/** Assemble the plain-data view of a run (rng → state; live references, not yet cloned). */
function toDump(run: RunState): ReproDump {
  return {
    v: REPRO_DUMP_VERSION,
    seed: run.seed,
    rngState: run.rng.state(),
    expeditionId: run.expeditionId,
    map: run.map,
    mapNodeId: run.mapNodeId,
    path: run.path,
    party: run.party,
    inventory: run.inventory,
    camp: run.camp,
    rp: run.rp,
    overworld: run.overworld,
    night: run.night,
    difficultyId: run.difficultyId,
    history: run.history,
    rescueQuests: run.rescueQuests,
    over: run.over,
    complete: run.complete,
    flags: run.flags,
  };
}

/**
 * Capture a live run as a **decoupled**, serialization-verified {@link ReproDump}. The
 * capture is round-tripped through {@link serializeDump}/{@link parseDump} so (a) it shares
 * no references with the live run — later mutation can't change a captured dump — and (b) it
 * is provably identical to the JSON a tester will paste (no "worked in memory, broke over the
 * wire" gap).
 */
export function dumpRun(run: RunState): ReproDump {
  return parseDump(serializeDump(toDump(run)));
}

/** Serialize a dump to the JSON string a tester copies (Infinity-safe). */
export function serializeDump(dump: ReproDump): string {
  return JSON.stringify(dump, reproReplacer);
}

/**
 * Parse a pasted dump string back to a {@link ReproDump}, rejecting a malformed or
 * wrong-version blob with a readable error (so a stale paste fails loudly, not with a
 * confusing downstream crash).
 */
export function parseDump(text: string): ReproDump {
  let raw: unknown;
  try {
    raw = JSON.parse(text, reproReviver);
  } catch (e) {
    throw new Error(`Repro dump: not valid JSON (${(e as Error).message})`);
  }
  const dump = raw as Partial<ReproDump>;
  if (!dump || typeof dump !== "object") throw new Error("Repro dump: expected a JSON object");
  if (dump.v !== REPRO_DUMP_VERSION) {
    throw new Error(`Repro dump: version ${String(dump.v)} not supported (this build reads v${REPRO_DUMP_VERSION})`);
  }
  if (!dump.map || !dump.mapNodeId || !Array.isArray(dump.party)) {
    throw new Error("Repro dump: missing required fields (map / mapNodeId / party)");
  }
  return dump as ReproDump;
}

/**
 * Rehydrate a {@link ReproDump} into a live {@link RunState} — the exact state captured, no
 * replay. The RNG cursor is restored so subsequent draws continue as they would have; the
 * map is taken verbatim. `expeditionId` is carried so `authoredId`/`eventId` nodes resolve
 * against the registered expedition catalog (registered at module load).
 */
export function restoreRun(dump: ReproDump): RunState {
  return {
    seed: dump.seed,
    rng: Rng.fromState(dump.rngState, dump.seed),
    map: dump.map,
    expeditionId: dump.expeditionId,
    mapNodeId: dump.mapNodeId,
    path: [...dump.path],
    party: dump.party,
    inventory: dump.inventory,
    camp: dump.camp,
    rp: dump.rp,
    overworld: dump.overworld,
    night: dump.night,
    difficultyId: dump.difficultyId,
    history: dump.history,
    rescueQuests: dump.rescueQuests,
    over: dump.over,
    complete: dump.complete,
    flags: dump.flags,
  };
}
