import { describe, it, expect } from "vitest";
import { blankDraft, draftToEncounter, encounterToDraft, type EditorDraft } from "./editor-draft";
import { validateLevel, levelToScenario, listLevels, getLevel } from "../content/levels";
import { buildScenarioRun, encounterOutcome, type AuthoredEncounter } from "../core";

/**
 * The editor's draft → AuthoredEncounter serialization (D98 M2) — proves the editor emits
 * levels the content pipeline accepts and can play. Pure (no Phaser), so it runs headless.
 */
function playableDraft(): EditorDraft {
  return {
    ...blankDraft(8, 6),
    id: "editor-test",
    name: "Editor Test",
    playerSpawns: [{ col: 0, row: 1 }, { col: 0, row: 2 }],
    enemies: [
      { templateId: "bandit-thug", pos: { col: 6, row: 2 } },
      { templateId: "bandit-bowman", pos: { col: 7, row: 4 } },
    ],
  };
}

describe("editor draft → encounter (D98 M2)", () => {
  it("a painted draft serializes to a pipeline-VALID level that stages + plays", () => {
    const enc = draftToEncounter(playableDraft());
    expect(validateLevel(enc)).toEqual([]);
    const { loop } = buildScenarioRun(levelToScenario(enc));
    loop.startEncounter();
    loop.beginBattle();
    expect(loop.staged!.battle.units.filter((u) => u.side === "enemy").length).toBe(2);
    for (const u of loop.staged!.battle.units) if (u.side === "enemy") u.alive = false;
    expect(encounterOutcome(loop.staged!)).toBe("win");
  });

  it("exit tiles + prisoners derive the OR'd extraction finale (D97 shape)", () => {
    const draft: EditorDraft = {
      ...playableDraft(),
      captives: [{ pos: { col: 7, row: 0 }, release: "lockpick" }],
      exit: [{ col: 0, row: 0 }, { col: 0, row: 1 }],
    };
    const enc = draftToEncounter(draft);
    expect(validateLevel(enc)).toEqual([]);
    expect(enc.objectives?.map((o) => o.kind).sort()).toEqual(["eliminate-all", "extraction"]);
    const extract = enc.objectives!.find((o) => o.kind === "extraction")!;
    expect(extract.escort).toEqual({ role: "prisoner" });
    expect(extract.span).toHaveLength(2);
    // The captive is a lockpick prisoner tagged for extraction.
    expect(enc.captives![0].release).toEqual({ kind: "lockpick" });
    expect(enc.captives![0].spec.role).toBe("prisoner");
  });

  it("omits empty collections but always carries a reward (tidy JSON)", () => {
    const enc = draftToEncounter(playableDraft());
    expect(enc.captives).toBeUndefined();
    expect(enc.traps).toBeUndefined();
    expect(enc.objectives).toBeUndefined(); // default elimination goal injected at stage
    expect(enc.reward).toBeDefined();
  });
});

describe("editor import round-trip (D98 editor M-A — lossless import)", () => {
  it("every content level round-trips structurally: draftToEncounter(encounterToDraft(L)) deep-equals L", () => {
    const levels = listLevels();
    expect(levels.length).toBeGreaterThan(0);
    for (const level of levels) {
      // Structural (deep) equality — NOT byte-identical: the editor's JSON formatter differs from a
      // hand-formatted file, but no data may change. This is the M-A safety property.
      expect(draftToEncounter(encounterToDraft(level))).toEqual(level);
    }
  });

  it("the-rescue survives import losslessly — named captives, custom labels, reward all preserved", () => {
    const level = getLevel("the-rescue")!;
    const back = draftToEncounter(encounterToDraft(level));
    // The exact things a naive inverse would silently clobber (the data-loss footgun):
    expect(back.captives?.map((c) => c.spec.id)).toEqual(["captive-1", "captive-2", "captive-3"]);
    expect(back.captives?.map((c) => c.spec.name)).toEqual(["Bound Captive I", "Bound Captive II", "Bound Captive III"]);
    expect(back.objectives?.find((o) => o.kind === "extraction")?.label).toBe("Free the captives and escort them to the exit");
    expect(back.enemies.find((e) => e.id === "the-warden")?.role).toBe("captain");
    expect(back.reward).toEqual({ gold: 260, materials: [], xp: 120 });
    expect(back).toEqual(level);
  });

  it("import carries enemy id/role/overrides/hidden onto the draft entity (round-trips), not a side-bag", () => {
    const draft = encounterToDraft(getLevel("prison-break")!);
    const warden = draft.enemies.find((e) => e.id === "prison-warden");
    expect(warden?.role).toBe("captain");
  });

  it("import is FAIL-LOUD on shapes M-A can't carry (trap params) — refuses rather than dropping", () => {
    const withTrapParams: AuthoredEncounter = {
      ...getLevel("sample-skirmish")!,
      traps: [{ pos: { col: 3, row: 3 }, damage: 20, concealment: 6 }],
    };
    expect(() => encounterToDraft(withTrapParams)).toThrow(/trap params aren't editable yet/);
  });

  it("import preserves the passthrough bag only for fields present (tidy)", () => {
    const draft = encounterToDraft(getLevel("sample-skirmish")!);
    // sample-skirmish has no objectives/captives — only reward rides the bag.
    expect(draft._passthrough?.objectives).toBeUndefined();
    expect(draft._passthrough?.reward).toEqual({ gold: 50, materials: [], xp: 40 });
  });
});
