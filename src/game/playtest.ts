/**
 * Editor **soft play** (playtest) support — turn a draft {@link AuthoredEncounter} into a
 * live `{ run, loop }` the real {@link "./scenes/BattleScene"} stages, so an author can
 * *functionally* test a level from `#editor` without the export → drop-in-`content/levels/`
 * → reload round-trip. Deploy the squad, watch the AI, feel the spacing — then bounce back
 * to the editor (the `returnTo` handoff) with the draft intact.
 *
 * **Flexible party selection (owner ask).** Some levels are tailored to a specific class or
 * squad, so *which* party you field matters. This is a small **registry of named playtest
 * squads** ({@link PLAYTEST_PARTIES}) that the editor surfaces as a picker; it maps straight
 * onto the scenario harness's existing party matrix ({@link ScenarioConfig.parties}), so
 * adding a squad is one entry here — no new plumbing. The default is a small standard party;
 * the flavoured squads exist to prove (and use) the selection seam.
 *
 * Thin glue over the pure core ({@link buildScenarioRun}) — no rules of its own.
 */

import { buildScenarioRun, type AuthoredEncounter, type ScenarioConfig, type UnitSpec, type JobId, type RunState, type RunLoop } from "../core";

/** A serviceable all-round stat block — every playtest body shares it; the *job* is the variable. */
const BASE = { speed: 11, maxHp: 26, attack: 8, defense: 3, moveRange: 4, sightRadius: 5, attackRange: 1 } as const;

/** One playtest body of the given job. Positions default to the home edge — Deployment places them. */
function body(job: JobId, n: number): UnitSpec {
  return { id: `test-${job}-${n}`, side: "player", pos: { col: 0, row: 0 }, jobId: job, primaryJob: job, ...BASE };
}

/**
 * The named playtest squads the editor's party picker offers. **Standard (3)** is the small
 * default (the same soldier/hunter/medic trio `#level=<id>` playtests with); the rest are
 * flavoured squads for levels built around a class or a size — a bigger front line, a mobile
 * skirmish line, an infiltration cell for extraction maps, or a lone body for tight boards.
 * Add a squad by adding a key; the picker and the scenario both pick it up with no other change.
 */
export const PLAYTEST_PARTIES: Record<string, UnitSpec[]> = {
  "Standard (3)": [body("soldier", 1), body("hunter", 1), body("medic", 1)],
  "Vanguard (5)": [body("heavy-knight", 1), body("soldier", 1), body("hunter", 1), body("scout", 1), body("medic", 1)],
  "Skirmishers (4)": [body("scout", 1), body("hunter", 1), body("hunter", 2), body("medic", 1)],
  "Infiltration (3)": [body("thief", 1), body("scout", 1), body("medic", 1)],
  "Solo (1)": [body("soldier", 1)],
};

/** The squad fielded when the author hasn't chosen otherwise — a small, standard trio. */
export const DEFAULT_PLAYTEST_PARTY = "Standard (3)";

/** The playtest squad names, in registry order — the editor's picker options. */
export function playtestPartyNames(): string[] {
  return Object.keys(PLAYTEST_PARTIES);
}

/** Wrap an encounter as a scenario whose party matrix is the full playtest registry. */
export function playtestScenario(enc: AuthoredEncounter): ScenarioConfig {
  return { id: enc.id, name: enc.name, encounter: enc, parties: PLAYTEST_PARTIES, defaultParty: DEFAULT_PLAYTEST_PARTY };
}

/**
 * Build the `{ run, loop }` for a soft-play of `enc` with the named squad (defaults to the
 * standard trio). Fail-loud on an unknown squad or a malformed encounter (via
 * {@link buildScenarioRun}) — the editor gates on {@link "../content/levels".validateLevel}
 * first, so a genuine throw here means a bug worth surfacing, not a bad paint.
 */
export function buildPlaytest(enc: AuthoredEncounter, partyName: string = DEFAULT_PLAYTEST_PARTY): { run: RunState; loop: RunLoop } {
  return buildScenarioRun(playtestScenario(enc), partyName);
}
