import { describe, it, expect } from "vitest";
import { LEVELS, getLevel, listLevels, validateLevel, levelToScenario } from "./levels";
import { buildScenarioRun, encounterOutcome, OBJECTIVE_KINDS } from "../core";

/**
 * The JSON level content pipeline (D98) — proves a `.json` in `content/levels/` is
 * glob-loaded, validated, and actually playable through the scenario machinery. This is
 * the round-trip the visual editor's export feeds into.
 */
describe("the JSON level content pipeline (D98)", () => {
  it("glob-loads every level file, keyed by id, and all are valid", () => {
    expect(listLevels().length).toBeGreaterThan(0);
    for (const [id, lvl] of Object.entries(LEVELS)) {
      expect(lvl.id).toBe(id); // registered under its own id
      expect(validateLevel(lvl)).toEqual([]);
    }
    expect(getLevel("sample-skirmish")).toBeDefined();
  });

  it("a loaded level stages + plays to a win through the one-node-run boot", () => {
    const { loop } = buildScenarioRun(levelToScenario(getLevel("sample-skirmish")!));
    loop.startEncounter();
    loop.beginBattle();
    expect(loop.staged!.battle.units.some((u) => u.side === "enemy")).toBe(true);
    for (const u of loop.staged!.battle.units) if (u.side === "enemy") u.alive = false;
    expect(encounterOutcome(loop.staged!)).toBe("win");
  });

  it("the prison-break finale variant is dual-OR: wins by storming OR by extraction (D97/D98)", () => {
    const level = getLevel("prison-break")!;
    expect(validateLevel(level)).toEqual([]);
    expect(level.objectives?.map((o) => o.kind).sort()).toEqual(["eliminate-all", "extraction"]);

    // Frontal path: clear the garrison (prisoners left cuffed) → win.
    {
      const { loop } = buildScenarioRun(levelToScenario(level));
      loop.startEncounter();
      loop.beginBattle();
      for (const u of loop.staged!.battle.units) if (u.side === "enemy") u.alive = false;
      expect(encounterOutcome(loop.staged!)).toBe("win");
    }
    // Extraction path: free both prisoners + escort to the exit, garrison left standing → win.
    {
      const { loop } = buildScenarioRun(levelToScenario(level));
      loop.startEncounter();
      loop.beginBattle();
      const prisoners = loop.staged!.battle.units.filter((u) => u.role === "prisoner");
      const exit = loop.staged!.objectives.find((o) => o.spec.kind === "extraction")!.spec.span!;
      expect(prisoners).toHaveLength(2);
      prisoners.forEach((p, i) => { p.captured = false; p.pos = { ...exit[i] }; });
      expect(loop.staged!.battle.units.some((u) => u.side === "enemy" && u.alive)).toBe(true);
      expect(encounterOutcome(loop.staged!)).toBe("win");
    }
  });

  it("the-rescue is a group dual-OR rescue: wins by clearing the garrison OR by extracting ALL THREE captives (D97/D98)", () => {
    const level = getLevel("the-rescue")!;
    expect(validateLevel(level)).toEqual([]);
    expect(level.objectives?.map((o) => o.kind).sort()).toEqual(["eliminate-all", "extraction"]);
    // The three placeholder captives are a role-"prisoner" group, cuffed, held far from the exit.
    expect(level.captives?.map((c) => c.spec.id).sort()).toEqual(["captive-1", "captive-2", "captive-3"]);
    for (const c of level.captives ?? []) {
      expect(c.spec.role).toBe("prisoner");
      expect(c.release).toEqual({ kind: "lockpick" });
      expect(c.pos.col).toBeGreaterThanOrEqual(9); // deep in the prison, far from the col-0 exit (challenge-F geometry)
    }

    // (a) Frontal path: clear the garrison, captives left cuffed → win.
    {
      const { loop } = buildScenarioRun(levelToScenario(level));
      loop.startEncounter();
      loop.beginBattle();
      for (const u of loop.staged!.battle.units) if (u.side === "enemy") u.alive = false;
      expect(loop.staged!.battle.units.filter((u) => u.role === "prisoner").every((p) => p.captured)).toBe(true);
      expect(encounterOutcome(loop.staged!)).toBe("win");
    }
    // (b) Extraction path: free ALL THREE + escort each to the exit, garrison left standing → win.
    //     And with only TWO extracted it is NOT yet a win — the whole group must be out.
    {
      const { loop } = buildScenarioRun(levelToScenario(level));
      loop.startEncounter();
      loop.beginBattle();
      const prisoners = loop.staged!.battle.units.filter((u) => u.role === "prisoner");
      const exit = loop.staged!.objectives.find((o) => o.spec.kind === "extraction")!.spec.span!;
      expect(prisoners).toHaveLength(3);
      // Free + move only the first two onto the exit — the group is not fully out yet.
      prisoners.slice(0, 2).forEach((p, i) => { p.captured = false; p.pos = { ...exit[i] }; });
      expect(loop.staged!.battle.units.some((u) => u.side === "enemy" && u.alive)).toBe(true);
      expect(encounterOutcome(loop.staged!)).not.toBe("win");
      // Now free + extract the third — the whole group is out → win (garrison still standing).
      const third = prisoners[2];
      third.captured = false;
      third.pos = { ...exit[2] };
      expect(loop.staged!.battle.units.some((u) => u.side === "enemy" && u.alive)).toBe(true);
      expect(encounterOutcome(loop.staged!)).toBe("win");
    }
  });

  it("validateLevel accepts EVERY core objective kind (no drift from the model, D98)", () => {
    // The pipeline derives its kind list from core's OBJECTIVE_KINDS, so a kind added to the
    // game is authorable immediately — none of these is rejected as "unknown objective kind".
    for (const kind of OBJECTIVE_KINDS) {
      const issues = validateLevel({ ...getLevel("sample-skirmish")!, objectives: [{ id: "o", kind, required: true, label: "o" }] });
      expect(issues.filter((i) => /unknown objective kind/.test(i))).toEqual([]);
    }
  });

  it("validateLevel rejects malformed files fail-loud (bad shape + unknown template)", () => {
    expect(validateLevel(null)).toEqual(["not an object"]);
    const bad = validateLevel({ id: "", name: "", cols: 0, rows: 6, playerSpawns: [], enemies: "no", reward: undefined });
    expect(bad).toContain("missing id");
    expect(bad).toContain("cols must be a positive integer");
    expect(bad).toContain("needs at least one playerSpawn");
    expect(bad).toContain("missing reward");
    expect(
      validateLevel({ ...getLevel("sample-skirmish")!, enemies: [{ templateId: "nope", pos: { col: 0, row: 0 } }] }),
    ).toContain('unknown enemy template "nope"');
  });
});
