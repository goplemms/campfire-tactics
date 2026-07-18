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

import type { GridCoord, UnitSpec, UnitStats, AuthoredEncounter, ObjectiveSpec, ObjectiveTag, EncounterReward } from "../core";
import { getEnemyTemplate } from "../core";

/**
 * A brush the editor paints with — what a tile click stamps. `select` opens the identity/stat
 * inspector (M-B). `line`/`rect` are **two-click wall shape tools** (M-D): click an anchor, click
 * the far tile, and the run/box of walls lands in one gesture — the structural-authoring workhorses
 * (a prison's perimeter, corridors, and cell rings are wall shapes, not one-off tiles).
 */
export type Brush = "select" | "wall" | "line" | "rect" | "spawn" | "enemy" | "captive" | "exit" | "trap" | "erase";

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
 * milestone, at which point it moves out of the bag. **objectives + reward graduated (M-C)** — they
 * are now first-class {@link EditorDraft} fields with real controls; only `rumors/intelDepth/grants`
 * (→ M-E) still ride here untouched, so import stays lossless.
 */
export interface DraftPassthrough {
  rumors?: AuthoredEncounter["rumors"];
  intelDepth?: AuthoredEncounter["intelDepth"];
  grants?: AuthoredEncounter["grants"];
  /** Interactable gates (D103) — round-trip verbatim until the editor grows a gate brush (Phase 2b). */
  gates?: AuthoredEncounter["gates"];
  /** Control-room levers (D103) — round-trip verbatim until the editor grows a lever brush (Phase 2b). */
  levers?: AuthoredEncounter["levers"];
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
  /**
   * Authored objectives (M-C, graduated from the passthrough bag). **Empty ⇒ auto-derive** at export
   * (the default elimination goal, plus the OR'd extraction pair when the board has exit tiles +
   * captives) — so painting a rescue still "just works". A non-empty list is authored verbatim; an
   * extraction row's `span` is (re)bound to the painted {@link exit} tiles on export, keeping the exit
   * brush the single source for the span.
   */
  objectives?: ObjectiveSpec[];
  /** Authored win reward (M-C, graduated). Absent ⇒ the tidy default (`{ gold: 50, xp: 40 }`). */
  reward?: EncounterReward;
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
    // Clone the spec (the inspector edits it in place) so a draft never aliases the source
    // encounter's objects — importing then editing must not mutate the input (or the shared registry).
    return { pos: cp(c.pos), release: kind, spec: { ...c.spec, pos: cp(c.spec.pos) } };
  });

  const pt: DraftPassthrough = {};
  if (enc.rumors) pt.rumors = enc.rumors;
  if (enc.intelDepth !== undefined) pt.intelDepth = enc.intelDepth;
  if (enc.grants) pt.grants = enc.grants;
  if (enc.gates) pt.gates = enc.gates;
  if (enc.levers) pt.levers = enc.levers;

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
      ...(e.overrides ? { overrides: { ...e.overrides } } : {}),
      ...(e.hidden ? { hidden: e.hidden } : {}),
    })),
    captives,
    exit: exitTilesOf(enc),
    traps: (enc.traps ?? []).map((t) => cp(t.pos)),
    // Objectives + reward are first-class now (M-C) — cloned so the inspector never mutates the source.
    ...(enc.objectives ? { objectives: enc.objectives.map(cloneObjective) } : {}),
    ...(enc.reward ? { reward: { ...enc.reward, materials: enc.reward.materials.map((m) => ({ ...m })) } } : {}),
    ...(Object.keys(pt).length ? { _passthrough: pt } : {}),
  };
}

/**
 * The **standard rescue objectives** (D97): the required `eliminate-all` goal, plus — when the board
 * has exit tiles and captives — the OR'd `extraction` goal bound to the exit span. The single source
 * for both the export-time derive (when `draft.objectives` is empty) and the editor's "derive from
 * board" button (which drops the pair into the list so labels/`required` become tunable), so the two
 * can't drift.
 */
export function standardObjectives(exit: GridCoord[], hasCaptives: boolean): ObjectiveSpec[] {
  const objs: ObjectiveSpec[] = [{ id: "storm", kind: "eliminate-all", required: true, label: "Defeat the garrison" }];
  if (exit.length > 0 && hasCaptives)
    objs.push({ id: "extract", kind: "extraction", required: true, label: "Escort the prisoners to the exit", span: exit.map(cp), escort: { role: "prisoner" } as ObjectiveTag });
  return objs;
}

/** Deep-ish clone of an objective (span coords + tags copied) so an edit never touches the source encounter. */
function cloneObjective(o: ObjectiveSpec): ObjectiveSpec {
  return {
    ...o,
    ...(o.span ? { span: o.span.map(cp) } : {}),
    ...(o.driver ? { driver: { ...o.driver } } : {}),
    ...(o.escort ? { escort: { ...o.escort } } : {}),
  };
}

/**
 * Serialize a draft into the {@link AuthoredEncounter} the pipeline loads. Objectives + reward are
 * first-class draft fields now (M-C): when `draft.objectives` is **non-empty** it's authored verbatim
 * (each `extraction` row's `span` re-bound to the painted exit tiles — the exit brush stays the one
 * span source); when it's **empty** objectives are **derived** — the default elimination goal plus,
 * with both exit tiles and prisoners, the OR'd `extraction` pair (the D97 finale shape). Per-entity
 * extras round-trip; a freshly-painted captive gets a synthesized spec. Empty collections are omitted.
 */
export function draftToEncounter(draft: EditorDraft): AuthoredEncounter {
  const pt = draft._passthrough ?? {};
  const captives = draft.captives.map((c, i) => ({ spec: c.spec ?? captiveSpec(i, c.pos), pos: c.pos, release: { kind: c.release } }));

  const hasExtraction = draft.exit.length > 0 && draft.captives.length > 0;
  // Authored list wins; an extraction row's span is (re)bound to the painted exit tiles. Empty ⇒ the
  // derived shape (the OR'd rescue pair when the board has an exit + captives, else none → staging
  // injects the default elimination goal, keeping a plain combat level's JSON tidy).
  const authored = draft.objectives?.length
    ? draft.objectives.map((o) => (o.kind === "extraction" ? { ...o, span: [...draft.exit] } : { ...o }))
    : undefined;
  const objectives = authored ?? (hasExtraction ? standardObjectives(draft.exit, true) : undefined);

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
    ...(pt.gates ? { gates: pt.gates } : {}),
    ...(pt.levers ? { levers: pt.levers } : {}),
    ...(objectives ? { objectives } : {}),
    reward: draft.reward ?? { gold: 50, materials: [], xp: 40 },
    ...(pt.grants ? { grants: pt.grants } : {}),
  };
}
