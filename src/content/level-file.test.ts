import { describe, it, expect } from "vitest";
import cuffedCellText from "./levels/cuffed-cell.json?raw";
import { LEVELS } from "./levels";
import { checkSaveRequest, formatLevelJson, levelFileName, levelIdIssue, orderKeysLike } from "./level-file";
import { draftToEncounter, encounterToDraft } from "../game/editor-draft";

const minimal = { id: "my-level", name: "Mine", cols: 4, rows: 3, blocked: [], playerSpawns: [], enemies: [], reward: { gold: 0 } };

describe("level ids are safe file names", () => {
  it("accepts every shipped level's id", () => {
    for (const id of Object.keys(LEVELS)) expect(levelIdIssue(id), id).toBeUndefined();
  });
  it.each(["", "../escape", "a/b", "Caps", "two  spaces", "trailing-", "-leading", "dou--ble", "x".repeat(65), "dot.json"])("refuses %j", (id) => {
    expect(levelIdIssue(id)).toBeDefined();
    expect(() => levelFileName(id)).toThrow();
  });
  it("names the file after the id", () => expect(levelFileName("the-rescue")).toBe("the-rescue.json"));
});

describe("checkSaveRequest — the dev server's whole decision", () => {
  it("accepts a level and returns the file and its text", () => {
    const r = checkSaveRequest({ level: minimal });
    expect(r).toEqual({ ok: true, file: "my-level.json", text: formatLevelJson(minimal), overwrite: false });
  });
  it("overwrite only when the request says exactly true", () => {
    expect(checkSaveRequest({ level: minimal, overwrite: true })).toMatchObject({ ok: true, overwrite: true });
    expect(checkSaveRequest({ level: minimal, overwrite: "yes" })).toMatchObject({ ok: true, overwrite: false });
  });
  it.each([
    [null, "no body"],
    [{}, "no level"],
    [{ level: [] }, "no level"],
    [{ level: { ...minimal, id: "../../etc/passwd" } }, "file name"],
    [{ level: { ...minimal, cols: 0 } }, "cols"],
    [{ level: { ...minimal, rows: 2.5 } }, "rows"],
    [{ level: { ...minimal, enemies: undefined } }, "enemies"],
  ])("refuses %j", (body, why) => {
    const r = checkSaveRequest(body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(why);
  });
});

describe("the file text", () => {
  it("matches the shape of the shipped files the editor wrote (two-space JSON + newline)", () => {
    expect(formatLevelJson(JSON.parse(cuffedCellText))).toBe(cuffedCellText);
  });
  it("orderKeysLike keeps the model's order and appends new keys", () => {
    expect(Object.keys(orderKeysLike({ b: 1, a: 2, c: 3 }, { a: 0, b: 0 }))).toEqual(["a", "b", "c"]);
    expect(orderKeysLike({ b: 1 }, undefined)).toEqual({ b: 1 });
  });
  // Open level → Save to game on an untouched level must not rewrite the file. Every shipped level the
  // editor can open round-trips to the same JSON, key order included. (Four hand-formatted files
  // are reflowed to two-space JSON the first time they are saved; the content is unchanged.)
  it("an opened-and-saved shipped level writes back the same file (bar the editor's explicit defaults)", () => {
    const opened: string[] = [];
    for (const [id, enc] of Object.entries(LEVELS)) {
      let draft;
      try { draft = encounterToDraft(enc); } catch { continue; } // trap-tuned levels can't be opened yet; the editor says so
      opened.push(id);
      const saved = orderKeysLike(draftToEncounter(draft), enc);
      // Text, not deep-equal: key order is part of what makes the diff clean.
      expect(formatLevelJson(saved), id).toBe(formatLevelJson(normalizeDefaults(enc)));
    }
    expect(opened.length).toBeGreaterThanOrEqual(8);
  });
});

/** The one known default the editor writes out explicitly: a captive's release defaults to `reach`. */
function normalizeDefaults(enc: object): unknown {
  const e = JSON.parse(JSON.stringify(enc)) as { captives?: { release?: unknown }[] };
  for (const c of e.captives ?? []) c.release ??= { kind: "reach" };
  return e;
}
