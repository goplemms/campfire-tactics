/**
 * Editor **local persistence** (D-editor) — keep authored maps across browser sessions in
 * `localStorage`, so a reload never loses in-progress work and previous test attempts stay
 * on hand. Two stores, both browser-local (a browser editor can't write repo files — that's
 * what Download `.json` is for; this is the working scratch layer beside it):
 *
 * - **working** (`WORKING_KEY`) — the current draft, autosaved on every edit and restored on
 *   the next boot ("pick up where you left off").
 * - **library** (`LIBRARY_KEY`) — a named set of saved maps (Save / Load / Delete), so several
 *   attempts survive to load from later.
 *
 * Everything is stored as the raw {@link EditorDraft} JSON (lossless — it *is* the editor's
 * state, including in-progress/invalid drafts) and **sanitized fail-safe on load**
 * ({@link sanitizeDraft}): a tampered, truncated, or stale-shape blob resolves to a known-good
 * draft (or is dropped), so a bad store can never wedge the editor — the same discipline the
 * prefs loader uses. All reads/writes are wrapped so a denied/absent/full `localStorage`
 * degrades to "no persistence", never a throw.
 */

import { blankDraft, type EditorDraft, type DraftEnemy, type DraftCaptive } from "./editor-draft";
import type { GridCoord, AuthoredGate, AuthoredLever } from "../core";

const WORKING_KEY = "campfire-editor-working";
const LIBRARY_KEY = "campfire-editor-maps";

/** A saved library entry — the draft plus when it was stored (for a "saved …" hint + ordering). */
export interface SavedMap {
  name: string;
  savedAt: number;
  draft: EditorDraft;
}

/** The on-disk library shape: name → { savedAt, draft }. */
type LibraryStore = Record<string, { savedAt: number; draft: EditorDraft }>;

function readLS(key: string): string | null {
  try { return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null; } catch { return null; }
}
/** Write to localStorage; returns whether it stuck (false on quota/denied) so callers can be truthful. */
function writeLS(key: string, val: string): boolean {
  try { localStorage?.setItem(key, val); return true; } catch { return false; /* quota / denied */ }
}

const clampInt = (v: unknown, lo: number, hi: number, dflt: number): number =>
  Number.isInteger(v) ? Math.max(lo, Math.min(hi, v as number)) : dflt;

/**
 * Coerce an arbitrary parsed blob into a **known-good** {@link EditorDraft}, or `null` if it isn't
 * even draft-shaped. Grid dimensions clamp to the editor's 1..20; every collection defaults to `[]`
 * and its coords are **bounds-filtered** to the (clamped) board; rich entities are kept when they
 * carry the minimum a render needs (a template id + an in-bounds pos), else dropped. Trusts the
 * editor's own nested extras (overrides/specs/openBy) — it round-trips its own writes — but can never
 * be *crashed* by a hand-tampered or version-drifted store.
 */
export function sanitizeDraft(raw: unknown): EditorDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const cols = clampInt(r.cols, 1, 20, 9);
  const rows = clampInt(r.rows, 1, 20, 6);
  const inB = (c: unknown): c is GridCoord => {
    const g = c as GridCoord | undefined;
    return !!g && Number.isInteger(g.col) && Number.isInteger(g.row) && g.col >= 0 && g.col < cols && g.row >= 0 && g.row < rows;
  };
  const coords = (v: unknown): GridCoord[] => (Array.isArray(v) ? v.filter(inB).map((c) => ({ col: c.col, row: c.row })) : []);

  const out = blankDraft(cols, rows);
  if (typeof r.id === "string" && r.id) out.id = r.id;
  if (typeof r.name === "string" && r.name) out.name = r.name;
  out.blocked = coords(r.blocked);
  out.playerSpawns = coords(r.playerSpawns);
  out.exit = coords(r.exit);
  out.traps = coords(r.traps);
  out.enemies = Array.isArray(r.enemies)
    ? (r.enemies as DraftEnemy[]).filter((e) => e && typeof e.templateId === "string" && inB(e.pos))
    : [];
  out.captives = Array.isArray(r.captives)
    ? (r.captives as DraftCaptive[]).filter((c) => c && inB(c.pos))
    : [];
  out.gates = Array.isArray(r.gates)
    ? (r.gates as AuthoredGate[]).filter((g) => g && inB(g.pos) && Array.isArray(g.openBy))
    : [];
  out.levers = Array.isArray(r.levers)
    ? (r.levers as AuthoredLever[]).filter((l) => l && inB(l.pos) && Array.isArray(l.targets))
    : [];
  if (Array.isArray(r.objectives)) out.objectives = r.objectives as EditorDraft["objectives"];
  if (r.reward && typeof r.reward === "object") out.reward = r.reward as EditorDraft["reward"];
  if (r._passthrough && typeof r._passthrough === "object") out._passthrough = r._passthrough as EditorDraft["_passthrough"];
  return out;
}

// --- Working draft (autosave) ------------------------------------------------

/** The autosaved working draft, sanitized — or `null` if none/unreadable/corrupt (⇒ blank start). */
export function loadWorking(): EditorDraft | null {
  const raw = readLS(WORKING_KEY);
  if (!raw) return null;
  try { return sanitizeDraft(JSON.parse(raw)); } catch { return null; }
}

/** Autosave the working draft (raw, lossless). Silently no-ops if storage is unavailable/full. */
export function saveWorking(draft: EditorDraft): void {
  writeLS(WORKING_KEY, JSON.stringify(draft));
}

// --- Named library (Save / Load / Delete) ------------------------------------

function readLibrary(): LibraryStore {
  const raw = readLS(LIBRARY_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as LibraryStore) : {};
  } catch {
    return {};
  }
}

/** Every saved map, sanitized + newest-first. A corrupt entry is skipped, not fatal. */
export function loadLibrary(): SavedMap[] {
  const store = readLibrary();
  const maps: SavedMap[] = [];
  for (const [name, entry] of Object.entries(store)) {
    const draft = sanitizeDraft(entry?.draft);
    if (draft) maps.push({ name, savedAt: typeof entry.savedAt === "number" ? entry.savedAt : 0, draft });
  }
  return maps.sort((a, b) => b.savedAt - a.savedAt);
}

/**
 * Save `draft` into the library under `name` (overwriting a same-named entry — the deliberate
 * "update this attempt" path). `now` is passed in (a timestamp) so the module stays free of an
 * ambient clock. Returns the stored {@link SavedMap} (or `null` if storage refused).
 */
export function saveToLibrary(name: string, draft: EditorDraft, now: number): SavedMap | null {
  const key = name.trim() || "untitled";
  const store = readLibrary();
  store[key] = { savedAt: now, draft };
  if (!writeLS(LIBRARY_KEY, JSON.stringify(store))) return null; // quota/denied — report the failure, don't lie
  return { name: key, savedAt: now, draft };
}

/** Remove a saved map by name. */
export function deleteFromLibrary(name: string): void {
  const store = readLibrary();
  if (name in store) {
    delete store[name];
    writeLS(LIBRARY_KEY, JSON.stringify(store));
  }
}
