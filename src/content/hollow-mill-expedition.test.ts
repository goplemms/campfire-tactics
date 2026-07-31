import { describe, it, expect, beforeEach } from "vitest";
import {
  THE_HOLLOW_MILL,
  THIEVES_DEN_ID,
  E1_SKIRMISH,
  TRAP_FIELD,
  OUTER_YARD,
  THIEVES_GUILD_CONTACT,
  SCOUT_PRESTIGE_FLOOR,
  LEVELING,
  RunLoop,
  createRunFromExpedition,
  clearInjectedNodes,
  getAuthoredNode,
  resolveAuthored,
  validateExpedition,
  stageEncounter,
  previewNode,
  type AuthoredEncounter,
} from "../core";
import { LEVELS } from "./levels";
import { injectContentNodes } from "./authored-nodes";

/**
 * **The Hollow Mill's content-JSON bodies** (D122) — the arc's body-level guards, one layer up.
 *
 * The Hollow Mill's encounters are migrating from TS consts in `core/hollow-mill.ts` to
 * `content/levels/*.json`. The map (topology, edges, `authoredId` bindings) stays curated in
 * core; a converted **body** reaches core only through the injection seam. Since `core/` may
 * never import `content/`, every assertion *about a converted body* — and every test that
 * **plays** a node carrying one — has to live here. That is the same split The Rescue already
 * uses (`the-rescue-expedition.test.ts`), applied to the arc.
 *
 * Converted so far: **the Thieves' Den** (`thieves-den`). Each further conversion adds its
 * body pins here and deletes the const-reading version from `core/hollow-mill.test.ts`.
 */
describe("The Hollow Mill — the bodies that live in content JSON (D122)", () => {
  beforeEach(() => clearInjectedNodes());

  const den = (): AuthoredEncounter => {
    injectContentNodes();
    const body = resolveAuthored(THE_HOLLOW_MILL, THIEVES_DEN_ID);
    if (!body) throw new Error(`no body for "${THIEVES_DEN_ID}"`);
    return body;
  };

  it("the Den's body is served by the JSON file, not an inline const (the shadowing failure mode)", () => {
    injectContentNodes();
    // `resolveAuthored` is `exp.encounters?.[id] ?? getAuthoredNode(id)` — the inline map WINS.
    // Identity (not deep-equality) is what proves the arc plays the JSON: a re-added const would
    // still deep-equal the file while silently being the thing the game runs.
    expect(THE_HOLLOW_MILL.encounters?.[THIEVES_DEN_ID]).toBeUndefined();
    expect(getAuthoredNode(THIEVES_DEN_ID)).toBe(LEVELS[THIEVES_DEN_ID]);
    expect(resolveAuthored(THE_HOLLOW_MILL, THIEVES_DEN_ID)).toBe(LEVELS[THIEVES_DEN_ID]);
  });

  it("with the catalog injected the whole expedition validates clean", () => {
    injectContentNodes();
    expect(validateExpedition(THE_HOLLOW_MILL)).toEqual([]);
  });

  it("without injection the arc fails LOUD at the converted node (never silently different)", () => {
    // The inverse pin: a body that is neither inline nor injected is a load-pipeline error, not
    // a quietly-substituted procedural fight. `core/hollow-mill.test.ts` pins the same shape.
    expect(validateExpedition(THE_HOLLOW_MILL).some((p) => p.includes(THIEVES_DEN_ID))).toBe(true);
  });

  /**
   * The Den's authored design, pinned to the JSON now that no const carries it: the relic grant,
   * the shallow read (D86), the thief roster (the chase-the-thief tension) and the purse.
   */
  it("pins the Den's authored properties (id, dims, roster, intelDepth, grants, reward)", () => {
    const body = den();
    expect(body.id).toBe("thieves-den");
    expect(body.name).toBe("The Thieves' Den");
    expect([body.cols, body.rows]).toEqual([9, 6]);
    expect(body.enemies.map((e) => e.templateId)).toEqual(["thief", "thief", "bandit-cutthroat", "bandit-thug"]);
    // Shallow intel (D86) — a hidden hideout resists a distant read; the first authored use of
    // per-node depth, and the reason this body was the migration's pilot.
    expect(body.intelDepth).toBe(2);
    expect(body.grants).toEqual({ item: "relic-hollow-blade" });
    expect(body.reward).toEqual({ gold: 90, materials: [{ id: "valuables", count: 1 }], xp: 110 });
    expect(body.captives ?? []).toEqual([]);
    expect(body.objectives).toBeUndefined(); // plain eliminate-all
  });

  /** Moved verbatim from `core/intel.test.ts` — it reads the Den's authored depth (D86). */
  it("the Thieves' Den is authored shallow (depth 2) — fully known to a smart party, no positions", () => {
    injectContentNodes();
    const run = createRunFromExpedition(THE_HOLLOW_MILL); // Vale int 7 → tier-2 floor
    const den = previewNode(run, "den");
    expect(den.intelDepth).toBe(2);
    // At the tier-2 floor the den is already read to its depth — nothing to scout.
    expect(den.intelComplete).toBe(true);
    expect(den.intel?.positions).toBeUndefined(); // never learns where the thieves lurk
    // A Survey bump can't push past the cap.
    expect(previewNode(run, "den", 1).intel?.tier).toBe(2);
  });

  it("the Den fields thief enemies (the chase-the-thief tension)", () => {
    const body = den();
    expect(body.enemies.some((e) => e.templateId === "thief")).toBe(true);
    const run = createRunFromExpedition(THE_HOLLOW_MILL);
    const staged = stageEncounter(body, run.party);
    expect(staged.battle.units.some((u) => u.side === "enemy" && u.thief)).toBe(true);
  });

  /**
   * **The C3 pacing guard** (moved from `core/hollow-mill.test.ts`, D122).
   *
   * It sums `reward.xp` across the infiltration arm's pre-rite combats — and those bodies now
   * live in **two different homes** (TS consts + content JSON) while the migration runs. Reading
   * each through {@link resolveAuthored} rather than from a const makes the sum home-agnostic:
   * it is exactly the XP the *game* will award, and it keeps working as the remaining bodies
   * convert without another edit.
   */
  it("C3 pacing: guaranteed objective-XP clears a fielded Scout to the prestige floor by the Guild's Rite", () => {
    injectContentNodes();
    const xpOf = (id: string): number => {
      const body = resolveAuthored(THE_HOLLOW_MILL, id);
      if (!body) throw new Error(`no body for "${id}" — inline nor injected`);
      return body.reward.xp ?? 0;
    };
    // The infiltration arm's pre-rite combats award reward.xp uncontested to every survivor's
    // primary job (routeCombatXp); the guild-contact grant tops it up. With ZERO combat kill/hit
    // tally (the worst case), this floor alone must reach L5 — else the rite silently omits the
    // prestige and the Thief route evaporates (the red-team's silent-dead-end). Vale starts L1.
    const guaranteedObjXp =
      xpOf(E1_SKIRMISH.id) + xpOf(TRAP_FIELD.id) + xpOf(THIEVES_DEN_ID) + xpOf(OUTER_YARD.id);
    const contactGrant = THIEVES_GUILD_CONTACT.choices.find((c) => c.outcome.jobXp)!.outcome.jobXp!.amount;
    const floorXp = (SCOUT_PRESTIGE_FLOOR - 1) * LEVELING.xpPerJobLevel; // L1 → L5
    expect(guaranteedObjXp + contactGrant).toBeGreaterThanOrEqual(floorXp);
    // …and the sum genuinely read the converted body, rather than defaulting a missing one to 0.
    expect(xpOf(THIEVES_DEN_ID)).toBe(110);
  });
});

/**
 * The arc **played end to end** with the content catalog injected — the walks that cross a
 * converted body. These moved from `core/hollow-mill.test.ts` unchanged except for the
 * injection: the run itself is pure core, only the Den's body comes from content.
 */
describe("The Hollow Mill — runs that cross a content-JSON node", () => {
  beforeEach(() => {
    clearInjectedNodes();
    injectContentNodes();
  });

  const freshLoop = (): RunLoop => new RunLoop(createRunFromExpedition(THE_HOLLOW_MILL));
  /** Force a clean win: every enemy down (drivers too ⇒ any closing-gate is met). */
  const forceWin = (loop: RunLoop): void => {
    for (const u of loop.staged!.battle.units) if (u.side === "enemy") u.alive = false;
  };
  /** Walk the expedition; `pick` chooses among reachable nodes, `onCombat` decides each fight. */
  function drive(loop: RunLoop, onCombat: (loop: RunLoop) => void, pick: (ids: string[]) => string = (ids) => ids[0]): string[] {
    const visited: string[] = [];
    let guard = 0;
    while (!loop.isTerminal() && guard++ < 30) {
      const reachable = loop.reachable();
      if (reachable.length === 0) break;
      const node = loop.choose(pick(reachable.map((n) => n.id)));
      visited.push(node.id);
      if (node.kind === "combat") {
        loop.startEncounter();
        loop.beginBattle();
        onCombat(loop);
        loop.resolve();
      } else {
        loop.playCurrentNode(); // rest / event — no fight
      }
    }
    return visited;
  }

  it("CLEAR via the infiltration arm: relic at the Den + the cell prisoner joins, and NO Medic (C8)", () => {
    const loop = freshLoop();
    // Route: e1 → camp2 → snares → market → guildContact → den → outerYard → guildRite → cuffedCell → finale.
    const route = ["e1", "camp2", "snares", "market", "guildContact", "den", "outerYard", "guildRite", "cuffedCell", "finale"];
    const visited = drive(loop, forceWin, (ids) => ids.find((id) => route.includes(id)) ?? ids[0]);
    expect(visited).toContain("cuffedCell");
    // The relic is granted by the JSON body's `grants.item` — the end-to-end proof that a
    // converted body's grants still land in a real run.
    expect(loop.run.inventory.counts["relic-hollow-blade"] ?? 0).toBeGreaterThan(0);
    expect(loop.run.party.some((u) => u.id === "cell-prisoner")).toBe(true); // recruit-on-win (D52), even frontally
    expect(loop.run.party.some((u) => u.id === "sela")).toBe(false); // no Medic catch-up on this arm (C8)
    expect(loop.isComplete()).toBe(true);
  });

  it("a pure AI auto-traverse reaches a terminal deterministically (replayable)", () => {
    const a = freshLoop();
    const b = freshLoop();
    a.autoTraverse();
    b.autoTraverse();
    expect(a.isTerminal()).toBe(true);
    expect(b.isTerminal()).toBe(true);
    expect(a.run.path).toEqual(b.run.path);
    expect(a.run.complete).toBe(b.run.complete);
  });
});
