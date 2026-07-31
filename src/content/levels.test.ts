import { describe, it, expect } from "vitest";
import { LEVELS, getLevel, listLevels, validateLevel, levelToScenario } from "./levels";
import {
  buildScenarioRun,
  encounterOutcome,
  OBJECTIVE_KINDS,
  TileGrid,
  findPath,
  buildAuthoredEnemies,
  buildAuthoredGates,
  applyGatesToGrid,
  keyholderOf,
  isBreakable,
  hasTag,
  GARRISON,
  NON_COMBATANT,
  inRegion,
  planEnemyTurn,
  standingOrderIds,
  type Gate,
  type GridCoord,
  type AuthoredEncounter,
  type ReleaseRequirement,
} from "../core";
import * as HOLLOW_MILL_BODIES from "../core/hollow-mill";
import { THE_HOLLOW_MILL } from "../core/hollow-mill";
import { SCENARIOS } from "../core/scenarios";

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
    // The three named captives are a role-"prisoner" group (distinct classes), cuffed, held far from the exit.
    expect(level.captives?.map((c) => c.spec.id).sort()).toEqual(["bram", "cass", "wren"]);
    expect(level.captives?.map((c) => c.spec.jobId).sort()).toEqual(["heavy-knight", "hunter", "medic"]);
    const span = level.objectives!.find((o) => o.kind === "extraction")!.span!;
    for (const c of level.captives ?? []) {
      expect(c.spec.role).toBe("prisoner");
      expect(c.release).toEqual({ kind: "lockpick" });
      // Held deep in the v4 cellblock (top-left, rows 1-2) — far from EVERY mouth, not just one
      // edge: the D97 challenge-F walkover geometry, now that all mouths are exfil sites (D118 G5).
      const nearestMouth = Math.min(...span.map((t) => Math.abs(t.col - c.pos.col) + Math.abs(t.row - c.pos.row)));
      expect(nearestMouth, `captive "${c.spec.id}" is not deep enough`).toBeGreaterThan(12);
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
    // (b) Extraction path: free ALL THREE + escort each to a mouth, garrison left standing → win.
    //     With only TWO extracted it is NOT yet a win — the whole group must be out. And since
    //     D120 the *party* must be out with them: the mission no longer resolves out from under
    //     a rearguard still crossing the corridor.
    {
      const { loop } = buildScenarioRun(levelToScenario(level));
      loop.startEncounter();
      loop.beginBattle();
      const prisoners = loop.staged!.battle.units.filter((u) => u.role === "prisoner");
      const exit = loop.staged!.objectives.find((o) => o.spec.kind === "extraction")!.spec.span!;
      const party = loop.staged!.battle.units.filter((u) => u.side === "player" && u.role !== "prisoner");
      expect(prisoners).toHaveLength(3);
      // Free + move only the first two onto a mouth — the group is not fully out yet.
      prisoners.slice(0, 2).forEach((p, i) => { p.captured = false; p.pos = { ...exit[i] }; });
      expect(loop.staged!.battle.units.some((u) => u.side === "enemy" && u.alive)).toBe(true);
      expect(encounterOutcome(loop.staged!)).not.toBe("win");
      // Free + extract the third: the whole group is out, but the party still isn't (D120).
      const third = prisoners[2];
      third.captured = false;
      third.pos = { ...exit[2] };
      expect(encounterOutcome(loop.staged!)).not.toBe("win");
      // The party falls back out through the mouths too → win, garrison still standing.
      for (const u of party) u.pos = { ...exit[0] };
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

/**
 * **The typo surface** (validator M1–M4, D122).
 *
 * Moving an encounter from TS to JSON trades a compiler for this function. Before these checks it
 * caught **2 of 13** single-field typo classes — a downgrade, not a migration. Each case below
 * corrupts exactly one field of an otherwise-valid level and asserts a *specific* message, which is
 * what separates a real check from a message nobody triggers.
 *
 * Every field here is one `tsc` guards while the body is TypeScript and stops guarding the moment
 * it becomes data. That is the whole reason D122 makes this a gate.
 */
describe("the typo surface — every field that loses tsc when it becomes JSON", () => {
  const base = (): Record<string, unknown> => ({
    id: "typo-probe",
    name: "Typo Probe",
    cols: 9,
    rows: 6,
    blocked: [],
    playerSpawns: [{ col: 0, row: 2 }],
    enemies: [{ templateId: "bandit-thug", pos: { col: 8, row: 2 } }],
    captives: [
      {
        spec: {
          id: "probe-prisoner", name: "Prisoner", side: "player", pos: { col: 4, row: 1 },
          jobId: "soldier", primaryJob: "soldier", role: "prisoner",
          speed: 10, maxHp: 22, attack: 6, defense: 2, moveRange: 4, sightRadius: 5, attackRange: 1,
        },
        pos: { col: 4, row: 1 },
        release: { kind: "reach" },
      },
    ],
    reward: { gold: 50, materials: [], xp: 40 },
  });

  /** Corrupt one field, return the issues. `path` is applied with a tiny setter for readability. */
  const probe = (mutate: (e: Record<string, never>) => void): string[] => {
    const e = base();
    mutate(e as unknown as Record<string, never>);
    return validateLevel(e);
  };
  const at = (e: Record<string, never>): Record<string, unknown> => e as unknown as Record<string, unknown>;
  const captiveSpec = (e: Record<string, never>): Record<string, unknown> =>
    (at(e).captives as Array<{ spec: Record<string, unknown> }>)[0].spec;

  it("the baseline probe is clean (so every failure below is the mutation, not the fixture)", () => {
    expect(validateLevel(base())).toEqual([]);
  });

  // --- M1: unit identity -----------------------------------------------------------------
  it("catches a typo'd captive jobId (the silently-worthless unit)", () => {
    expect(probe((e) => { captiveSpec(e).jobId = "soldeir"; }).some((i) => /unknown jobId "soldeir"/.test(i))).toBe(true);
  });

  it("catches a typo'd primaryJob and an unknown heldJob", () => {
    expect(probe((e) => { captiveSpec(e).primaryJob = "medik"; }).some((i) => /unknown primaryJob "medik"/.test(i))).toBe(true);
    expect(probe((e) => { captiveSpec(e).heldJobs = ["soldier", "hunterr"]; }).some((i) => /holds unknown job "hunterr"/.test(i))).toBe(true);
  });

  it("still accepts an ABSENT jobId (optional by design — don't turn it into a required field)", () => {
    expect(probe((e) => { delete captiveSpec(e).jobId; delete captiveSpec(e).primaryJob; })).toEqual([]);
  });

  // --- M2: the editor/loader inversion ---------------------------------------------------
  it("catches an unknown captive release kind — the editor refused this on import, the loader didn't", () => {
    expect(probe((e) => { (at(e).captives as Array<Record<string, unknown>>)[0].release = { kind: "lockpik" }; })
      .some((i) => /unknown release kind "lockpik"/.test(i))).toBe(true);
  });

  it("accepts every kind the ReleaseRequirement union models", () => {
    // A mapped type over the union: adding a member to `ReleaseRequirement` makes this a COMPILE
    // error until the new kind is handled in `levels.ts` too, so the list can't silently drift.
    const ALL: Record<ReleaseRequirement["kind"], true> = { reach: true, lockpick: true };
    for (const kind of Object.keys(ALL)) {
      expect(probe((e) => { (at(e).captives as Array<Record<string, unknown>>)[0].release = { kind }; })).toEqual([]);
    }
  });

  // --- M3: economy + grants --------------------------------------------------------------
  it("catches a typo'd reward material — grantItem would silently drop it", () => {
    expect(probe((e) => { (at(e).reward as Record<string, unknown>).materials = [{ id: "trap-kitt", count: 1 }]; })
      .some((i) => /reward material "trap-kitt" is not a known material/.test(i))).toBe(true);
  });

  it("catches a typo'd grants.item and grants.flag", () => {
    expect(probe((e) => { at(e).grants = { item: "relic-hollow-blad" }; }).some((i) => /grants.item "relic-hollow-blad"/.test(i))).toBe(true);
    expect(probe((e) => { at(e).grants = { flag: "medic-fred" }; }).some((i) => /grants.flag "medic-fred" is not a known run flag/.test(i))).toBe(true);
  });

  it("catches a typo'd job on grants.recruit (a whole UnitSpec hiding in a grant)", () => {
    expect(probe((e) => { at(e).grants = { recruit: { id: "sela", name: "Sela", side: "player", pos: { col: 0, row: 0 }, jobId: "medik", maxHp: 20, speed: 10, attack: 5, defense: 2, moveRange: 4, sightRadius: 5 } }; })
      .some((i) => /grants.recruit "sela" has unknown jobId "medik"/.test(i))).toBe(true);
  });

  it("accepts the flags shipped content actually uses", () => {
    expect(probe((e) => { at(e).grants = { flag: "medic-freed" }; })).toEqual([]);
    expect(probe((e) => { at(e).grants = { flag: "side-door-intel" }; })).toEqual([]);
  });

  // --- M4: scalars, tiles, numbers -------------------------------------------------------
  it("catches an out-of-range intelDepth", () => {
    expect(probe((e) => { at(e).intelDepth = 99; }).some((i) => /intelDepth must be an integer in 1\.\.3/.test(i))).toBe(true);
    expect(probe((e) => { at(e).intelDepth = 0; }).some((i) => /intelDepth must be an integer/.test(i))).toBe(true);
  });

  it("catches rumors deeper than the read can ever reach — but NOT fewer (one-sided, by design)", () => {
    expect(probe((e) => { at(e).intelDepth = 2; at(e).rumors = ["a", "b", "c"]; })
      .some((i) => /3 rumors but intelDepth is 2/.test(i))).toBe(true);
    // Fewer rumors than the depth is intentional — a shallow node has less hearsay to give.
    expect(probe((e) => { at(e).intelDepth = 3; at(e).rumors = ["a"]; })).toEqual([]);
    expect(probe((e) => { at(e).rumors = ["a", "b", "c"]; })).toEqual([]); // default depth = MAX_TIER
  });

  it("catches a stringly-typed trap number (concealment: \"4\")", () => {
    expect(probe((e) => { at(e).traps = [{ pos: { col: 3, row: 3 }, concealment: "4", damage: 22 }]; })
      .some((i) => /trap\[0\].concealment must be a non-negative number/.test(i))).toBe(true);
  });

  it("catches off-board tiles across every authored collection", () => {
    expect(probe((e) => { at(e).blocked = [{ col: 99, row: 0 }]; }).some((i) => /blocked\[0\] is off the board/.test(i))).toBe(true);
    expect(probe((e) => { at(e).playerSpawns = [{ col: 0, row: 99 }]; }).some((i) => /playerSpawns\[0\] is off the board/.test(i))).toBe(true);
    expect(probe((e) => { (at(e).enemies as Array<Record<string, unknown>>)[0].pos = { col: 99, row: 0 }; })
      .some((i) => /enemy\[0\] .* is off the board/.test(i))).toBe(true);
    expect(probe((e) => { at(e).traps = [{ pos: { col: 0, row: 99 } }]; }).some((i) => /trap\[0\] is off the board/.test(i))).toBe(true);
  });

  it("catches a non-numeric reward.gold", () => {
    expect(probe((e) => { (at(e).reward as Record<string, unknown>).gold = "50"; })).toContain("reward.gold must be a number");
  });

  // --- M6: the standingOrder vocabulary --------------------------------------------------
  /**
   * The class the M1–M5 audit left open. Unlike every other field here, `standingOrder` is a bare
   * `string` **even in TypeScript** — `tsc` never covered it — so the typo is silent in both
   * formats: `orderOf` misses the registry, `planEnemyTurn` sees no posture, and the unit falls
   * back to the charging default. A `hold-skittish` straggler that never bolts erases the
   * win-without-the-kill his whole encounter is built around, and nothing errors.
   */
  const enemy = (e: Record<string, never>): Record<string, unknown> => (at(e).enemies as Array<Record<string, unknown>>)[0];

  it("catches a typo'd standingOrder on an enemy override — TRAP_FIELD's field, the JSON-conversion blocker", () => {
    expect(probe((e) => { enemy(e).overrides = { standingOrder: "hold-skittsh" }; })
      .some((i) => /unknown standingOrder "hold-skittsh"/.test(i))).toBe(true);
    // Specific enough to name the offender, not just the class.
    expect(probe((e) => { enemy(e).id = "lone-straggler"; enemy(e).overrides = { standingOrder: "hold-skittsh" }; })
      .some((i) => /enemy\[0\] "lone-straggler" overrides has unknown standingOrder/.test(i))).toBe(true);
  });

  it("catches a typo'd standingOrder on an authored UnitSpec (a captive, and a grants.recruit)", () => {
    expect(probe((e) => { captiveSpec(e).standingOrder = "defned"; })
      .some((i) => /captive "probe-prisoner" has unknown standingOrder "defned"/.test(i))).toBe(true);
    expect(probe((e) => { at(e).grants = { recruit: { id: "pip", name: "Pip", side: "player", pos: { col: 0, row: 0 }, jobId: "cook", standingOrder: "defned", maxHp: 20, speed: 10, attack: 5, defense: 2, moveRange: 4, sightRadius: 5 } }; })
      .some((i) => /grants.recruit "pip" has unknown standingOrder "defned"/.test(i))).toBe(true);
  });

  it("catches the OTHER fields an enemy override can typo, too (it is a whole Partial<UnitSpec>)", () => {
    expect(probe((e) => { enemy(e).overrides = { jobId: "soldeir" }; })
      .some((i) => /overrides has unknown jobId "soldeir"/.test(i))).toBe(true);
  });

  it("accepts every order the engine actually dispatches on, plus the reserved player-side one", () => {
    // Read from core, never hand-copied — a new order joins the vocabulary without editing this
    // test, and an order DELETED from core makes the loop shrink rather than silently pass.
    expect(standingOrderIds()).toContain("hold-skittish");
    expect(standingOrderIds()).toContain("defend");
    for (const order of standingOrderIds()) {
      expect(probe((e) => { enemy(e).overrides = { standingOrder: order }; }), `enemy override "${order}"`).toEqual([]);
      expect(probe((e) => { captiveSpec(e).standingOrder = order; }), `captive "${order}"`).toEqual([]);
    }
  });

  it("still accepts an ABSENT standingOrder (the default: manual control / the charging planner)", () => {
    expect(probe((e) => { delete enemy(e).overrides; delete captiveSpec(e).standingOrder; })).toEqual([]);
  });
});

describe("the walkover guard (D97/D99 — extraction can't be trivial)", () => {
  const CAPTIVE_STATS = { jobId: "soldier", primaryJob: "soldier", role: "prisoner", speed: 10, maxHp: 22, attack: 6, defense: 2, moveRange: 4, sightRadius: 5, attackRange: 1 } as const;
  const EXIT = [{ col: 0, row: 0 }, { col: 0, row: 1 }, { col: 0, row: 2 }, { col: 0, row: 3 }, { col: 0, row: 4 }, { col: 0, row: 5 }];
  /**
   * `specCol` defaults to the placement column (the hand-written-JSON shape). Pass it explicitly to
   * model a **`member()`-built spec**, whose `pos` is a `{ col: 0, row: 0 }` placeholder the staging
   * seam ignores — the divergence that hid a real bug in this guard.
   */
  function rescueLevel(captiveCol: number, escortTag: { role?: string; id?: string } = { role: "prisoner" }, specCol = captiveCol): unknown {
    const pos = { col: captiveCol, row: 2 };
    const specPos = { col: specCol, row: 2 };
    return {
      id: "walkover-probe", name: "Walkover Probe", cols: 10, rows: 6, blocked: [],
      playerSpawns: [{ col: 0, row: 1 }],
      enemies: [{ templateId: "bandit-thug", pos: { col: 5, row: 2 } }],
      captives: [{ spec: { id: "cap", name: "Cap", side: "player", pos: specPos, ...CAPTIVE_STATS }, pos, release: { kind: "lockpick" } }],
      objectives: [
        { id: "storm", kind: "eliminate-all", required: true, label: "clear" },
        { id: "extract", kind: "extraction", required: true, label: "escort", span: EXIT, escort: escortTag },
      ],
      reward: { gold: 50, materials: [], xp: 40 },
    };
  }

  it("flags a captive that starts within moveRange of the exit (the challenge-F footgun)", () => {
    // col 3, moveRange 4 → 3 tiles from the col-0 span ≤ 4 → one move onto the exit wins.
    expect(validateLevel(rescueLevel(3)).some((i) => /walkover/.test(i))).toBe(true);
  });

  it("passes a captive held far from the exit (the shipped finale geometry)", () => {
    // col 9, moveRange 4 → 9 > 4 → a real escort across the board.
    expect(validateLevel(rescueLevel(9)).some((i) => /walkover/.test(i))).toBe(false);
  });

  it("flags exactly moveRange away (≤, so a single move still reaches the span)", () => {
    expect(validateLevel(rescueLevel(4)).some((i) => /walkover/.test(i))).toBe(true);
    expect(validateLevel(rescueLevel(5)).some((i) => /walkover/.test(i))).toBe(false);
  });

  it("flags an extraction whose escort tag matches no captive — a dead win-path", () => {
    const issues = validateLevel(rescueLevel(9, { role: "medic" }));
    expect(issues.some((i) => /no captive matching its escort tag/.test(i))).toBe(true);
  });

  /**
   * A captive is staged at its **placement** tile, so a missing/off-board one is a TypeError mid-boot
   * rather than a load error. In TS `CaptivePlacement.pos` is required; as JSON it is just an absent
   * key — the D122 class of field that only `validateLevel` can guard once the body is data.
   */
  describe("captive placement (a JSON-tier hazard tsc covers today)", () => {
    const withCaptive = (mutate: (c: Record<string, unknown>) => void): unknown => {
      const level = rescueLevel(9) as { captives: Array<Record<string, unknown>> };
      mutate(level.captives[0]);
      return level;
    };

    it("flags a captive with no placement pos", () => {
      const issues = validateLevel(withCaptive((c) => delete c.pos));
      expect(issues.some((i) => /no valid placement pos/.test(i))).toBe(true);
    });

    it("flags a captive placed off the board", () => {
      const issues = validateLevel(withCaptive((c) => { c.pos = { col: 99, row: 0 }; }));
      expect(issues.some((i) => /placed off the board at \(99,0\)/.test(i))).toBe(true);
    });

    it("does NOT fire on a well-placed captive", () => {
      expect(validateLevel(rescueLevel(9)).filter((i) => /placement pos|off the board/.test(i))).toEqual([]);
    });
  });

  it("leaves the shipped finale levels clean (no false positives)", () => {
    expect(validateLevel(getLevel("the-rescue")!).filter((i) => /walkover|escort tag/.test(i))).toEqual([]);
    expect(validateLevel(getLevel("prison-break")!).filter((i) => /walkover|escort tag/.test(i))).toEqual([]);
  });

  /**
   * The guard measures from the **placement** tile, never `spec.pos` — the spec's own `pos` is a
   * placeholder that `buildAuthoredCaptives` discards. Both directions matter, and both were wrong
   * before: a placeholder ON the exit span produced a false walkover (this is exactly The Prison
   * Assault, whose `member()`-built cells default to `(0,0)` — the first tile of the finale's exit),
   * and a placeholder far from the exit *masked* a real one.
   */
  describe("measures from the placement tile, not spec.pos (the member() placeholder)", () => {
    it("does NOT flag a far-held captive whose spec.pos placeholder sits on the exit span", () => {
      // Placement col 9 (a real 9-tile escort); spec.pos col 0 = on the span. The prisoner never
      // stands on spec.pos, so this must stay clean.
      expect(validateLevel(rescueLevel(9, { role: "prisoner" }, 0)).some((i) => /walkover/.test(i))).toBe(false);
    });

    it("DOES flag a captive placed on the exit whose spec.pos placeholder is far away", () => {
      // The inverse, and the dangerous one: a genuine walkover (placement col 1 ≤ moveRange 4)
      // that a spec.pos of col 9 previously hid.
      expect(validateLevel(rescueLevel(1, { role: "prisoner" }, 9)).some((i) => /walkover/.test(i))).toBe(true);
    });

    it("reports the distance from the placement tile in the message", () => {
      const issue = validateLevel(rescueLevel(3, { role: "prisoner" }, 9)).find((i) => /walkover/.test(i));
      expect(issue).toMatch(/starts 3 tile\(s\) from the exit/);
    });
  });
});

/**
 * **The content validator's real population** (the encounters-as-JSON audit, 2026-07-30).
 *
 * `validateLevel` runs fail-loud at load — but only over `levels/*.json`, which is *four* files. The
 * ~14 TS-const bodies (the Hollow Mill arc + the `scenarios/` harness) are checked by `tsc` for shape
 * and by **nothing at all** for sense: no walkover guard, no unknown-template check, no id-uniqueness.
 *
 * That gap is what let the walkover guard read `spec.pos` for a year without anyone noticing, and it
 * is the gap a JSON migration closes. Running the validator across every authored body in the repo
 * makes the guard's population match its claim ("protects **every** level") — and, concretely, means a
 * body is proven validator-clean **before** anyone converts it, rather than discovering a false
 * failure at load time mid-migration.
 */
describe("every authored body in the repo passes the content validator", () => {
  /** Structural enumeration, so a newly-authored body joins this guard without a registry edit. */
  const bodies: Array<[string, AuthoredEncounter]> = [
    ...Object.entries(HOLLOW_MILL_BODIES)
      .filter((entry): entry is [string, AuthoredEncounter] => {
        const e = entry[1] as Partial<AuthoredEncounter>;
        return !!e && typeof e === "object" && typeof e.cols === "number" && typeof e.rows === "number" && Array.isArray(e.enemies);
      })
      .map(([k, e]) => [`hollow-mill:${k}`, e] as [string, AuthoredEncounter]),
    ...Object.values(SCENARIOS).map((s) => [`scenario:${s.id}`, s.encounter as AuthoredEncounter] as [string, AuthoredEncounter]),
    ...listLevels().map((l) => [`json:${l.id}`, l] as [string, AuthoredEncounter]),
  ];

  it("enumerates the whole population (arc + harness + JSON), not just the JSON files", () => {
    // Guards the enumeration itself: if this drops to ~4 the sweep below has gone vacuous.
    expect(bodies.length).toBeGreaterThanOrEqual(18);
    expect(bodies.filter(([k]) => k.startsWith("hollow-mill:")).length).toBeGreaterThanOrEqual(7);
  });

  it.each(bodies)("%s validates clean", (_label, enc) => {
    expect(validateLevel(enc)).toEqual([]);
  });

  /**
   * **Specificity for the `standingOrder` check** (D122). The sweep passing proves nothing about a
   * check that no shipped body exercises — the `audit:challenge` discipline applied to a content
   * gate. `TRAP_FIELD`'s lone straggler carries `overrides.standingOrder: "hold-skittish"` and is
   * one of the two bodies queued for JSON conversion, which is exactly where `tsc` stops covering
   * the field. So corrupt that field (and every other body's) on a deep copy and prove the sweep
   * would have caught it, rather than trusting the synthetic probe fixture alone.
   */
  it("would catch a typo'd standingOrder in the REAL bodies that carry one (not just the probe)", () => {
    const carries = ([, e]: [string, AuthoredEncounter]): boolean =>
      (e.enemies ?? []).some((en) => en.overrides?.standingOrder !== undefined) ||
      (e.captives ?? []).some((c) => c.spec?.standingOrder !== undefined);
    const carriers = bodies.filter(carries);
    // The straggler is the motivating case; if he stops carrying an order, this guard has gone
    // vacuous and should be re-pointed rather than deleted.
    expect(carriers.map(([k]) => k)).toContain("hollow-mill:TRAP_FIELD");

    for (const [label, enc] of carriers) {
      const corrupt = JSON.parse(JSON.stringify(enc)) as AuthoredEncounter;
      for (const en of corrupt.enemies ?? []) if (en.overrides?.standingOrder) en.overrides.standingOrder += "-typo";
      for (const c of corrupt.captives ?? []) if (c.spec?.standingOrder) c.spec.standingOrder += "-typo";
      expect(validateLevel(corrupt).some((i) => /unknown standingOrder/.test(i)), label).toBe(true);
    }
  });

  /**
   * **The migration's silent-failure mode** (challenge pass, 2026-07-30).
   *
   * `resolveAuthored` is `exp.encounters?.[id] ?? getAuthoredNode(id)` — the **inline map wins**. So
   * converting an arc body to JSON *without* also deleting it from the expedition's `encounters: {}`
   * map leaves the game **silently playing the stale TS const**: the JSON file loads, validates,
   * injects, and is then ignored. Nothing errors, every guard stays green, and an author editing the
   * new JSON sees no change in game.
   *
   * That is the natural workflow's exact failure — "add the JSON, check it works, then delete the
   * const" gives a **false green** in the middle step. `loadLevels()` only rejects duplicate ids
   * *within* `levels/*.json`; it has never compared against an inline map.
   */
  it("no expedition serves an id that is ALSO a JSON level (a stale inline const would shadow it)", () => {
    const inline = Object.keys(THE_HOLLOW_MILL.encounters ?? {});
    const shadowed = inline.filter((id) => id in LEVELS);
    expect(shadowed, `these ids resolve to the inline TS const, NOT their JSON file: ${shadowed.join(", ")}`).toEqual([]);
  });
});

describe("the-rescue is a properly-connected prison (structured layout)", () => {
  it("every captive is reachable from a player spawn — no chokepoint seals a cell", () => {
    // The win-path tests teleport prisoners to the exit, so they'd stay green even if a wall
    // edit sealed a cell. This walks the real A* grid to prove each captive can actually be
    // reached (freed) and escorted out through the chokepoints.
    const level = getLevel("the-rescue")!;
    const grid = new TileGrid(level.cols, level.rows, level.blocked);
    const spawn = level.playerSpawns[0];
    for (const c of level.captives ?? []) {
      expect(findPath(grid, spawn, c.pos), `captive "${c.spec.id}" is walled off from the party`).not.toBeNull();
    }
    // And the exit span is reachable from the deep cellblock (the escort route back exists).
    const deepest = level.captives!.reduce((a, b) => (b.pos.col > a.pos.col ? b : a));
    const exit = level.objectives!.find((o) => o.kind === "extraction")!.span![0];
    expect(findPath(grid, deepest.pos, exit), "no escort route from the cells to the exit").not.toBeNull();
  });
});

/**
 * The **v4 concentric prison** (issue #204 group B) — the finale's geometry + doctrine wiring as
 * executable invariants. These are the guards `finale-extraction-viability.md` (crux C2) names:
 * the split-force op only holds if the seal is the garrison's *only* route AND the *only* thing it
 * can open, and if every escort route runs a chokepoint. Data-only tests would stay green through a
 * wall edit that quietly voids either, so each walks the real grid / the real `ai.ts` predicates.
 */
describe("the-rescue v4 concentric prison (D117/D118, issue #204 B)", () => {
  const level = () => getLevel("the-rescue")!;
  /** The battle grid as staged: authored walls + every gate stamped at its authored lock state. */
  function stagedGrid(gates: readonly Gate[]): TileGrid {
    const lvl = level();
    const grid = new TileGrid(lvl.cols, lvl.rows, lvl.blocked);
    applyGatesToGrid(grid, gates);
    return grid;
  }
  const gateNamed = (gates: readonly Gate[], id: string): Gate => {
    const g = gates.find((x) => x.id === id);
    if (!g) throw new Error(`no gate "${id}"`);
    return g;
  };
  const SIDE_SPAWN = { col: 18, row: 5 };
  const MAIN_SPAWN = { col: 9, row: 18 };

  it("B1/B7 — the whole roster is tagged `garrison`, the captives `non-combatant`", () => {
    // The two intrinsic tags the D117 doctrine reads. An untagged garrison never drives a door;
    // an untagged captive would confer `in-combat` and self-screen (R3), voiding the pursuit model.
    const enemies = buildAuthoredEnemies(level());
    expect(enemies.length).toBeGreaterThanOrEqual(10);
    for (const u of enemies) expect(hasTag(u, GARRISON), `${u.id} is not garrison`).toBe(true);
    for (const c of level().captives ?? []) expect(c.spec.tags).toContain(NON_COMBATANT);
  });

  it("B2 — the Warden keys the OUTER seal only, and drops the key rather than popping it", () => {
    const gates = buildAuthoredGates(level());
    const outer = gateNamed(gates, "seal-outer");
    const keyLock = outer.openBy.find((c) => c.kind === "keyholder");
    expect(keyLock).toEqual({ kind: "keyholder", tag: { id: "the-warden" }, dropOnDeath: true });
    // `dropOnDeath` is the point: seal-outer is only ever LOCKED because the player slammed it, so the
    // default auto-open would mean "kill the boss ⇒ your own seal pops". Instead a key drops (D117/M5).
    expect(level().enemies.some((e) => e.id === "the-warden")).toBe(true);
    // No other gate carries a keyholder lock — the Warden has exactly one door.
    for (const g of gates) if (g.id !== "seal-outer") expect(g.openBy.some((c) => c.kind === "keyholder")).toBe(false);
  });

  it("B3 — the control-room Region is authored and holds the control-room levers", () => {
    const region = level().controlRoom!;
    expect(region).toBeDefined();
    for (const id of ["winch-control", "winch-hall"]) {
      const lever = level().levers!.find((l) => l.id === id)!;
      expect(inRegion(lever.pos, region), `${id} is outside the control room`).toBe(true);
    }
  });

  it("B5/B9 — two destructible seals, lockpick-only cells, and every mouth is an exfil site", () => {
    const gates = buildAuthoredGates(level());
    for (const id of ["seal-inner", "seal-outer"]) {
      const seal = gateNamed(gates, id);
      const dest = seal.openBy.find((c) => c.kind === "destructible") as { kind: "destructible"; hp: number };
      // ~60-70hp = a 2-3 turn HEAD START at the garrison's 8-12 per hit (C2), not a full-escort hold.
      expect(dest.hp).toBeGreaterThanOrEqual(60);
      expect(dest.hp).toBeLessThanOrEqual(70);
      expect(seal.locked, `${id} must start OPEN — a locked seal is a turn-1 drive magnet`).toBe(false);
    }
    for (const id of ["cell-wren", "cell-cass", "cell-bram", "hall-gate"]) {
      expect(gateNamed(gates, id).openBy).toEqual([{ kind: "lockpick" }]);
    }
    // The extraction span is the UNION of both mouths (D118 G5), not one edge.
    const span = level().objectives!.find((o) => o.kind === "extraction")!.span!;
    const key = (c: GridCoord) => `${c.col},${c.row}`;
    expect(span.map(key).sort()).toEqual(["10,19", "19,4", "19,5", "19,6", "8,19", "9,19"].sort());
  });

  it("B8 — NO garrison unit can open any gate but the two seals, even with every gate forced shut", () => {
    // The sharp hazard (C2 / D117 F2): `driveSealFor` picks the NEAREST gate a unit can open
    // (`keyholderOf(g, unit) || isBreakable(g)`), sorted by manhattan, with **no route-relevance
    // check** — so a garrison keyholder of a cell would walk over and open the cells for the player.
    // Forcing every gate LOCKED is the strong form: it holds whatever a lever has toggled mid-fight.
    const gates = buildAuthoredGates(level());
    for (const g of gates) g.locked = true;
    const enemies = buildAuthoredEnemies(level());
    const SEALS = new Set(["seal-inner", "seal-outer"]);
    for (const u of enemies) {
      expect(hasTag(u, GARRISON)).toBe(true);
      for (const g of gates) {
        const openable = keyholderOf(g, u) || isBreakable(g);
        expect(openable, `garrison unit "${u.id}" can open gate "${g.id}"`).toBe(SEALS.has(g.id));
      }
    }
  });

  it("B6a — the shut inner seal FULLY walls the garrison off the infiltration route (no path around)", () => {
    // If any open path existed the garrison would walk around and never batter — the head start,
    // and with it the whole split-force op, would silently evaporate.
    const lvl = level();
    const gates = buildAuthoredGates(lvl);
    const seal = gateNamed(gates, "seal-inner");
    const garrison = lvl.enemies.filter((e) => e.pos.row > 8).map((e) => e.pos);
    expect(garrison.length).toBeGreaterThanOrEqual(8); // the barracks mass

    // Everything north of row 8 the garrison can reach while the seal stands OPEN. (The cells
    // themselves sit behind their own locked lockpick doors either way, so they aren't the probe.)
    const NORTH = [
      { col: 11, row: 5 }, // the control room
      { col: 17, row: 6 }, // the wall-walk lever
      SIDE_SPAWN,
      { col: 19, row: 5 }, // the east mouth
    ];
    // As authored the seal is OPEN — the garrison patrols through (so the wall proven below is the
    // SEAL doing its job, not an authoring accident that bricks the barracks off permanently).
    const open = stagedGrid(gates);
    for (const p of garrison) for (const t of NORTH) expect(findPath(open, p, t)).not.toBeNull();

    // Slam it (the turn-1 lever) — now every barracks body is cut off from every cell, every mouth-side
    // control-room tile, and the side-door spawn.
    // Slam it (the turn-1 lever) — now NO barracks body can reach ANY tile north of the row-8 wall.
    // The whole-region form, not a probe list: a single hole punched anywhere in the shell (letting
    // the garrison round the seal into the antechamber, say) turns this red.
    seal.locked = true;
    const shut = stagedGrid(gates);
    const northTiles: GridCoord[] = [];
    for (let row = 0; row < 8; row++)
      for (let col = 0; col < lvl.cols; col++) if (shut.isWalkable({ col, row })) northTiles.push({ col, row });
    expect(northTiles.length).toBeGreaterThan(30);
    for (const p of garrison) {
      for (const t of northTiles)
        expect(findPath(shut, p, t), `garrison at ${p.col},${p.row} still reaches ${t.col},${t.row}`).toBeNull();
    }
  });

  it("B6b — the turn-1 lever: `winch-wall` toggles the inner seal and sits within one move of the side spawn", () => {
    const lvl = level();
    // The infiltrator's start is the authored **side-door spawn zone** now (D119), not
    // `playerSpawns[0]` — the roster-order index-map that put a Soldier here is what D119 replaced.
    const side = lvl.spawnZones!.find((z) => z.id === "side-door")!;
    expect(side.tiles).toEqual([SIDE_SPAWN]);
    const lever = lvl.levers!.find((l) => l.id === "winch-wall")!;
    expect(lever.targets).toEqual(["seal-inner"]);
    // A lever is pulled from its tile or one step away, so the infiltrator needs (dist - 1) movement.
    const dist = Math.abs(lever.pos.col - SIDE_SPAWN.col) + Math.abs(lever.pos.row - SIDE_SPAWN.row);
    expect(dist - 1).toBeLessThanOrEqual(3); // well inside a 4-5 moveRange ⇒ move + pull on turn 1
    // …and the walk is unobstructed at the authored lock state (no door to pick first).
    expect(findPath(stagedGrid(buildAuthoredGates(lvl)), SIDE_SPAWN, lever.pos)).not.toBeNull();
  });

  it("B6c — every cells→mouth escort route runs a chokepoint (cut vertices, not just one corridor)", () => {
    // "All mouths are exfil" means the escort CHOOSES a route, so the chokepoint requirement is on the
    // whole route set: an unchokepointed shorter alternate would quietly become *the* route (C2 §2).
    const lvl = level();
    const span = lvl.objectives!.find((o) => o.kind === "extraction")!.span!;
    /** The terrain grid with `choke` additionally blocked — a cut-vertex probe. */
    const without = (choke: GridCoord): TileGrid => new TileGrid(lvl.cols, lvl.rows, [...lvl.blocked, choke]);
    const terrain = new TileGrid(lvl.cols, lvl.rows, lvl.blocked);

    // (9,5) — the cellblock hall door: on EVERY route from EVERY cell to EVERY mouth.
    for (const c of lvl.captives!) {
      for (const m of span) {
        expect(findPath(terrain, c.pos, m), "no escort route at all").not.toBeNull();
        expect(findPath(without({ col: 9, row: 5 }), c.pos, m), `${c.spec.id}→(${m.col},${m.row}) bypasses (9,5)`).toBeNull();
      }
    }
    // (14,5) — the wall-walk doorway: the choke on the east-mouth leg specifically.
    for (const c of lvl.captives!) {
      for (const m of span.filter((t) => t.col === 19)) {
        expect(findPath(without({ col: 14, row: 5 }), c.pos, m), `${c.spec.id}→east mouth bypasses (14,5)`).toBeNull();
      }
    }
    // (13,8) — the inner seal: the choke on the bottom-mouth leg (the route back through the barracks).
    for (const c of lvl.captives!) {
      for (const m of span.filter((t) => t.row === 19)) {
        expect(findPath(without({ col: 13, row: 8 }), c.pos, m), `${c.spec.id}→bottom mouth bypasses (13,8)`).toBeNull();
      }
    }
  });

  it("the slammed seal actually DRIVES the garrison (the doctrine fires on the live board, not just on paper)", () => {
    // The end-to-end proof that B1's tags + B5's seal + B8's lock choices compose: stage the real
    // level, pull the turn-1 winch, and ask the shipped planner what the barracks garrison does.
    // Before the slam there is no openable gate at all (both seals start open, everything else is
    // lockpick-only) ⇒ no drive; after it, unengaged garrison bodies converge to batter `seal-inner`.
    const { loop } = buildScenarioRun(levelToScenario(level()));
    loop.startEncounter();
    loop.beginBattle();
    const battle = loop.staged!.battle;
    const warden = battle.units.find((u) => u.id === "the-warden")!;
    const planOpts = () => ({ gates: battle.gates, tagContext: battle.tagContext(), controlRoom: battle.controlRoom });

    expect(planEnemyTurn(warden, battle.units, battle.grid, planOpts()).gateTarget).toBeUndefined();

    const winch = battle.levers.find((l) => l.id === "winch-wall")!;
    // Whoever the player sent through the side door. (Before D119 this read `pos.col >= 15`,
    // which only worked because `placeParty` index-mapped party[0] onto the side spawn — the
    // very defect authored zones removed. The doctrine under test is the seal-drive, not
    // placement, so the probe just puts *a* player body on the winch.)
    const infiltrator = battle.units.find((u) => u.side === "player" && !u.captured)!;
    infiltrator.pos = { ...winch.pos };
    battle.pullLever(winch, infiltrator);
    expect(battle.gates.find((g) => g.id === "seal-inner")!.locked).toBe(true);

    const seal = battle.gates.find((g) => g.id === "seal-inner")!;
    const dist = (a: GridCoord) => Math.abs(a.col - seal.pos.col) + Math.abs(a.row - seal.pos.row);
    const barracks = battle.units.filter((u) => u.side === "enemy" && u.pos.row > 8);
    expect(barracks.length).toBeGreaterThanOrEqual(8);
    for (const u of barracks) {
      const plan = planEnemyTurn(u, battle.units, battle.grid, planOpts());
      // Driving, not fighting: the door-drive ignores foes outright…
      expect(plan.target, `${u.id} attacked instead of driving the seal`).toBeNull();
      // …and every body closes on the ONE gate it can open — nothing else is openable to it (B8).
      expect(dist(plan.destination), `${u.id} did not close on the seal`).toBeLessThan(dist(u.pos));
      if (plan.gateTarget) {
        expect(plan.gateTarget.id).toBe("seal-inner");
        expect(plan.gateAct).toBe("attack"); // no garrison keyholder on the inner seal ⇒ they batter
      }
    }
  });

  it("eliminate-all stays winnable without a Thief — every enemy is reachable with the lockpick gates shut", () => {
    // The frontal win must never hard-require the flank's Thief (D99 graceful degradation). No enemy
    // may sit behind a lockpick-only door.
    const lvl = level();
    const grid = stagedGrid(buildAuthoredGates(lvl));
    for (const e of lvl.enemies) {
      expect(findPath(grid, MAIN_SPAWN, e.pos), `enemy at ${e.pos.col},${e.pos.row} is behind a locked door`).not.toBeNull();
    }
  });
});

describe("the unit-id uniqueness guard (D98 editor M-B)", () => {
  it("flags two units sharing an explicit id (objective tags/lookup bind by id)", () => {
    const level = getLevel("the-rescue")!;
    // Force a clash: give the warden the same id as a captive.
    const clash = { ...level, enemies: level.enemies.map((e, i) => (i === 0 ? { ...e, id: "wren" } : e)) };
    expect(validateLevel(clash).some((i) => /duplicate unit id "wren"/.test(i))).toBe(true);
  });

  it("passes the shipped levels (their ids are already unique)", () => {
    for (const id of ["the-rescue", "prison-break", "sample-skirmish"]) {
      expect(validateLevel(getLevel(id)!).filter((i) => /duplicate unit id/.test(i))).toEqual([]);
    }
  });
});

/**
 * The spawn-zone content guard (D119). Authored zones decide where the party stands, which
 * ground is capture-immune, and when the deploy phase force-starts — every rule below is one
 * whose violation would otherwise surface as a mid-deploy freeze or a silently-wrong phase
 * rather than a load error. Each case must fail on **its own** violation and nothing else.
 */
describe("the spawn-zone guard (D119)", () => {
  const base = () => ({
    id: "zoned",
    name: "Zoned",
    cols: 6,
    rows: 6,
    blocked: [{ col: 5, row: 5 }],
    playerSpawns: [{ col: 0, row: 0 }],
    enemies: [{ templateId: "bandit-thug", pos: { col: 4, row: 4 } }],
    gates: [{ id: "door", pos: { col: 3, row: 3 }, openBy: [{ kind: "lockpick" }], locked: true }],
    reward: { gold: 10, materials: [], xp: 10 },
    spawnZones: [
      { id: "main", label: "the Gate", primary: true, cap: 2, tiles: [{ col: 0, row: 0 }, { col: 1, row: 0 }] },
      { id: "back", label: "the Back Way", cap: 1, requiresFlag: "some-intel", tiles: [{ col: 5, row: 0 }] },
    ],
  });
  const only = (issues: string[], re: RegExp) => {
    expect(issues.some((i) => re.test(i)), `no issue matched ${re}: ${JSON.stringify(issues)}`).toBe(true);
    return issues;
  };

  it("the well-formed shape validates clean", () => {
    expect(validateLevel(base())).toEqual([]);
  });

  it("rejects a set with no primary zone, and a set with two", () => {
    const none = base();
    none.spawnZones[0].primary = false;
    only(validateLevel(none), /exactly one primary/);
    const two = base();
    two.spawnZones[1].primary = true;
    only(validateLevel(two), /exactly one primary/);
  });

  it("rejects a flag-gated PRIMARY (it could vanish at stage time, leaving nowhere to stand)", () => {
    const lvl = base();
    lvl.spawnZones[0].requiresFlag = "some-intel";
    only(validateLevel(lvl), /primary AND flag-gated/);
  });

  it("rejects a zone tile drawn in a wall — the exact defect authored zones exist to fix", () => {
    const lvl = base();
    lvl.spawnZones[1].tiles = [{ col: 5, row: 5 }]; // blocked terrain
    only(validateLevel(lvl), /blocked terrain/);
  });

  it("rejects a zone tile off the board", () => {
    const lvl = base();
    lvl.spawnZones[1].tiles = [{ col: 9, row: 0 }];
    only(validateLevel(lvl), /off the board/);
  });

  it("rejects a zone tile sitting on a gate (a locked gate blocks it once the battle is built)", () => {
    const lvl = base();
    lvl.spawnZones[1].tiles = [{ col: 3, row: 3 }];
    only(validateLevel(lvl), /is a gate tile/);
  });

  it("rejects overlapping zones (zoneAt must resolve a tile to exactly one entrance)", () => {
    const lvl = base();
    lvl.spawnZones[1].tiles = [{ col: 1, row: 0 }];
    only(validateLevel(lvl), /must not overlap/);
  });

  it("rejects a zero cap and an empty tile list (a zone nobody may enter is a dead verb)", () => {
    const zeroCap = base();
    zeroCap.spawnZones[1].cap = 0;
    only(validateLevel(zeroCap), /integer cap/);
    const empty = base();
    empty.spawnZones[1].tiles = [];
    only(validateLevel(empty), /has no tiles/);
  });

  it("a level that declares NO zones is untouched by the guard", () => {
    const lvl = base();
    delete (lvl as Partial<typeof lvl>).spawnZones;
    expect(validateLevel(lvl)).toEqual([]);
  });
});
