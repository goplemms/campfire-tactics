/**
 * The level-editor draft model + serialization (D98 M2, round-trip spine D98-editor M-A) —
 * **pure, no Phaser**.
 *
 * The `#editor` scene mutates an {@link EditorDraft} by clicking tiles; this module turns that
 * draft into the {@link AuthoredEncounter} the content pipeline consumes ({@link draftToEncounter})
 * and back again ({@link encounterToDraft}, the **import** inverse). Keeping it Phaser-free means the
 * serialization is unit-tested directly against `validateLevel` + `stageEncounter` — proving the
 * editor emits **pipeline-valid, playable** levels, and that a load→edit→save cycle is **lossless**.
 *
 * ## Lossless import (M-A)
 * {@link encounterToDraft} / {@link draftToEncounter} are an inverse pair: for any pipeline level
 * `L`, `draftToEncounter(encounterToDraft(L))` is **structurally equal** to `L` (deep-equal — not
 * byte-identical, since the editor's `JSON.stringify(_, null, 2)` formatter differs from a
 * hand-formatted file). Fields the editor cannot yet *edit* still **round-trip**: per-entity extras
 * (enemy `id`/`role`/`overrides`/`hidden`, a captive's full `spec`) ride on the draft entity, and
 * top-level un-modeled scalars (`reward`, `objectives`, `rumors`, `intelDepth`, `grants`) ride in the
 * {@link EditorDraft._passthrough} bag. Later milestones graduate a field group from the bag/carry into
 * a real control without ever making import lossy. Import is **fail-loud** for the few shapes M-A
 * genuinely cannot carry (see {@link encounterToDraft}).
 */

import type { GridCoord, UnitSpec, UnitStats, AuthoredEncounter, ObjectiveSpec, ObjectiveTag } from "../core";
import { getEnemyTemplate } from "../core";

/** A brush the editor paints with — what a tile click stamps. `select` opens the identity/stat inspector (M-B). */
export type Brush = "select" | "wall" | "spawn" | "enemy" | "captive" | "exit" | "trap" | "erase";

/**
 * The combat stat fields the inspector edits — typed against {@link UnitStats} so a **rename or
 * removal is a compile error** (the D98 no-drift discipline; a genuinely *new* stat is a deliberate
 * one-line addition here). Shared by the enemy-override and captive-spec editors.
 */
export const STAT_FIELDS = ["speed", "maxHp", "attack", "defense", "moveRange", "sightRadius", "attackRange"] as const satisfies readonly (keyof UnitStats)[];
export type StatField = (typeof STAT_FIELDS)[number];

/** A placed enemy: a template id at a tile, plus authored extras carried through import (M-A). */
export interface DraftEnemy {
  templateId: string;
  pos: GridCoord;
  /** Explicit unit id (e.g. `the-warden`) — carried; editable in M-B. */
  id?: string;
  /** Objective role tag (a captain, a closing-gate sapper) — carried; editable in M-B. */
  role?: "sapper" | "captain";
  /** Stat overrides (a tougher captain) — carried; editable in M-B. */
  overrides?: Partial<UnitSpec>;
  /** An ambush body hidden until scouted — carried; editable in M-B. */
  hidden?: boolean;
}

/**
 * A placed captive: a tile + how it's freed (a lockpick captive is an extraction prisoner). An
 * imported captive carries its full authored {@link UnitSpec} so identity/stats survive a round-trip;
 * a freshly-painted captive has no `spec` and one is synthesized on export ({@link captiveSpec}).
 */
export interface DraftCaptive {
  pos: GridCoord;
  release: "reach" | "lockpick";
  /** The authored unit spec (carried on import; editable in M-B). Absent ⇒ synthesized on export. */
  spec?: UnitSpec;
}

/**
 * Top-level {@link AuthoredEncounter} fields the editor does not yet paint but must **preserve**
 * across a round-trip — the passthrough bag. Each is graduated into a real control by a later
 * milestone (objectives + reward → M-C; rumors/intelDepth/grants → M-E), at which point it moves out
 * of the bag. Until then it rides here untouched, so import is never lossy.
 */
export interface DraftPassthrough {
  reward?: AuthoredEncounter["reward"];
  objectives?: ObjectiveSpec[];
  rumors?: AuthoredEncounter["rumors"];
  intelDepth?: AuthoredEncounter["intelDepth"];
  grants?: AuthoredEncounter["grants"];
}

/** The editor's mutable working state — a superset of what it can currently paint. */
export interface EditorDraft {
  id: string;
  name: string;
  cols: number;
  rows: number;
  blocked: GridCoord[];
  playerSpawns: GridCoord[];
  enemies: DraftEnemy[];
  captives: DraftCaptive[];
  /** Extraction exit tiles — a freed prisoner escorted here wins by extraction (D97). */
  exit: GridCoord[];
  traps: GridCoord[];
  /** Un-editable-yet fields preserved verbatim across import (M-A). See {@link DraftPassthrough}. */
  _passthrough?: DraftPassthrough;
}

/** A fresh blank draft at the given size. */
export function blankDraft(cols = 9, rows = 6): EditorDraft {
  return { id: "new-level", name: "New Level", cols, rows, blocked: [], playerSpawns: [], enemies: [], captives: [], exit: [], traps: [] };
}

const CAPTIVE_STATS = { speed: 10, maxHp: 22, attack: 6, defense: 2, moveRange: 4, sightRadius: 5, attackRange: 1 };

/** A captive's authored unit spec — role `"prisoner"` so the extraction objective binds to it. */
function captiveSpec(i: number, pos: GridCoord): UnitSpec {
  return { id: `prisoner-${i}`, name: "Prisoner", side: "player", pos, jobId: "soldier", primaryJob: "soldier", role: "prisoner", ...CAPTIVE_STATS };
}

/**
 * A materialized captive spec for the **inspector** (M-B) — a spec-less painted captive gets one the
 * moment it's selected for editing, keyed by tile so two fresh captives don't collide (the
 * id-uniqueness guard flags a real clash live if the author later renames into one).
 */
export function newCaptiveSpec(pos: GridCoord): UnitSpec {
  return { id: `prisoner-${pos.col}-${pos.row}`, name: "Prisoner", side: "player", pos, jobId: "soldier", primaryJob: "soldier", role: "prisoner", ...CAPTIVE_STATS };
}

/** A placed enemy's template base value for a stat (attackRange defaults to 1; a missing template ⇒ 0). */
export function enemyBaseStat(templateId: string, field: StatField): number {
  const t = getEnemyTemplate(templateId) as Record<string, unknown> | undefined;
  const v = t?.[field];
  return typeof v === "number" ? v : field === "attackRange" ? 1 : 0;
}

/** The effective stat on a placed enemy — an override if set, else the template base. */
export function effectiveEnemyStat(enemy: DraftEnemy, field: StatField): number {
  const o = enemy.overrides?.[field];
  return typeof o === "number" ? o : enemyBaseStat(enemy.templateId, field);
}

/**
 * Set an enemy stat via the **diff-on-edit** rule (M-B): store it in `overrides` only when it
 * differs from the template base, else drop it — so an *edited* enemy stays tidy. An untouched
 * (imported) `overrides` is preserved verbatim by never routing through here (M-A losslessness).
 */
export function setEnemyStat(enemy: DraftEnemy, field: StatField, value: number): void {
  const base = enemyBaseStat(enemy.templateId, field);
  const o: Partial<UnitSpec> = { ...(enemy.overrides ?? {}) };
  if (value === base) delete o[field];
  else o[field] = value;
  if (Object.keys(o).length) enemy.overrides = o;
  else delete enemy.overrides;
}

/** Set a captive spec's stat directly (a captive carries a full spec, so no template diff). */
export function setSpecStat(spec: UnitSpec, field: StatField, value: number): void {
  spec[field] = value;
}

const cp = (c: GridCoord): GridCoord => ({ col: c.col, row: c.row });

/** The exit tiles implied by an encounter's extraction objective (render-only; serialization uses the objective). */
function exitTilesOf(enc: AuthoredEncounter): GridCoord[] {
  const extraction = enc.objectives?.find((o) => o.kind === "extraction");
  return (extraction?.span ?? []).map(cp);
}

/**
 * Import: turn a pipeline {@link AuthoredEncounter} into an editable {@link EditorDraft}, the inverse
 * of {@link draftToEncounter}. Editable fields map onto the draft; per-entity extras ride on the draft
 * entity; un-modeled top-level scalars ride in `_passthrough`. **Fail-loud** on the shapes M-A cannot
 * carry losslessly (rather than silently dropping them):
 * - a **trap with extras** (`id`/`damage`/`concealment`) — traps are positions-only until M-E;
 * - a **captive release kind** the editor's `reach`/`lockpick` palette doesn't model.
 */
export function encounterToDraft(enc: AuthoredEncounter): EditorDraft {
  for (const t of enc.traps ?? []) {
    if (t.id !== undefined || t.damage !== undefined || t.concealment !== undefined)
      throw new Error(`import: trap at (${t.pos.col},${t.pos.row}) has id/damage/concealment — trap params aren't editable yet (a later editor milestone). Refusing rather than dropping them.`);
  }

  const captives: DraftCaptive[] = (enc.captives ?? []).map((c) => {
    const kind = c.release?.kind ?? "reach";
    if (kind !== "reach" && kind !== "lockpick")
      throw new Error(`import: captive "${c.spec.id}" has release kind "${kind}" — the editor models only reach/lockpick. Refusing rather than dropping it.`);
    return { pos: cp(c.pos), release: kind, spec: c.spec };
  });

  const pt: DraftPassthrough = {};
  if (enc.reward) pt.reward = enc.reward;
  if (enc.objectives) pt.objectives = enc.objectives;
  if (enc.rumors) pt.rumors = enc.rumors;
  if (enc.intelDepth !== undefined) pt.intelDepth = enc.intelDepth;
  if (enc.grants) pt.grants = enc.grants;

  return {
    id: enc.id,
    name: enc.name,
    cols: enc.cols,
    rows: enc.rows,
    blocked: enc.blocked.map(cp),
    playerSpawns: enc.playerSpawns.map(cp),
    enemies: enc.enemies.map((e) => ({
      templateId: e.templateId,
      pos: cp(e.pos),
      ...(e.id !== undefined ? { id: e.id } : {}),
      ...(e.role ? { role: e.role } : {}),
      ...(e.overrides ? { overrides: e.overrides } : {}),
      ...(e.hidden ? { hidden: e.hidden } : {}),
    })),
    captives,
    exit: exitTilesOf(enc),
    traps: (enc.traps ?? []).map((t) => cp(t.pos)),
    ...(Object.keys(pt).length ? { _passthrough: pt } : {}),
  };
}

/**
 * Serialize a draft into the {@link AuthoredEncounter} the pipeline loads. Objectives + reward come
 * from `_passthrough` when an imported level supplied them; otherwise objectives are **derived** —
 * the default elimination goal plus, when the draft has both exit tiles and prisoners, an OR'd
 * `extraction` goal bound to the exit span (the D97 finale shape). Per-entity extras (enemy id/role/…,
 * a captive's carried spec) round-trip; a freshly-painted captive gets a synthesized spec. Empty
 * collections are omitted so the JSON stays tidy.
 */
export function draftToEncounter(draft: EditorDraft): AuthoredEncounter {
  const pt = draft._passthrough ?? {};
  const captives = draft.captives.map((c, i) => ({ spec: c.spec ?? captiveSpec(i, c.pos), pos: c.pos, release: { kind: c.release } }));

  const hasExtraction = draft.exit.length > 0 && draft.captives.length > 0;
  const derivedObjectives: ObjectiveSpec[] | undefined = hasExtraction
    ? [
        { id: "storm", kind: "eliminate-all", required: true, label: "Defeat the garrison" },
        { id: "extract", kind: "extraction", required: true, label: "Escort the prisoners to the exit", span: [...draft.exit], escort: { role: "prisoner" } as ObjectiveTag },
      ]
    : undefined;
  const objectives = pt.objectives ?? derivedObjectives;

  return {
    id: draft.id,
    name: draft.name,
    cols: draft.cols,
    rows: draft.rows,
    blocked: [...draft.blocked],
    playerSpawns: [...draft.playerSpawns],
    enemies: draft.enemies.map((e) => ({
      templateId: e.templateId,
      pos: e.pos,
      ...(e.id !== undefined ? { id: e.id } : {}),
      ...(e.role ? { role: e.role } : {}),
      ...(e.overrides ? { overrides: e.overrides } : {}),
      ...(e.hidden ? { hidden: e.hidden } : {}),
    })),
    ...(captives.length ? { captives } : {}),
    ...(draft.traps.length ? { traps: draft.traps.map((pos) => ({ pos })) } : {}),
    ...(pt.rumors ? { rumors: pt.rumors } : {}),
    ...(pt.intelDepth !== undefined ? { intelDepth: pt.intelDepth } : {}),
    ...(objectives ? { objectives } : {}),
    reward: pt.reward ?? { gold: 50, materials: [], xp: 40 },
    ...(pt.grants ? { grants: pt.grants } : {}),
  };
}
