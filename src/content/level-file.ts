/**
 * **A level's file on disk** — the one spelling for where an authored level lives and how it is written.
 *
 * Shared by both ends of the editor's **Save to game** (the browser side in `EditorScene`, the dev-server
 * side in `level-save-plugin.ts` beside `vite.config.ts`), so the file name the editor promises and the
 * file the server writes cannot drift apart. Dependency-free on purpose: the dev server loads it from the
 * Vite config, where neither `core/` nor `import.meta.glob` is available.
 *
 * Full level validation stays where it is ({@link "./levels".validateLevel}, run by the editor before it
 * sends, and again fail-loud by the level loader on the next boot). This module only guards what the
 * **server** must never get wrong on its own: a safe file name, and a body that is a level-shaped object.
 */

/** A level id is its file name: lower-case words joined by single hyphens (`the-rescue`, `e1-skirmish`). */
export const LEVEL_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Why an id can't be a file name, or `undefined` when it can. */
export function levelIdIssue(id: unknown): string | undefined {
  if (typeof id !== "string" || id === "") return "the level needs an id (Scenario › Identity)";
  if (id.length > 64) return `the id "${id.slice(0, 20)}…" is too long (64 characters at most)`;
  if (!LEVEL_ID_PATTERN.test(id))
    return `the id "${id}" can't be a file name — use lower-case letters, digits and single hyphens (like "the-rescue")`;
  return undefined;
}

/** The file a level is stored in, inside `src/content/levels/`. Throws on an id that isn't a safe name. */
export function levelFileName(id: string): string {
  const issue = levelIdIssue(id);
  if (issue) throw new Error(issue);
  return `${id}.json`;
}

/** The text a level file holds: two-space JSON plus a trailing newline, the shape the shipped files use. */
export function formatLevelJson(level: unknown): string {
  return `${JSON.stringify(level, null, 2)}\n`;
}

/**
 * `obj` with its top-level keys in `model`'s order, then any keys `model` lacks in their own order.
 *
 * The editor rebuilds a level from its draft, so its key order is the editor's, not the file's. Saving
 * an edited shipped level in the file's own order keeps the git diff to what actually changed.
 */
export function orderKeysLike<T extends object>(obj: T, model: object | undefined): T {
  if (!model) return obj;
  const src = obj as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(model)) if (k in src) out[k] = src[k];
  for (const k of Object.keys(src)) if (!(k in out)) out[k] = src[k];
  return out as T;
}

/** What the editor posts to the dev server. `overwrite` must be true to replace an existing file. */
export interface SaveLevelRequest {
  level: unknown;
  overwrite?: boolean;
}

/** The server's answer. `exists` means the file is there and `overwrite` wasn't set. */
export type SaveLevelResponse =
  | { status: "saved"; file: string; replaced: boolean }
  | { status: "exists"; file: string }
  | { status: "refused"; reason: string };

/** The dev-server route the editor posts to. */
export const SAVE_LEVEL_ROUTE = "/__campfire/save-level";

/**
 * Check a posted request before anything touches the disk. Returns the file name and text to write, or
 * the reason to refuse. Pure, so the server's whole decision is unit-tested without a server.
 */
export function checkSaveRequest(body: unknown): { ok: true; file: string; text: string; overwrite: boolean } | { ok: false; reason: string } {
  if (!body || typeof body !== "object") return { ok: false, reason: "the request has no body" };
  const { level, overwrite } = body as SaveLevelRequest;
  if (!level || typeof level !== "object" || Array.isArray(level)) return { ok: false, reason: "the request has no level" };
  const l = level as Record<string, unknown>;
  const idIssue = levelIdIssue(l.id);
  if (idIssue) return { ok: false, reason: idIssue };
  for (const k of ["cols", "rows"] as const)
    if (typeof l[k] !== "number" || !Number.isInteger(l[k]) || (l[k] as number) < 1) return { ok: false, reason: `the level's ${k} must be a positive whole number` };
  for (const k of ["blocked", "playerSpawns", "enemies"] as const)
    if (!Array.isArray(l[k])) return { ok: false, reason: `the level has no ${k} list` };
  return { ok: true, file: levelFileName(l.id as string), text: formatLevelJson(level), overwrite: overwrite === true };
}
