/**
 * **The level sweep** — "what level does this fight need?", answered headlessly.
 *
 * Walks a route to a combat node the way the jump tool does ({@link traverseRoute}: predecessors
 * auto-played, the target chosen but unplayed), re-levels the party that arrived with the shared
 * {@link PartySetup} lever, then plays the target fight through the one game master (camp → deploy →
 * battle, exactly {@link RunLoop.playCurrentNode}'s order) and reports the result. Repeating that for
 * a range of levels turns "the finale should expect level N" from a guess into a table — which is
 * how the expedition's length gets designed: back from the level the finale wants.
 *
 * **What the numbers are.** The autopilot plays both sides, so a row is a *floor*: a human who
 * splits the deploy or drives the extraction does better. The arc's own composition is kept (who was
 * recruited on that route, their gear, their wounds); only the levels move. Combat has no damage
 * variance today, so a row is fully deterministic for its route and setup.
 *
 * Pure logic — no Phaser, no DOM, no `Math.random`. An injected body (The Rescue) needs the content
 * layer's `injectContentNodes()` to have run first; the caller owns that, as with `traverseRoute`.
 */

import { traverseRoute, type TraverseOpts } from "./expedition-sim";
import { applyPartySetup, type PartySetup } from "./party-setup";
import { encounterOutcome } from "./staging";
import { getNode } from "./overworld";
import type { EncounterResult } from "./authored";
import type { AuthoredExpedition } from "./expedition";

/** One played fight: what the party looked like going in and how it came out. */
export interface EncounterStartReport {
  /** The setup applied on arrival (the level the row is for, plus any shared tweaks). */
  setup: PartySetup;
  /** The graded outcome, or `undecided` if the fight hit the turn cap. */
  result: EncounterResult | "undecided";
  /** Player turns taken before the fight was decided. */
  playerTurns: number;
  /** Party units that went in (deployed or benched), by id → level. */
  levels: Record<string, number>;
  /** Party units that fell. */
  fallen: string[];
  /** Party HP left as a percentage of the party's total max HP (the fallen count as 0). */
  hpLeftPct: number;
}

/** What {@link playEncounterStart} and {@link sweepPartyLevel} need beyond the expedition. */
export interface EncounterStartOpts extends TraverseOpts {
  /** The party adjustments to apply on arrival (for a sweep, everything but the level). */
  setup?: PartySetup;
  /** Run flags forced on before the fight stages (`runFlagBag` builds a validated bag). */
  flags?: Record<string, boolean>;
}

/**
 * Walk `route` and play its last node — a combat node — with `opts.setup` applied to the arriving
 * party. Throws if the target is not a combat node (there is no fight to report on).
 */
export function playEncounterStart(
  exp: AuthoredExpedition,
  route: string[],
  opts: EncounterStartOpts = {},
): EncounterStartReport {
  const target = getNode(exp.map, route[route.length - 1]);
  if (target.kind !== "combat") {
    throw new Error(`playEncounterStart: "${target.id}" is a ${target.kind} node, not a fight`);
  }
  const { run, loop } = traverseRoute(exp, route, opts);
  const setup = opts.setup ?? {};
  loop.camp(); // the pre-fight camp step, as playCurrentNode runs it — before the setup, so an HP % means what it says
  applyPartySetup(run.party, setup);
  if (opts.flags) Object.assign(run.flags, opts.flags);
  const party = [...run.party];
  const levels = Object.fromEntries(party.map((u) => [u.id, u.level]));

  const battle = loop.startEncounter();
  let playerTurns = 0;
  battle.bus.on("turnStart", ({ unit }) => {
    if (unit.side === "player") playerTurns++;
  });
  loop.enterDeploy();
  loop.autoDeploy();
  loop.beginBattle();
  loop.autoBattle();
  const result = (loop.staged && encounterOutcome(loop.staged)) ?? "undecided";
  const maxHp = party.reduce((n, u) => n + u.maxHp, 0);
  const hpLeft = party.reduce((n, u) => n + (u.alive ? Math.max(0, u.hp) : 0), 0);
  const fallen = party.filter((u) => !u.alive).map((u) => u.id);
  loop.resolve();
  return {
    setup,
    result,
    playerTurns,
    levels,
    fallen,
    hpLeftPct: maxHp > 0 ? Math.round((hpLeft / maxHp) * 100) : 0,
  };
}

/**
 * Play the route's final fight once per level in `levels`, every unit set to that level (any
 * per-unit tweak in `opts.setup.units` still wins for its unit). One report per level, in order.
 */
export function sweepPartyLevel(
  exp: AuthoredExpedition,
  route: string[],
  levels: readonly number[],
  opts: EncounterStartOpts = {},
): EncounterStartReport[] {
  return levels.map((level) => playEncounterStart(exp, route, { ...opts, setup: { ...opts.setup, level } }));
}
