import { describe, it, expect } from "vitest";
import { blankDraft, draftToEncounter, type EditorDraft } from "./editor-draft";
import { validateLevel, levelToScenario } from "../content/levels";
import { buildScenarioRun, encounterOutcome } from "../core";

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
