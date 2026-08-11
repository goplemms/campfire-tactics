import { describe, it, expect } from "vitest";
import {
  THE_HOLLOW_MILL,
  E1_SKIRMISH_ID,
  TRAP_FIELD_ID,
  PRISON_WAGON_ID,
  THIEVES_DEN_ID,
  OUTER_YARD_ID,
  CUFFED_CELL_ID,
  PRISON_ASSAULT,
} from "./hollow-mill";
import { stageEncounter, encounterOutcome } from "./staging";
// `isConcealedTrap` left with the trap-field staging test when it moved to
// `content/hollow-mill-expedition.test.ts` (D122).
import { validateExpedition } from "./expedition";
import { createRunFromExpedition } from "./run";
// `LEVELING` / `THIEVES_GUILD_CONTACT` / `SCOUT_PRESTIGE_FLOOR` left with the C3 pacing guard
// when it moved to `content/hollow-mill-expedition.test.ts` (D122); `RunLoop` / `jobLevelOf` and
// the `freshLoop` / `forceWin` / `drive` walkers left with the node-1 tests, for the same reason —
// every walk of this arc now starts on a body that lives in content JSON.
import { intelFloor } from "./intel";
import { createUnit } from "./units";
import { freeCaptive, canRelease } from "./deployment";
import { gearDelta } from "./gear-condition";
import { grantItem } from "./inventory";

describe("The Hollow Mill — the redesigned vertical slice (D52)", () => {
  /**
   * **The arc is only fully valid one layer up** (D122). Bodies converted to
   * `content/levels/*.json` resolve through the injected catalog, and `core/` may never import
   * `content/` — so from here the *only* thing `validateExpedition` can report is those
   * un-injected ids. Asserting that shape (rather than `[]`) keeps the core-side claim real:
   * edges, reachability, cycles and prerequisites are all still proven clean here, and the
   * `[]` assertion lives in `content/hollow-mill-expedition.test.ts` **with injection live**.
   * Stated as a shape, not a list, so the next conversion doesn't have to touch it.
   */
  it("is a valid hand-built expedition — every problem is a body that lives in content JSON", () => {
    const problems = validateExpedition(THE_HOLLOW_MILL);
    for (const p of problems) expect(p).toMatch(/binds authoredId ".*" with no encounter/);
    expect(problems.some((p) => p.includes(THIEVES_DEN_ID))).toBe(true);
  });

  it("authors the Wave-0 topology (spine → pre-fork Market → two exclusive arms → finale)", () => {
    const m = THE_HOLLOW_MILL.map;
    expect(m.startId).toBe("start");
    expect(m.finalIds).toEqual(["finale"]);
    // Spine → the shared pre-fork Market → the FORK (a single either/or).
    expect(m.nodes.snares.edges).toEqual(["market"]);
    expect(m.nodes.market.edges).toEqual(["guildContact", "wagon"]);
    // Sustain arm: wagon → restCamp → finale.
    expect(m.nodes.wagon.edges).toEqual(["restCamp"]);
    expect(m.nodes.restCamp.edges).toEqual(["finale"]);
    // Infiltration arm: guildContact → den → outerYard → guildRite → cuffedCell → finale.
    expect(m.nodes.guildContact.edges).toEqual(["den"]);
    expect(m.nodes.den.edges).toEqual(["outerYard"]);
    expect(m.nodes.outerYard.edges).toEqual(["guildRite"]);
    expect(m.nodes.guildRite.edges).toEqual(["cuffedCell"]);
    expect(m.nodes.cuffedCell.edges).toEqual(["finale"]);
    // Authored bindings resolve.
    expect(m.nodes.e1.authoredId).toBe(E1_SKIRMISH_ID); // body in content JSON (D122)
    expect(m.nodes.snares.authoredId).toBe(TRAP_FIELD_ID); // body in content JSON (D122)
    expect(m.nodes.wagon.authoredId).toBe(PRISON_WAGON_ID); // body in content JSON (D122)
    expect(m.nodes.den.authoredId).toBe(THIEVES_DEN_ID); // body in content JSON (D122)
    expect(m.nodes.outerYard.authoredId).toBe(OUTER_YARD_ID); // body in content JSON (D122)
    expect(m.nodes.cuffedCell.authoredId).toBe(CUFFED_CELL_ID); // body in content JSON (D122)
    expect(m.nodes.finale.authoredId).toBe(PRISON_ASSAULT.id);
    // The pinned event nodes bind their beats (the pre-fork town + the mentor two-beat).
    expect(m.nodes.camp2.eventId).toBe("provision-choice");
    expect(m.nodes.market.eventId).toBe("merchant-town");
    expect(m.nodes.guildContact.eventId).toBe("guild-contact");
    expect(m.nodes.guildRite.eventId).toBe("guild-rite");
  });

  it("C8: the two arms are topology-exclusive — disjoint but for the terminal finale", () => {
    const m = THE_HOLLOW_MILL.map;
    // Forward (transitive) reachability — the only movement the run allows (chooseNode never
    // backtracks), so this is what "exclusive by topology" means, not an asserted invariant.
    const reach = (from: string): Set<string> => {
      const seen = new Set<string>();
      const stack = [...m.nodes[from].edges];
      while (stack.length) {
        const id = stack.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        stack.push(...m.nodes[id].edges);
      }
      return seen;
    };
    const sustain = reach("wagon");
    const infil = reach("guildContact");
    // Neither arm can reach the other's nodes…
    for (const id of ["guildContact", "den", "outerYard", "guildRite", "cuffedCell"]) expect(sustain.has(id)).toBe(false);
    for (const id of ["wagon", "restCamp"]) expect(infil.has(id)).toBe(false);
    // …and their only shared descendant is the terminal finale (no leak back).
    expect([...sustain].filter((id) => infil.has(id))).toEqual(["finale"]);
    expect(m.nodes.finale.edges).toEqual([]);
  });

  // The **C3 pacing guard** moved to `content/hollow-mill-expedition.test.ts` (D122): it sums
  // `reward.xp` across the infiltration arm, and the Den's body is now content JSON — a sum a
  // core test cannot read without importing content. It reads the *resolved* body there, so it
  // keeps working whichever home each remaining body lives in.

  it("boots with the starting trio (recruits join via their nodes, not the bundle)", () => {
    const run = createRunFromExpedition(THE_HOLLOW_MILL);
    expect(run.party).toHaveLength(3);
    expect(run.party.map((u) => u.id).sort()).toEqual(["edrin", "rook", "vale"]);
    expect(run.camp.purse).toBe(120);
    expect(run.expeditionId).toBe("hollow-mill");
  });

  // The four **node-1 Cook-rescue** tests (Pip staged bound, recruited on the win, freed
  // mid-fight, and "L1 winnable raw") moved to `content/hollow-mill-expedition.test.ts` (D122):
  // each *enters* node `e1`, whose body is now `content/levels/e1-skirmish.json`, and
  // `runEncounter` throws rather than fabricate a fight when a bound `authoredId` cannot resolve.

  // "the trap-field stages strong concealed snares + one weak enemy" moved to
  // `content/hollow-mill-expedition.test.ts` (D122) — it reads the Snares' *body*, which is now
  // `content/levels/snares-trapfield.json`.

  // "CLEAR via the sustain arm" moved to `content/hollow-mill-expedition.test.ts` — the walk
  // starts at `e1`, whose body is content JSON (D122), so it needs the catalog injected.
  // "CLEAR via the infiltration arm" moved there earlier, for the same reason at the Den.

  it("the iron-weapons pick grants party-gear that confers a blanket +attack edge (D78)", () => {
    const run = createRunFromExpedition(THE_HOLLOW_MILL);
    // Nothing carried ⇒ identity delta.
    expect(gearDelta(run)).toEqual({ stats: {}, passives: {}, defensePenalty: 0 });
    grantItem(run.inventory, "iron-weapons");
    expect(gearDelta(run).stats.attack).toBeGreaterThan(0);
    // The edge decays with worn gear; the blanket −defense penalty appears with wear.
    run.camp.gearWear = 99;
    expect(gearDelta(run).stats.attack ?? 0).toBe(0);
    expect(gearDelta(run).defensePenalty).toBeGreaterThan(0);
  });

  // "a pure AI auto-traverse reaches a terminal deterministically" moved to
  // `content/hollow-mill-expedition.test.ts` — `autoTraverse` walks the infiltration arm
  // (first-reachable), so it plays the Den's content-JSON body (D122).

  // "WIPE: losing node 1 ends the run" moved to `content/hollow-mill-expedition.test.ts` — it
  // enters `e1`, whose body is content JSON (D122).

  it("the party floors intel at tier 2 — the intel teeth are reachable (D10)", () => {
    const party = THE_HOLLOW_MILL.bundle.party.map(createUnit);
    expect(intelFloor(party)).toBeGreaterThanOrEqual(2);
  });

  // "the Den fields thief enemies" moved to `content/hollow-mill-expedition.test.ts` — it is a
  // *body* assertion, and the Den's body is content JSON (D122); core must not import content.
});

describe("The Prison Assault finale (D97) — the dual-OR win", () => {
  /** The starting trio (soldier/hunter/scout — no lockpick), as live units. */
  const finaleParty = () => THE_HOLLOW_MILL.bundle.party.map(createUnit);
  const extractSpan = (staged: ReturnType<typeof stageEncounter>) =>
    staged.objectives.find((o) => o.spec.kind === "extraction")!.spec.span!;

  it("authors two OR'd goals: storm the garrison OR extract the prisoners", () => {
    const goals = PRISON_ASSAULT.objectives ?? [];
    expect(goals.map((o) => o.kind).sort()).toEqual(["eliminate-all", "extraction"]);
    const extraction = goals.find((o) => o.kind === "extraction")!;
    expect(extraction.escort).toEqual({ role: "prisoner" });
    expect((extraction.span ?? []).length).toBeGreaterThan(0);
    // Both cells are lockpick-gated (Thief-only), and there are exactly two prisoners.
    expect(PRISON_ASSAULT.captives).toHaveLength(2);
    expect(PRISON_ASSAULT.captives!.every((c) => c.release?.kind === "lockpick")).toBe(true);
  });

  it("frontal path: clearing the garrison wins even with the prisoners still cuffed", () => {
    const staged = stageEncounter(PRISON_ASSAULT, finaleParty());
    expect(encounterOutcome(staged)).toBeUndefined(); // undecided at the start
    for (const u of staged.battle.units) if (u.side === "enemy") u.alive = false;
    // Prisoners never freed — extraction stays pending — but eliminate-all wins (OR'd, D97).
    expect(staged.battle.units.filter((u) => u.captured).length).toBe(2);
    expect(encounterOutcome(staged)).toBe("win");
  });

  it("extraction path: escort the freed prisoners out — a win with the garrison still standing", () => {
    const staged = stageEncounter(PRISON_ASSAULT, finaleParty());
    const prisoners = staged.battle.units.filter((u) => u.role === "prisoner");
    const exit = extractSpan(staged);
    expect(prisoners).toHaveLength(2);
    prisoners.forEach((p, i) => { freeCaptive(p); p.pos = { ...exit[i] }; });
    // The garrison is untouched — a frontal party would still be mid-fight here.
    expect(staged.battle.units.some((u) => u.side === "enemy" && u.alive)).toBe(true);
    expect(encounterOutcome(staged)).toBe("win");
  });

  it("extraction stays pending until EVERY freed prisoner is at the exit", () => {
    const staged = stageEncounter(PRISON_ASSAULT, finaleParty());
    const prisoners = staged.battle.units.filter((u) => u.role === "prisoner");
    const exit = extractSpan(staged);
    // Free + extract only the first — enemies still up, one prisoner short ⇒ undecided.
    freeCaptive(prisoners[0]); prisoners[0].pos = { ...exit[0] };
    expect(encounterOutcome(staged)).toBeUndefined();
    // A still-cuffed prisoner parked on the exit tile does NOT count.
    prisoners[1].pos = { ...exit[1] };
    expect(encounterOutcome(staged)).toBeUndefined();
    freeCaptive(prisoners[1]);
    expect(encounterOutcome(staged)).toBe("win");
  });

  it("the cells resist the starting trio — no lockpick capability, so it wins frontally (C4)", () => {
    const staged = stageEncounter(PRISON_ASSAULT, finaleParty());
    const prisoners = staged.battle.units.filter((u) => u.role === "prisoner");
    const party = staged.battle.units.filter((u) => u.side === "player" && !u.captured);
    for (const p of prisoners) for (const by of party) expect(canRelease(p, by)).toBe(false);
  });

  // --- Adversarial edge cases (the D97 /challenge pass) ----------------------

  it("no prisoner starts on/near the exit — extraction can't be won before the fight (challenge F)", () => {
    // The one non-structural risk the classifier has: extraction is polled from battle-start, so
    // a prisoner authored ON the exit (freed in deploy) would instant-win with zero combat. The
    // shipped finale is safe only by GEOMETRY (cells deep in enemy ground, exit at the home edge) —
    // pin it so a future re-placement can't silently make the finale a walkover.
    const ext = PRISON_ASSAULT.objectives!.find((o) => o.kind === "extraction")!;
    const exitCols = new Set((ext.span ?? []).map((t) => t.col));
    for (const c of PRISON_ASSAULT.captives ?? []) {
      expect(exitCols.has(c.pos.col)).toBe(false);
      expect(c.pos.col).toBeGreaterThan(4); // a real cross-board escort, not a step to freedom
    }
  });

  it("party wiped with the cells still cuffed ⇒ WIPE (bound bodies don't keep the side alive, challenge A1c)", () => {
    const staged = stageEncounter(PRISON_ASSAULT, finaleParty());
    for (const u of staged.battle.units) if (u.side === "player" && u.role !== "prisoner") u.alive = false;
    expect(encounterOutcome(staged)).toBe("wipe");
  });

  it("both prisoners downed never VACUOUSLY satisfies extraction (challenge A4)", () => {
    const staged = stageEncounter(PRISON_ASSAULT, finaleParty());
    const prisoners = staged.battle.units.filter((u) => u.role === "prisoner");
    prisoners.forEach((p) => { p.captured = false; p.alive = false; }); // freed then cut down
    // A party member still stands + the garrison is up → the empty escort set must read PENDING,
    // not a vacuous win (dead escortees stay in the tag set, so `every(alive)` fails).
    expect(encounterOutcome(staged)).toBeUndefined();
  });

  it("a lone freed prisoner escorted out WINS even after the party falls (freed = party member, challenge A1a)", () => {
    const staged = stageEncounter(PRISON_ASSAULT, finaleParty());
    const prisoners = staged.battle.units.filter((u) => u.role === "prisoner");
    const exit = extractSpan(staged);
    for (const u of staged.battle.units) if (u.side === "player" && u.role !== "prisoner") u.alive = false;
    prisoners.forEach((p, i) => { freeCaptive(p); p.pos = { ...exit[i] }; }); // extracted anyway
    expect(encounterOutcome(staged)).toBe("win"); // the extraction stands on its own
  });
});
