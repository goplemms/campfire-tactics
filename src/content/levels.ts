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

import type { UnitSpec, ScenarioConfig, ObjectiveTag, ObjectiveSpec } from "../core";
import {
  getEnemyTemplate,
  OBJECTIVE_KINDS,
  getJob,
  getMaterial,
  isKnownRunFlag,
  runFlagIds,
  MAX_TIER,
  type AuthoredEncounter,
} from "../core";

/** Objective kinds accepted in a level file — the core list (never hand-copied, so it can't drift). */
const KINDS: readonly string[] = OBJECTIVE_KINDS;

/**
 * The **release kinds** the engine models. Mirrors `ReleaseRequirement` (`units.ts`) — a union type,
 * so there is no runtime registry to read; this list is pinned against the type by
 * `levels.test.ts` so a new kind can't be added to the union without landing here too.
 */
const RELEASE_KINDS: readonly string[] = ["reach", "lockpick"];

/**
 * **Unit identity** (validator M1) — the `jobId` class.
 *
 * `jobId` is `JobId = keyof typeof JOBS`, so in TypeScript a typo is a **build error**. As JSON it is
 * a bare string, and an unknown one resolves through `getJob()` to `undefined` — producing a unit
 * with **no job and therefore no skills**. It deploys, it fights badly, and nothing errors: the
 * silently-worthless failure that `run.flags` and `EQUIPMENT` ids both hit before being made
 * fail-loud (#216). Absent is legitimate (`jobId?`); *present and unknown* is the defect.
 */
function unitSpecIssues(spec: UnitSpec | undefined, where: string): string[] {
  if (!spec) return [];
  const issues: string[] = [];
  for (const [field, id] of [
    ["jobId", spec.jobId],
    ["primaryJob", spec.primaryJob],
  ] as const) {
    if (id !== undefined && !getJob(id)) issues.push(`${where} has unknown ${field} "${id}" — no such job (a unit with no job has no skills)`);
  }
  for (const id of spec.heldJobs ?? []) if (!getJob(id)) issues.push(`${where} holds unknown job "${id}"`);
  return issues;
}

/**
 * **Economy + grant ids** (validator M3).
 *
 * `grantItem` opens `if (!getMaterial(materialId)) return` — a misspelled reward or relic is
 * **silently never granted**, the exact shape of the `equipmentDelta` bug. `grants.flag` is worse:
 * `run.flags` is an untyped bag where an unset flag and a typo'd one are indistinguishable at the
 * gate that reads them, which is why `run-flags.ts` exists (#216). Content must not re-open that
 * door — a flag authored here is checked against the same registry a launcher checks human input
 * against.
 */
function economyIssues(e: Partial<AuthoredEncounter>): string[] {
  const issues: string[] = [];
  const reward = e.reward;
  if (reward) {
    if (typeof reward.gold !== "number" || !Number.isFinite(reward.gold)) issues.push("reward.gold must be a number");
    if (reward.xp !== undefined && (typeof reward.xp !== "number" || !Number.isFinite(reward.xp))) issues.push("reward.xp must be a number when present");
    for (const m of Array.isArray(reward.materials) ? reward.materials : [])
      if (!getMaterial(m?.id)) issues.push(`reward material "${m?.id}" is not a known material — it would be silently dropped`);
  }
  const g = e.grants;
  if (g) {
    if (g.item !== undefined && !getMaterial(g.item)) issues.push(`grants.item "${g.item}" is not a known material — grantItem would silently skip it`);
    if (g.flag !== undefined && !isKnownRunFlag(g.flag))
      issues.push(`grants.flag "${g.flag}" is not a known run flag (known: ${runFlagIds().join(", ")}) — a typo'd flag is indistinguishable from an unset one`);
    issues.push(...unitSpecIssues(g.recruit, `grants.recruit "${g.recruit?.id}"`));
  }
  return issues;
}

/**
 * **Intel scalars** (validator M4).
 *
 * `intelDepth` caps how deep a node can be scouted (`min(floor + scouting, intelDepth)`), so an
 * out-of-range value silently changes what a read can ever reveal. `rumors[i]` is revealed at tier
 * `i+1`, so a rumor **beyond** the depth is a line **no read can reach** — `authored.ts` documents
 * this as an authoring rule and nothing enforced it.
 *
 * **One-sided on purpose** (owner, 2026-07-30): *fewer* rumors than the depth is intended — a
 * shallow node genuinely has less hearsay to give. Only exceeding it is a defect.
 */
function intelIssues(e: Partial<AuthoredEncounter>): string[] {
  const issues: string[] = [];
  const depth = e.intelDepth;
  if (depth !== undefined && (!Number.isInteger(depth) || depth < 1 || depth > MAX_TIER))
    issues.push(`intelDepth must be an integer in 1..${MAX_TIER} (got ${depth})`);
  const rumors = e.rumors;
  if (Array.isArray(rumors)) {
    const cap = typeof depth === "number" ? depth : MAX_TIER;
    if (rumors.length > cap)
      issues.push(`${rumors.length} rumors but intelDepth is ${cap} — rumor ${cap + 1}+ is revealed at a tier no read can reach`);
  }
  return issues;
}

/**
 * **Tiles and numbers** (validator M4).
 *
 * Every authored coordinate must be on the board, and every authored number must be a number. In
 * TypeScript both are compile-checked; as JSON, `concealment: "4"` is a plain string that flows
 * into damage math. `spawnZoneIssues` already does exactly this for zones — this is the same shape
 * applied to the collections that had no guard.
 */
function tileIssues(e: Partial<AuthoredEncounter>): string[] {
  const issues: string[] = [];
  const cols = e.cols ?? 0;
  const rows = e.rows ?? 0;
  const onBoard = (t: { col?: number; row?: number } | undefined, what: string): void => {
    if (!t || !Number.isInteger(t.col) || !Number.isInteger(t.row)) {
      issues.push(`${what} is not a valid tile`);
      return;
    }
    if (t.col! < 0 || t.row! < 0 || t.col! >= cols || t.row! >= rows) issues.push(`${what} is off the board at (${t.col},${t.row})`);
  };

  (Array.isArray(e.blocked) ? e.blocked : []).forEach((t, i) => onBoard(t, `blocked[${i}]`));
  (Array.isArray(e.playerSpawns) ? e.playerSpawns : []).forEach((t, i) => onBoard(t, `playerSpawns[${i}]`));
  (Array.isArray(e.enemies) ? e.enemies : []).forEach((en, i) => onBoard(en?.pos, `enemy[${i}] "${en?.templateId}"`));
  (Array.isArray(e.gates) ? e.gates : []).forEach((g) => onBoard(g?.pos, `gate "${g?.id}"`));
  (Array.isArray(e.levers) ? e.levers : []).forEach((l) => onBoard(l?.pos, `lever "${l?.id}"`));

  for (const [i, t] of (Array.isArray(e.traps) ? e.traps : []).entries()) {
    onBoard(t?.pos, `trap[${i}]`);
    for (const field of ["damage", "concealment"] as const) {
      const v = t?.[field];
      if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || v < 0))
        issues.push(`trap[${i}].${field} must be a non-negative number (got ${JSON.stringify(v)})`);
    }
  }
  return issues;
}

/** Does a captive's authored spec match an objective's escort tag (by role or id)? */
function escorteeMatches(spec: UnitSpec, tag?: ObjectiveTag): boolean {
  if (!tag) return false;
  if (tag.id !== undefined) return spec.id === tag.id;
  if (tag.role !== undefined) return spec.role === tag.role;
  return false;
}

/**
 * The **walkover guard** (D97/D99): an extraction escortee authored on/near the exit trivializes the
 * rescue (a freed prisoner one move from the span = an instant win with no combat — the D97
 * challenge-F footgun). Release-agnostic (applies however the captive is freed) and distance-aware
 * (min Manhattan distance from each escortee's start to any exit-span tile must exceed its
 * `moveRange`). Also flags an extraction whose escort tag matches **no** captive — a silently dead
 * win-path. Lives in shared `validateLevel` so it protects **every** level (hand- or editor-authored),
 * not just the finale — the general form of the two file-specific test pins it supersedes.
 *
 * ## Measure from the **placement** tile, never `spec.pos`
 * A captive is staged at its {@link "../core".CaptivePlacement.pos} — `buildAuthoredCaptives` passes
 * `pos: c.pos` into `createUnit`, so the spec's own `pos` is **ignored at staging** and is free to be
 * a placeholder. Every `member()`-built spec in `hollow-mill.ts` is exactly that: `{ col: 0, row: 0 }`.
 * Reading `spec.pos` here therefore measured a tile the prisoner never stands on — and since the
 * finale's exit span contains `(0,0)`, it scored The Prison Assault's two cells (actually at col 8,
 * eight tiles out) as a **0-tile walkover**. It never fired only because all four JSON levels happen
 * to have been hand-written with `spec.pos` equal to the placement tile.
 */
function extractionIssues(e: Partial<AuthoredEncounter>): string[] {
  const issues: string[] = [];
  const captives = Array.isArray(e.captives) ? e.captives : [];
  for (const o of (e.objectives ?? []) as ObjectiveSpec[]) {
    if (o?.kind !== "extraction") continue;
    const span = Array.isArray(o.span) ? o.span : [];
    if (!span.length) continue;
    // Keep the placement beside the spec: the tag matches on the spec, the distance measures
    // from the placement. Splitting them is what produced the false walkover above.
    const escortees = captives.filter((c) => !!c?.spec && escorteeMatches(c.spec, o.escort));
    if (!escortees.length) {
      issues.push(`extraction objective "${o.id}" has no captive matching its escort tag — a dead win-path`);
      continue;
    }
    for (const c of escortees) {
      const s: UnitSpec = c.spec;
      const move = s.moveRange ?? 0;
      const start = c.pos;
      if (!start) continue; // reported by `captiveIssues` — don't double-report it here
      const nearest = Math.min(...span.map((t) => Math.abs(t.col - start.col) + Math.abs(t.row - start.row)));
      if (nearest <= move)
        issues.push(`escortee "${s.id}" starts ${nearest} tile(s) from the exit (≤ moveRange ${move}) — trivializes extraction (D97/D99 walkover)`);
    }
  }
  return issues;
}

/**
 * A captive's **placement tile** (the encounters-as-JSON challenge pass, 2026-07-30).
 *
 * `buildAuthoredCaptives` stages a captive at `c.pos` — `createUnit` then reads `spec.pos.col`, so a
 * placement-less captive is a **TypeError mid-boot**, not a load error. Nothing checked it: the
 * walkover guard is the only other reader of this field and it only runs when an `extraction`
 * objective exists, so a plain rescue level could carry a `pos`-less captive silently.
 *
 * This is a **JSON-tier hazard specifically** — in TS, `CaptivePlacement.pos` is required and a
 * missing one is a compile error. It is exactly the class D122 is about: a field that `tsc` guards
 * today and only `validateLevel` can guard once the body is data.
 */
function captiveIssues(e: Partial<AuthoredEncounter>): string[] {
  const issues: string[] = [];
  const cols = e.cols ?? 0;
  const rows = e.rows ?? 0;
  for (const [i, c] of (Array.isArray(e.captives) ? e.captives : []).entries()) {
    const who = c?.spec?.id ? `"${c.spec.id}"` : `#${i}`;
    if (!c?.spec) {
      issues.push(`captive ${who} has no spec — the staged unit is built from it`);
      continue;
    }
    const p = c.pos;
    if (!p || !Number.isInteger(p.col) || !Number.isInteger(p.row)) {
      issues.push(`captive ${who} has no valid placement pos — it is staged at this tile (spec.pos is discarded)`);
      continue;
    }
    if (p.col < 0 || p.row < 0 || p.col >= cols || p.row >= rows)
      issues.push(`captive ${who} is placed off the board at (${p.col},${p.row})`);

    // M2 — the editor/loader inversion. `encounterToDraft` REFUSES an unmodelled release kind on
    // import, while the JSON loader accepted anything: the editor was stricter than the pipeline it
    // feeds. An unknown kind falls through `deployment.ts`'s `?? { kind: "reach" }` default only
    // because it is a truthy object — so a typo'd "lockpik" silently becomes an un-pickable cell.
    const kind = c.release?.kind;
    if (kind !== undefined && !RELEASE_KINDS.includes(kind))
      issues.push(`captive ${who} has unknown release kind "${kind}" (known: ${RELEASE_KINDS.join(", ")})`);

    issues.push(...unitSpecIssues(c.spec, `captive ${who}`));
  }
  return issues;
}

/**
 * Duplicate **unit ids** collide objective-tag/unit lookup (both bind by id), so a level author
 * editing ids (M-B) must not create two units with the same id. Only explicit ids are checked —
 * an enemy with no `id` gets a unique positional default at build, so it can't clash.
 */
function idIssues(e: Partial<AuthoredEncounter>): string[] {
  const ids: string[] = [];
  for (const en of Array.isArray(e.enemies) ? e.enemies : []) if (typeof en?.id === "string") ids.push(en.id);
  for (const c of Array.isArray(e.captives) ? e.captives : []) if (typeof c?.spec?.id === "string") ids.push(c.spec.id);
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const id of ids) (seen.has(id) ? dups : seen).add(id);
  return [...dups].map((id) => `duplicate unit id "${id}" — unit ids must be unique (objective tags and lookup bind by id)`);
}

/**
 * The **spawn-zone guard** (D119). Authored zones replace the derived campfire outright, so a
 * malformed set is not a cosmetic bug: it decides where the party stands, which ground is
 * capture-immune, and when the deploy phase force-starts. Every failure below is one that would
 * otherwise surface as a mid-deploy freeze or a silently-wrong phase rather than a load error.
 *
 *  - **exactly one primary** — the primary zone is the default placement *and* the force-start
 *    anchor; zero leaves the party unplaceable, two makes the anchor ambiguous;
 *  - **the primary is never flag-gated** — a gated primary can vanish at stage time, and the
 *    party must always have somewhere to stand;
 *  - **`cap ≥ 1`, tiles non-empty** — a zone nobody may enter is a dead verb;
 *  - **tiles walkable and on-board** — a zone drawn in a wall is exactly the defect authored
 *    zones exist to fix ({@link "../core".createCampfire} lands The Rescue's core at a blocked
 *    `(0,9)`). It would also make `safeGroundRemains` false on turn one → instant overrun;
 *  - **no tile shared with a gate** — a locked gate blocks its own tile at battle construction,
 *    so a zone tile under one silently becomes unstandable *after* placement;
 *  - **no overlap between zones** — `zoneAt` resolves a tile to one zone, so an overlap makes
 *    "which entrance am I in" (and therefore the cap accounting) ambiguous.
 */
function spawnZoneIssues(e: Partial<AuthoredEncounter>): string[] {
  const zones = e.spawnZones;
  if (!Array.isArray(zones) || zones.length === 0) return [];
  const issues: string[] = [];
  const blocked = new Set((Array.isArray(e.blocked) ? e.blocked : []).map((b) => `${b?.col},${b?.row}`));
  const gates = new Set((Array.isArray(e.gates) ? e.gates : []).map((g) => `${g?.pos?.col},${g?.pos?.row}`));
  const seen = new Map<string, string>();
  const primaries = zones.filter((z) => z?.primary === true);
  if (primaries.length !== 1)
    issues.push(`spawnZones must declare exactly one primary zone (found ${primaries.length}) — it is both the default placement and the force-start anchor`);
  for (const z of zones) {
    const id = z?.id ?? "(unnamed)";
    if (typeof z?.id !== "string" || !z.id) issues.push("a spawn zone is missing an id");
    if (typeof z?.label !== "string" || !z.label) issues.push(`spawn zone "${id}" is missing a label (the entrance verb reads it)`);
    if (!Number.isInteger(z?.cap) || (z?.cap ?? 0) < 1) issues.push(`spawn zone "${id}" needs an integer cap ≥ 1`);
    if (z?.primary === true && z?.requiresFlag !== undefined)
      issues.push(`spawn zone "${id}" is primary AND flag-gated — the primary zone must always be present`);
    const tiles = Array.isArray(z?.tiles) ? z.tiles : [];
    if (tiles.length === 0) issues.push(`spawn zone "${id}" has no tiles`);
    for (const t of tiles) {
      const key = `${t?.col},${t?.row}`;
      if (!Number.isInteger(t?.col) || !Number.isInteger(t?.row) || (t?.col ?? -1) < 0 || (t?.row ?? -1) < 0 || (t?.col ?? 0) >= (e.cols ?? 0) || (t?.row ?? 0) >= (e.rows ?? 0))
        issues.push(`spawn zone "${id}" tile (${key}) is off the board`);
      else if (blocked.has(key)) issues.push(`spawn zone "${id}" tile (${key}) is blocked terrain — a zone must be standable ground`);
      if (gates.has(key)) issues.push(`spawn zone "${id}" tile (${key}) is a gate tile — a locked gate blocks it once the battle is built`);
      const owner = seen.get(key);
      if (owner !== undefined) issues.push(`spawn zones "${owner}" and "${id}" both claim tile (${key}) — zones must not overlap`);
      else seen.set(key, id);
    }
  }
  return issues;
}

/**
 * Structurally validate a parsed level file → the list of problems (empty = valid). A light
 * shape + reference check (enemy templates resolve, objective kinds are known) plus the D97/D99
 * walkover guard and unit-id uniqueness; the deep check is `stageEncounter` itself, exercised by
 * the round-trip test.
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
  if (e.objectives) for (const o of e.objectives) if (!KINDS.includes(o?.kind)) issues.push(`unknown objective kind "${o?.kind}"`);
  if (!e.reward) issues.push("missing reward");
  issues.push(...captiveIssues(e));
  issues.push(...economyIssues(e));
  issues.push(...intelIssues(e));
  issues.push(...tileIssues(e));
  issues.push(...extractionIssues(e));
  issues.push(...idIssues(e));
  issues.push(...spawnZoneIssues(e));
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
