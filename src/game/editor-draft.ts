/**
 * The level-editor draft model + serialization (D98 M2) — **pure, no Phaser**.
 *
 * The `#editor` scene mutates an {@link EditorDraft} by clicking tiles; this module turns that
 * draft into the {@link AuthoredEncounter} the content pipeline consumes ({@link draftToEncounter}).
 * Keeping it Phaser-free means the serialization is unit-tested directly against `validateLevel` +
 * `stageEncounter` — proving the editor emits **pipeline-valid, playable** levels.
 */

import type { GridCoord, UnitSpec, AuthoredEncounter, ObjectiveSpec } from "../core";

/** A brush the editor paints with — what a tile click stamps. */
export type Brush = "wall" | "spawn" | "enemy" | "captive" | "exit" | "trap" | "erase";

/** A placed enemy: a template id at a tile. */
export interface DraftEnemy {
  templateId: string;
  pos: GridCoord;
}

/** A placed captive: a tile + how it's freed (a lockpick captive is an extraction prisoner). */
export interface DraftCaptive {
  pos: GridCoord;
  release: "reach" | "lockpick";
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
 * Serialize a draft into the {@link AuthoredEncounter} the pipeline loads. Objectives are
 * **derived**: always the default elimination goal, plus — when the draft has both exit tiles
 * and prisoners — an OR'd `extraction` goal bound to the exit span (the D97 finale shape). Empty
 * collections are omitted so the JSON stays tidy.
 */
export function draftToEncounter(draft: EditorDraft): AuthoredEncounter {
  const captives = draft.captives.map((c, i) => ({ spec: captiveSpec(i, c.pos), pos: c.pos, release: { kind: c.release } }));
  const hasExtraction = draft.exit.length > 0 && draft.captives.length > 0;
  const objectives: ObjectiveSpec[] | undefined = hasExtraction
    ? [
        { id: "storm", kind: "eliminate-all", required: true, label: "Defeat the garrison" },
        { id: "extract", kind: "extraction", required: true, label: "Escort the prisoners to the exit", span: [...draft.exit], escort: { role: "prisoner" } },
      ]
    : undefined;

  return {
    id: draft.id,
    name: draft.name,
    cols: draft.cols,
    rows: draft.rows,
    blocked: [...draft.blocked],
    playerSpawns: [...draft.playerSpawns],
    enemies: draft.enemies.map((e) => ({ templateId: e.templateId, pos: e.pos })),
    ...(captives.length ? { captives } : {}),
    ...(draft.traps.length ? { traps: draft.traps.map((pos) => ({ pos })) } : {}),
    ...(objectives ? { objectives } : {}),
    reward: { gold: 50, materials: [], xp: 40 },
  };
}
