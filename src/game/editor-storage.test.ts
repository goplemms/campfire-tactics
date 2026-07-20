import { describe, it, expect } from "vitest";
import { sanitizeDraft } from "./editor-storage";
import { blankDraft } from "./editor-draft";

/**
 * `sanitizeDraft` is the fail-safe that keeps a tampered / truncated / version-drifted
 * `localStorage` blob from wedging the editor (D-editor persistence). These pin its guarantees
 * on the pure logic — the e2e covers the localStorage round-trip + a corrupt-store boot.
 */
describe("sanitizeDraft", () => {
  it("returns null for non-object input", () => {
    expect(sanitizeDraft(null)).toBeNull();
    expect(sanitizeDraft("nope")).toBeNull();
    expect(sanitizeDraft(42)).toBeNull();
  });

  it("round-trips a well-formed draft", () => {
    const d = blankDraft(8, 5);
    d.id = "lvl";
    d.name = "Level";
    d.blocked = [{ col: 1, row: 1 }, { col: 2, row: 2 }];
    d.playerSpawns = [{ col: 0, row: 0 }];
    d.enemies = [{ templateId: "bandit-thug", pos: { col: 4, row: 3 } }];
    const out = sanitizeDraft(JSON.parse(JSON.stringify(d)))!;
    expect(out.id).toBe("lvl");
    expect(out.cols).toBe(8);
    expect(out.blocked).toHaveLength(2);
    expect(out.enemies).toHaveLength(1);
  });

  it("clamps grid dimensions into the editor's 1..20 and defaults bad values", () => {
    expect(sanitizeDraft({ cols: 999, rows: 5 })!.cols).toBe(20); // over-max → clamped down
    expect(sanitizeDraft({ cols: 8, rows: 0 })!.rows).toBe(1); // valid int below min → clamped up
    expect(sanitizeDraft({ cols: -3, rows: 12 })!.cols).toBe(1); // negative int → clamped to min
    expect(sanitizeDraft({ cols: 1.5, rows: 12 })!.cols).toBe(9); // non-integer → blankDraft default
    expect(sanitizeDraft({})!.cols).toBe(9); // missing → blankDraft default
  });

  it("bounds-filters coords against the (clamped) board", () => {
    const out = sanitizeDraft({ cols: 3, rows: 3, blocked: [{ col: 1, row: 1 }, { col: 9, row: 9 }, { col: -1, row: 0 }] })!;
    expect(out.blocked).toEqual([{ col: 1, row: 1 }]); // the two out-of-bounds coords dropped
  });

  it("drops entities missing the minimum a render needs, keeps valid ones", () => {
    const out = sanitizeDraft({
      cols: 6, rows: 6,
      enemies: [
        { templateId: "bandit-thug", pos: { col: 1, row: 1 } }, // ok
        { pos: { col: 2, row: 2 } }, // no templateId → dropped
        { templateId: "x", pos: { col: 99, row: 0 } }, // out of bounds → dropped
      ],
      gates: [
        { id: "g1", pos: { col: 3, row: 3 }, openBy: [{ kind: "lockpick" }] }, // ok
        { id: "g2", pos: { col: 3, row: 4 } }, // no openBy array → dropped
      ],
      levers: [{ id: "l1", pos: { col: 0, row: 0 }, targets: ["g1"] }],
    })!;
    expect(out.enemies).toHaveLength(1);
    expect(out.gates).toHaveLength(1);
    expect(out.levers).toHaveLength(1);
  });

  it("coerces non-array collections to empty (never throws)", () => {
    const out = sanitizeDraft({ cols: 5, rows: 5, blocked: "corrupt", enemies: 7, captives: null })!;
    expect(out.blocked).toEqual([]);
    expect(out.enemies).toEqual([]);
    expect(out.captives).toEqual([]);
  });
});
