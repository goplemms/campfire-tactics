/**
 * The **JSON level content pipeline** (D98) — the "location the game pulls from".
 *
 * Levels authored by the visual editor (or by hand) live as `.json` files under
 * {@link ./levels}, each a serialized {@link AuthoredEncounter}. This module **glob-loads**
 * every one at build time (`import.meta.glob`, so a dropped-in file is auto-discovered — no
 * registry edit), validates it fail-loud, and registers it by `id`. A level is then playable
 * standalone via the `#level=<id>` route (which wraps it in a throwaway scenario and reuses the
 * one-node-run boot, exactly like `#scene`).
 *
 * **Layering:** this is *content*, not core — it uses Vite's `import.meta.glob`, so it can't
 * live in the pure/headless `core/`. It depends on core (the `AuthoredEncounter` shape +
 * validators); the game depends on it. A malformed level file throws at load — a git-committed,
 * CI-guarded content contract, surfaced early rather than as a mid-boot crash.
 */

import type { UnitSpec, ScenarioConfig } from "../core";
import { getEnemyTemplate, type AuthoredEncounter } from "../core";

/** Kinds a level's objectives may declare (kept in sync with the core ObjectiveKind union). */
const OBJECTIVE_KINDS = ["eliminate-all", "closing-gate", "extraction"];

/**
 * Structurally validate a parsed level file → the list of problems (empty = valid). A light
 * shape + reference check (enemy templates resolve, objective kinds are known); the deep check
 * is `stageEncounter` itself, exercised by the round-trip test.
 */
export function validateLevel(raw: unknown): string[] {
  const issues: string[] = [];
  const e = raw as Partial<AuthoredEncounter> | null;
  if (!e || typeof e !== "object") return ["not an object"];
  if (typeof e.id !== "string" || !e.id) issues.push("missing id");
  if (typeof e.name !== "string" || !e.name) issues.push("missing name");
  if (!Number.isInteger(e.cols) || (e.cols ?? 0) < 1) issues.push("cols must be a positive integer");
  if (!Number.isInteger(e.rows) || (e.rows ?? 0) < 1) issues.push("rows must be a positive integer");
  if (!Array.isArray(e.playerSpawns) || e.playerSpawns.length === 0) issues.push("needs at least one playerSpawn");
  if (!Array.isArray(e.enemies)) issues.push("enemies must be an array");
  else for (const en of e.enemies) if (!getEnemyTemplate(en?.templateId)) issues.push(`unknown enemy template "${en?.templateId}"`);
  if (e.objectives) for (const o of e.objectives) if (!OBJECTIVE_KINDS.includes(o?.kind)) issues.push(`unknown objective kind "${o?.kind}"`);
  if (!e.reward) issues.push("missing reward");
  return issues;
}

/** Glob-load every `levels/*.json` at build time; parse-validate-register by id, fail-loud. */
function loadLevels(): Record<string, AuthoredEncounter> {
  const modules = import.meta.glob<{ default: unknown }>("./levels/*.json", { eager: true });
  const registry: Record<string, AuthoredEncounter> = {};
  for (const [path, mod] of Object.entries(modules)) {
    const raw = mod.default;
    const issues = validateLevel(raw);
    if (issues.length) throw new Error(`Invalid level "${path}":\n  - ${issues.join("\n  - ")}`);
    const level = raw as AuthoredEncounter;
    if (registry[level.id]) throw new Error(`Duplicate level id "${level.id}" (${path})`);
    registry[level.id] = level;
  }
  return registry;
}

/** Every JSON level, keyed by `id` — the "location the game pulls from". */
export const LEVELS: Record<string, AuthoredEncounter> = loadLevels();

/** Look up a level by id (the `#level=<id>` boot path). */
export function getLevel(id: string): AuthoredEncounter | undefined {
  return LEVELS[id];
}

/** All loaded levels (the `#level` picker). */
export function listLevels(): AuthoredEncounter[] {
  return Object.values(LEVELS);
}

/** A generic three-body party used to playtest a standalone level. */
const STATS = { speed: 11, maxHp: 26, attack: 8, defense: 3, moveRange: 4, sightRadius: 5, attackRange: 1 };
export const LEVEL_TEST_PARTY: UnitSpec[] = [
  { id: "test-a", side: "player", pos: { col: 0, row: 0 }, jobId: "soldier", primaryJob: "soldier", ...STATS },
  { id: "test-b", side: "player", pos: { col: 0, row: 0 }, jobId: "hunter", primaryJob: "hunter", ...STATS },
  { id: "test-c", side: "player", pos: { col: 0, row: 0 }, jobId: "medic", primaryJob: "medic", ...STATS },
];

/** Wrap a level as a throwaway single-arm {@link ScenarioConfig} so it reuses the scenario boot. */
export function levelToScenario(level: AuthoredEncounter): ScenarioConfig {
  return {
    id: level.id,
    name: level.name,
    encounter: level,
    parties: { test: LEVEL_TEST_PARTY },
    defaultParty: "test",
  };
}
