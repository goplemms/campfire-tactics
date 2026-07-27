import { describe, it, expect } from "vitest";
import {
  blankDraft, draftToEncounter, encounterToDraft, newCaptiveSpec,
  enemyBaseStat, effectiveEnemyStat, setEnemyStat, setSpecStat,
  type EditorDraft, type DraftEnemy,
} from "./editor-draft";
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

  it("authored objectives (M-C) win over the derive: tuned label + optional required + rebound extraction span", () => {
    const draft: EditorDraft = {
      ...playableDraft(),
      captives: [{ pos: { col: 7, row: 0 }, release: "lockpick" }],
      exit: [{ col: 0, row: 0 }, { col: 0, row: 1 }, { col: 0, row: 2 }],
      objectives: [
        { id: "storm", kind: "eliminate-all", required: false, label: "Storm the Iron Gaol" },
        // A stale span here must be overwritten by the painted exit tiles (the exit brush is the source).
        { id: "extract", kind: "extraction", required: true, label: "Get them over the wall", span: [{ col: 9, row: 9 }], escort: { role: "prisoner" } },
      ],
      reward: { gold: 300, materials: [], xp: 150 },
    };
    const enc = draftToEncounter(draft);
    expect(validateLevel(enc)).toEqual([]);
    const storm = enc.objectives!.find((o) => o.id === "storm")!;
    expect(storm.label).toBe("Storm the Iron Gaol"); // label tuned
    expect(storm.required).toBe(false); // required toggled → optional/bonus
    const extract = enc.objectives!.find((o) => o.id === "extract")!;
    expect(extract.span).toEqual(draft.exit); // rebound to the painted exit, NOT the stale (9,9)
    expect(enc.reward).toEqual({ gold: 300, materials: [], xp: 150 }); // authored reward
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
    expect(back.captives?.map((c) => c.spec.id)).toEqual(["wren", "cass", "bram"]);
    expect(back.captives?.map((c) => c.spec.name)).toEqual(["Wren", "Cass", "Bram"]);
    expect(back.objectives?.find((o) => o.kind === "extraction")?.label).toBe("Free Wren, Cass and Bram and escort them to an exit");
    expect(back.enemies.find((e) => e.id === "the-warden")?.role).toBe("captain");
    expect(back.reward).toEqual({ gold: 260, materials: [], xp: 120 });
    // The v4 finale's doctrine wiring (issue #204 B) — none of it painted by the editor yet, so each
    // is a live losslessness case: the `garrison` tags ride `overrides`, `controlRoom` rides the
    // passthrough bag, and the Warden's `dropOnDeath` opt-in rides inside its keyholder lock.
    expect(back.enemies.every((e) => e.overrides?.tags?.includes("garrison"))).toBe(true);
    expect(back.controlRoom).toEqual({ cols: [10, 13], rows: [3, 7] });
    expect(back.gates?.find((g) => g.id === "seal-outer")?.openBy).toContainEqual({
      kind: "keyholder",
      tag: { id: "the-warden" },
      dropOnDeath: true,
    });
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

  it("graduates objectives + reward to first-class draft fields (M-C), not the passthrough bag", () => {
    const draft = encounterToDraft(getLevel("sample-skirmish")!);
    // objectives + reward are first-class now (the DraftPassthrough type no longer even has them —
    // the bag holds only rumors/intelDepth/grants).
    expect(draft.reward).toEqual({ gold: 50, materials: [], xp: 40 });
    expect(draft.objectives).toBeUndefined(); // sample-skirmish has no captives/objectives
  });
});

describe("editor inspector edits (D98 editor M-B — identity + stats)", () => {
  const enemy = (): DraftEnemy => ({ templateId: "bandit-captain", pos: { col: 5, row: 2 } });

  it("setEnemyStat diff-on-edit: a base-equal value stores no override; a differing value does", () => {
    const e = enemy();
    const base = enemyBaseStat("bandit-captain", "maxHp");
    setEnemyStat(e, "maxHp", base); // equal to template base → no override
    expect(e.overrides).toBeUndefined();
    setEnemyStat(e, "maxHp", base + 10); // differs → stored
    expect(e.overrides).toEqual({ maxHp: base + 10 });
    expect(effectiveEnemyStat(e, "maxHp")).toBe(base + 10);
    setEnemyStat(e, "maxHp", base); // back to base → override pruned away (stays tidy)
    expect(e.overrides).toBeUndefined();
  });

  it("effectiveEnemyStat falls back to the template base when unset", () => {
    const e = enemy();
    expect(effectiveEnemyStat(e, "attack")).toBe(enemyBaseStat("bandit-captain", "attack"));
    expect(effectiveEnemyStat(e, "attackRange")).toBe(enemyBaseStat("bandit-captain", "attackRange")); // 1 default
  });

  it("newCaptiveSpec is a role-prisoner unit with a positional (collision-resistant) id", () => {
    const spec = newCaptiveSpec({ col: 3, row: 4 });
    expect(spec.role).toBe("prisoner");
    expect(spec.side).toBe("player");
    expect(spec.id).toBe("prisoner-3-4");
  });

  it("editing an enemy override still round-trips (structural) and validates", () => {
    const draft = encounterToDraft(getLevel("the-rescue")!);
    const warden = draft.enemies.find((e) => e.id === "the-warden")!;
    setEnemyStat(warden, "maxHp", enemyBaseStat("bandit-captain", "maxHp") + 20);
    const enc = draftToEncounter(draft);
    expect(validateLevel(enc)).toEqual([]);
    // The edit is present, and re-importing it is idempotent (edit is now part of the level).
    expect(enc.enemies.find((e) => e.id === "the-warden")?.overrides?.maxHp).toBe(enemyBaseStat("bandit-captain", "maxHp") + 20);
    expect(draftToEncounter(encounterToDraft(enc))).toEqual(enc);
  });

  it("editing a captive's stats is a direct spec write that round-trips", () => {
    const draft = encounterToDraft(getLevel("the-rescue")!);
    const cap = draft.captives[0];
    setSpecStat(cap.spec!, "maxHp", 40);
    cap.spec!.name = "Mira the Smith";
    const enc = draftToEncounter(draft);
    expect(validateLevel(enc)).toEqual([]);
    expect(enc.captives?.[0].spec.maxHp).toBe(40);
    expect(enc.captives?.[0].spec.name).toBe("Mira the Smith");
    expect(draftToEncounter(encounterToDraft(enc))).toEqual(enc);
    // The import must NOT alias the source — editing the draft left the registry level untouched.
    expect(getLevel("the-rescue")!.captives![0].spec.name).toBe("Wren");
    expect(getLevel("the-rescue")!.captives![0].spec.maxHp).toBe(20);
  });
});
