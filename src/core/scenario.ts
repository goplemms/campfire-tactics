/**
 * The scenario harness (#170) — boot an **arbitrary** encounter run-less.
 *
 * The visual twin of the headless {@link "./staging".stageEncounter}: it lets the
 * `BattleScene` (and the shots/e2e harness) stage any {@link AuthoredEncounter} +
 * party from a plain config, for isolated, screenshottable scenes — instead of
 * hijacking a live expedition node and mutating it by hand.
 *
 * **Approach — a synthetic one-node run.** `BattleScene` consumes a `{ run, loop }`
 * pair and drives it through {@link "./runloop".RunLoop.startEncounter}, so rather
 * than teach the scene a run-less path we **synthesize the run** it already eats: a
 * single-node {@link OverworldMap} (start == final == a `combat` node) bound to the
 * config's encounter, wrapped in a throwaway {@link AuthoredExpedition}, booted via
 * {@link createRunFromExpedition}. The scene stays a thin renderer, unchanged.
 *
 * The expedition is **registered lazily** — only when {@link buildScenarioRun} runs,
 * never at module import — so importing a scenario config (pure data) never pollutes
 * the expedition catalog or perturbs the sim digest.
 *
 * Pure logic: no Phaser, no DOM, no `Math.random`.
 */

import type { UnitSpec } from "./units";
import type { AuthoredEncounter } from "./authored";
import type { MapNode, OverworldMap } from "./overworld";
import {
  registerExpedition,
  validateExpedition,
  type AuthoredExpedition,
} from "./expedition";
import { createRunFromExpedition, type RunState } from "./run";
import { RunLoop } from "./runloop";

/**
 * A bootable scenario — an {@link AuthoredEncounter} plus a **party matrix** (named
 * variants the headless test and the visual harness both pick from, so one config
 * drives both). The optional run knobs default to a bare, deterministic run.
 */
export interface ScenarioConfig {
  id: string;
  name: string;
  /** The board to stage. */
  encounter: AuthoredEncounter;
  /** Named party variants (e.g. `{ thief, scout }`) — the harness/test select one. */
  parties: Record<string, UnitSpec[]>;
  /** Which variant the visual harness boots by default (must be a key of `parties`). */
  defaultParty: string;
  /** Run seed (the encounter's RNG); defaults to the deterministic `0` floor. */
  seed?: string | number;
  /** Starting purse; defaults to {@link DEFAULT_SCENARIO_GOLD} (≥ party upkeep). */
  gold?: number;
  /** Starting morale; defaults to `0` (baseline). */
  morale?: number;
  /** Starting supplies; defaults to none. */
  supplies?: Record<string, number>;
  /** Stash cap; defaults to `8`. */
  storageCap?: number;
  /** Difficulty id; defaults to the run default (`normal`). */
  difficultyId?: string;
}

/**
 * The default scenario purse — comfortably above any small party's Upkeep, so a
 * fresh scenario boot never stages the board with a spurious "underfunded → morale
 * took a hit" note (the first thing {@link "./runloop".RunLoop.camp} does is pay it).
 */
export const DEFAULT_SCENARIO_GOLD = 100;

/** The one combat node's id (also its `authoredId` binding). */
const SCENE_NODE = "scene";

/** A single-node run map whose only node is the combat scene (start == final). */
function scenarioMap(seed: string | number): OverworldMap {
  const node: MapNode = {
    id: SCENE_NODE,
    layer: 0,
    index: 0,
    kind: "combat",
    edges: [],
    authoredId: SCENE_NODE,
  };
  return {
    seed,
    layers: 1,
    nodes: { [SCENE_NODE]: node },
    startId: SCENE_NODE,
    finalIds: [SCENE_NODE],
    order: [SCENE_NODE],
  };
}

/**
 * Build a **synthetic one-node run** parked on the scenario's combat node — the
 * `{ run, loop }` a `BattleScene` (or a headless driver) stages directly. `partyName`
 * selects a variant from the config's matrix (defaults to `config.defaultParty`).
 *
 * **Fail-loud (R1):** an unknown `partyName` throws, and the assembled expedition is
 * run through {@link validateExpedition} so a malformed config surfaces at build
 * time, not as a confusing mid-boot crash. Registration is lazy (here, not at import).
 */
export function buildScenarioRun(
  config: ScenarioConfig,
  partyName: string = config.defaultParty,
): { run: RunState; loop: RunLoop } {
  const party = config.parties[partyName];
  if (!party) {
    throw new Error(
      `buildScenarioRun: scenario "${config.id}" has no party "${partyName}" ` +
        `(available: ${Object.keys(config.parties).join(", ") || "none"})`,
    );
  }
  const seed = config.seed ?? 0;
  const exp: AuthoredExpedition = {
    id: `scenario:${config.id}`,
    name: config.name,
    seed,
    map: scenarioMap(seed),
    encounters: { [SCENE_NODE]: config.encounter },
    bundle: {
      party,
      purse: config.gold ?? DEFAULT_SCENARIO_GOLD,
      supplies: config.supplies ?? {},
      storageCap: config.storageCap ?? 8,
      morale: config.morale,
      difficultyId: config.difficultyId,
    },
  };
  const problems = validateExpedition(exp);
  if (problems.length > 0) {
    throw new Error(
      `buildScenarioRun: scenario "${config.id}" is malformed:\n  - ${problems.join("\n  - ")}`,
    );
  }
  registerExpedition(exp); // lazy — never at import (keeps the catalog + sim digest clean)
  const run = createRunFromExpedition(exp);
  return { run, loop: new RunLoop(run) };
}
