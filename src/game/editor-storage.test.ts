import { describe, it, expect } from "vitest";
import { sanitizeDraft, sanitizeLaunchConfig } from "./editor-storage";
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

  it("drops malformed objectives that would crash the panel build (the challenge freeze)", () => {
    // A tampered store: null / a number / a kind-less object among the objectives. The editor
    // dereferences o.kind/o.label unguarded, so these must be dropped, not passed through.
    const out = sanitizeDraft({
      cols: 6, rows: 6,
      objectives: [42, null, { label: "no kind" }, { kind: "eliminate-all", label: "ok", required: true }],
    })!;
    expect(out.objectives).toHaveLength(1);
    expect(out.objectives![0].kind).toBe("eliminate-all");
    expect(out.objectives![0].label).toBe("ok");
  });

  it("coerces objective fields + a bad span to safe types", () => {
    const out = sanitizeDraft({ cols: 6, rows: 6, objectives: [{ kind: "extraction", span: "not-an-array" }] })!;
    expect(out.objectives![0].span).toBeUndefined(); // bad span dropped, not left as a string
    expect(typeof out.objectives![0].label).toBe("string"); // missing label → ""
    expect(out.objectives![0].required).toBe(true); // missing → default required
    // a non-array objectives value is dropped entirely
    expect(sanitizeDraft({ cols: 6, rows: 6, objectives: "garbage" })!.objectives).toBeUndefined();
  });

  it("coerces a garbage reward to finite gold/xp + a materials array", () => {
    const out = sanitizeDraft({ cols: 6, rows: 6, reward: { gold: "lots", xp: {} } })!;
    expect(out.reward).toEqual({ gold: 50, xp: 40, materials: [] });
  });
});

/**
 * `sanitizeLaunchConfig` is the same fail-safe for the Launch tab's stored levers: a tampered or
 * version-drifted blob must never wedge the tab. These pin the pure logic — `test:e2e:launcher`
 * covers the localStorage round-trip, a corrupt-store boot, and the stale-flag report.
 */
describe("sanitizeLaunchConfig", () => {
  it("returns null for non-object input", () => {
    expect(sanitizeLaunchConfig(null)).toBeNull();
    expect(sanitizeLaunchConfig("nope")).toBeNull();
    expect(sanitizeLaunchConfig(42)).toBeNull();
    expect(sanitizeLaunchConfig([])).toBeNull(); // an array is not a config
  });

  it("round-trips a well-formed config", () => {
    const cfg = { targetKey: "level:the-rescue", kit: "Vanguard (5)", flags: ["side-door-intel"], seed: "s1" };
    expect(sanitizeLaunchConfig(JSON.parse(JSON.stringify(cfg)))).toEqual(cfg);
  });

  it("defaults each field independently rather than discarding the whole blob", () => {
    // A partial/drifted store should still restore what it legitimately carries.
    expect(sanitizeLaunchConfig({ kit: "Solo (1)" })).toEqual({
      targetKey: "draft", kit: "Solo (1)", flags: [], seed: "",
    });
    expect(sanitizeLaunchConfig({})).toEqual({ targetKey: "draft", kit: "", flags: [], seed: "" });
  });

  it("coerces a hostile flags value to a clean string list", () => {
    expect(sanitizeLaunchConfig({ flags: "side-door-intel" })!.flags).toEqual([]); // not an array
    expect(sanitizeLaunchConfig({ flags: [1, null, "a", { b: 2 }, "a"] })!.flags).toEqual(["a"]); // filtered + de-duped
  });

  it("keeps an UNKNOWN flag id — validating it is the tab's job, not this layer's", () => {
    // This layer cannot fail loud: a stale id must not stop the editor booting. The Launch tab
    // drops it on load and names it on the status line, where a human can act on it.
    expect(sanitizeLaunchConfig({ flags: ["ghost-flag"] })!.flags).toEqual(["ghost-flag"]);
  });

  it("coerces non-string scalars to their defaults", () => {
    const out = sanitizeLaunchConfig({ targetKey: 7, kit: {}, seed: false })!;
    expect(out).toEqual({ targetKey: "draft", kit: "", flags: [], seed: "" });
  });
});
