import { describe, it, expect, beforeEach } from "vitest";
import {
  THE_HOLLOW_MILL,
  THIEVES_DEN_ID,
  E1_SKIRMISH_ID,
  PRISON_WAGON_ID,
  CUFFED_CELL_ID,
  TRAP_FIELD_ID,
  PIP_COOK,
  SELA_MEDIC,
  OUTER_YARD_ID,
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
  readEncounter,
  previewNode,
  jobLevelOf,
  freeCaptive,
  canRelease,
  createUnit,
  isConcealedTrap,
  TRAP_INTEL,
  type AuthoredEncounter,
  type Unit,
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
 * Converted: **all six** of the arc's reachable bodies — `thieves-den`, `e1-skirmish`,
 * `prison-wagon`, `cuffed-cell`, `snares-trapfield`, `outer-yard`. The Hollow Mill's inline
 * `encounters` map is down to its last entry (`prison-assault`, which checklist F1 deletes rather
 * than converts). Each conversion added its body pins here and deleted the const-reading version
 * from `core/hollow-mill.test.ts`.
 */
describe("The Hollow Mill — the bodies that live in content JSON (D122)", () => {
  beforeEach(() => clearInjectedNodes());

  /** Resolve a converted body the way the game does — inline map first, then the injected catalog. */
  const bodyOf = (id: string): AuthoredEncounter => {
    injectContentNodes();
    const body = resolveAuthored(THE_HOLLOW_MILL, id);
    if (!body) throw new Error(`no body for "${id}"`);
    return body;
  };
  const den = (): AuthoredEncounter => bodyOf(THIEVES_DEN_ID);

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

  // --- Node 1 — Skirmish at the Mill Yard (`e1-skirmish`, conversion 2) -------

  it("the Skirmish's body is served by the JSON file, not an inline const (the shadowing failure mode)", () => {
    injectContentNodes();
    expect(THE_HOLLOW_MILL.encounters?.[E1_SKIRMISH_ID]).toBeUndefined();
    expect(getAuthoredNode(E1_SKIRMISH_ID)).toBe(LEVELS[E1_SKIRMISH_ID]);
    expect(resolveAuthored(THE_HOLLOW_MILL, E1_SKIRMISH_ID)).toBe(LEVELS[E1_SKIRMISH_ID]);
  });

  /**
   * The Skirmish's authored design, pinned to the JSON now that no const carries it: the
   * three-body roster with the captor set **apart** (the flank + rescue corner), Pip bound beside
   * him, and the L2-clearing purse.
   */
  it("pins the Skirmish's authored properties (dims, roster, the bound Cook, reward)", () => {
    const body = bodyOf(E1_SKIRMISH_ID);
    expect(body.id).toBe("e1-skirmish");
    expect(body.name).toBe("Skirmish at the Mill Yard");
    expect([body.cols, body.rows]).toEqual([8, 6]);
    expect(body.enemies.map((e) => e.templateId)).toEqual(["bandit-thug", "bandit-bowman", "bandit-cutthroat"]);
    // The captor sits apart in the corner (col 7,row 0); Pip is bound beside him — "isolating
    // the captor IS the rescue", so the flank and the rescue are the same corner.
    expect(body.enemies[2].pos).toEqual({ col: 7, row: 0 });
    expect(body.captives).toHaveLength(1);
    expect(body.captives![0].spec.id).toBe("pip");
    expect(body.captives![0].spec.jobId).toBe("cook");
    expect(body.captives![0].pos).toEqual({ col: 7, row: 1 });
    // No `release` authored ⇒ the default reach-to-free (the D122 normalization case).
    expect(body.captives![0].release).toBeUndefined();
    // XP tuned so every survivor's primary job reaches L2 after E1 (the 2nd-active unlock).
    expect(body.reward).toEqual({ gold: 60, materials: [{ id: "salve", count: 1 }], xp: 100 });
    expect(body.objectives).toBeUndefined(); // plain eliminate-all
    expect(body.traps).toBeUndefined();
  });

  /** Moved verbatim from `core/intel.test.ts` — it reads the Skirmish's (trapless) body (D83). */
  it("a trapless field reads an honest 'none sensed' — the lane never leaks by absence", () => {
    const body = bodyOf(E1_SKIRMISH_ID);
    expect(readEncounter(body, 1).traps).toEqual({ present: false });
    expect(readEncounter(body, 0).traps).toBeUndefined();
  });

  /**
   * **The cast/body drift guard** (D122 × D123). The cast stays TS while the bodies are JSON, so
   * Pip's spec now exists twice: as {@link PIP_COOK} (the readable record) and serialized inside
   * the body. Nothing else would notice them diverging — the game plays the JSON copy — so pin
   * that they are the same unit. Same for Sela's `grants.recruit` at the Wagon.
   */
  it("the JSON bodies' serialized cast specs still equal the TS cast consts (no silent drift)", () => {
    expect(bodyOf(E1_SKIRMISH_ID).captives![0].spec).toEqual(PIP_COOK);
    expect(bodyOf(PRISON_WAGON_ID).grants!.recruit).toEqual(SELA_MEDIC);
  });

  // --- Node 4B — The Prison Wagon (`prison-wagon`, conversion 3) --------------

  it("the Wagon's body is served by the JSON file, not an inline const (the shadowing failure mode)", () => {
    injectContentNodes();
    expect(THE_HOLLOW_MILL.encounters?.[PRISON_WAGON_ID]).toBeUndefined();
    expect(getAuthoredNode(PRISON_WAGON_ID)).toBe(LEVELS[PRISON_WAGON_ID]);
    expect(resolveAuthored(THE_HOLLOW_MILL, PRISON_WAGON_ID)).toBe(LEVELS[PRISON_WAGON_ID]);
  });

  /**
   * The Wagon's authored design, pinned to the JSON: the **softened** elite escort (the captain
   * `overrides` are the whole point — an introduction to the tier, not the finale brawler) and the
   * gated recruit + flag that make the sustain arm worth taking (C8).
   */
  it("pins the Wagon's authored properties (dims, the softened captain, the Medic grant)", () => {
    const body = bodyOf(PRISON_WAGON_ID);
    expect(body.id).toBe("prison-wagon");
    expect(body.name).toBe("The Prison Wagon");
    expect([body.cols, body.rows]).toEqual([9, 6]);
    expect(body.enemies.map((e) => e.templateId)).toEqual(["bandit-captain", "bandit-cutthroat", "bandit-thug", "bandit-bowman"]);
    const lieutenant = body.enemies[0];
    expect(lieutenant.id).toBe("slaver-lieutenant");
    expect(lieutenant.role).toBe("captain");
    expect(lieutenant.overrides).toEqual({ maxHp: 34, attack: 10, defense: 3 }); // softened, not the finale warden
    expect(body.reward).toEqual({ gold: 120, materials: [{ id: "salve", count: 2 }], xp: 80 });
    // The gated recruit rides the body as a serialized UnitSpec; the flag gates map access.
    expect(body.grants?.flag).toBe("medic-freed");
    expect(body.grants?.recruit?.id).toBe("sela");
    expect(body.grants?.recruit?.jobId).toBe("medic");
    expect(body.captives).toBeUndefined();
    expect(body.objectives).toBeUndefined(); // plain eliminate-all
  });

  // --- L9 — The Cuffed Cell (`cuffed-cell`, conversion 4) ---------------------

  it("the Cell's body is served by the JSON file, not an inline const (the shadowing failure mode)", () => {
    injectContentNodes();
    expect(THE_HOLLOW_MILL.encounters?.[CUFFED_CELL_ID]).toBeUndefined();
    expect(getAuthoredNode(CUFFED_CELL_ID)).toBe(LEVELS[CUFFED_CELL_ID]);
    expect(resolveAuthored(THE_HOLLOW_MILL, CUFFED_CELL_ID)).toBe(LEVELS[CUFFED_CELL_ID]);
  });

  /**
   * The Cell's authored design, pinned to the JSON: the **lockpick-gated** captive (D90's whole
   * point — the `release.kind` that used to be a compiler-checked union and is now data), his
   * placement beside the corner guard, and the plain eliminate-all win (the freed body is a bonus,
   * never a win condition — no parked extraction, C1/C2).
   */
  it("pins the Cell's authored properties (dims, roster, the lockpick captive, reward)", () => {
    const body = bodyOf(CUFFED_CELL_ID);
    expect(body.id).toBe("cuffed-cell");
    expect(body.name).toBe("The Cuffed Cell");
    expect([body.cols, body.rows]).toEqual([8, 6]);
    expect(body.enemies.map((e) => e.templateId)).toEqual(["bandit-thug", "bandit-bowman", "bandit-cutthroat"]);
    expect(body.enemies[2].pos).toEqual({ col: 7, row: 0 }); // the cell guard, in the corner
    expect(body.captives).toHaveLength(1);
    const cell = body.captives![0];
    expect(cell.spec.id).toBe("cell-prisoner");
    expect(cell.spec.name).toBe("Bound Prisoner");
    expect(cell.pos).toEqual({ col: 7, row: 1 }); // beside the guard — pick and rescue, one corner
    expect(cell.release).toEqual({ kind: "lockpick" }); // Thief-only (D90)
    // A capable body, so an early pick is a real tempo swing rather than a trophy.
    expect(cell.spec.maxHp).toBe(30);
    expect(body.reward).toEqual({ gold: 80, materials: [{ id: "salve", count: 1 }], xp: 70 });
    expect(body.objectives).toBeUndefined(); // eliminate-all; the freed body is a bonus
  });

  /** The capability gate itself, on the shipped body: the starting trio cannot open the cell (C4). */
  it("the cell resists a non-Thief party — and the corner guard is the same affordance", () => {
    const body = bodyOf(CUFFED_CELL_ID);
    const run = createRunFromExpedition(THE_HOLLOW_MILL);
    const staged = stageEncounter(body, run.party);
    const prisoner = staged.battle.units.find((u) => u.id === "cell-prisoner")!;
    expect(prisoner.captured).toBe(true);
    const party = staged.battle.units.filter((u) => u.side === "player" && !u.captured);
    expect(party.length).toBeGreaterThan(0);
    for (const by of party) expect(canRelease(prisoner, by)).toBe(false);
  });

  // --- Node 3 — The Sapper's Snares (`snares-trapfield`, conversion 5) --------

  it("the Snares' body is served by the JSON file, not an inline const (the shadowing failure mode)", () => {
    injectContentNodes();
    expect(THE_HOLLOW_MILL.encounters?.[TRAP_FIELD_ID]).toBeUndefined();
    expect(getAuthoredNode(TRAP_FIELD_ID)).toBe(LEVELS[TRAP_FIELD_ID]);
    expect(resolveAuthored(THE_HOLLOW_MILL, TRAP_FIELD_ID)).toBe(LEVELS[TRAP_FIELD_ID]);
  });

  /**
   * **The body D122 called the one whose design IS its numbers.** The trap `damage` /
   * `concealment` values and the straggler's `overrides.standingOrder` left `tsc`'s reach when
   * this converted, so they are pinned by value here (and refused by `validateLevel` — M4/M6).
   */
  it("pins the Snares' authored properties (dims, the lone straggler, the five snares, rumors, reward)", () => {
    const body = bodyOf(TRAP_FIELD_ID);
    expect(body.id).toBe("snares-trapfield");
    expect(body.name).toBe("The Sapper's Snares");
    expect([body.cols, body.rows]).toEqual([9, 6]);
    // LOCKED at one relatively weak body — the strong field is the encounter.
    expect(body.enemies).toHaveLength(1);
    expect(body.enemies[0].templateId).toBe("bandit-thug");
    expect(body.enemies[0].id).toBe("lone-straggler");
    expect(body.enemies[0].pos).toEqual({ col: 8, row: 2 }); // his east-edge post — he bolts off-map
    // The D81 hold + D84 skittish flight ride ONE authored field; a typo here used to be silent.
    expect(body.enemies[0].overrides).toEqual({ standingOrder: "hold-skittish" });
    // Five strong, concealed, mid-field snares — exactly one at/below the D83 careless-mark cap.
    expect(body.traps).toEqual([
      { pos: { col: 3, row: 1 }, concealment: 4, damage: 22 },
      { pos: { col: 4, row: 2 }, concealment: 5, damage: 24 },
      { pos: { col: 4, row: 3 }, concealment: 5, damage: 24 },
      { pos: { col: 5, row: 1 }, concealment: 5, damage: 22 },
      { pos: { col: 5, row: 4 }, concealment: 6, damage: 26 },
    ]);
    expect(body.rumors).toHaveLength(3); // one line per intel tier (D83)
    expect(body.reward).toEqual({ gold: 70, materials: [{ id: "trap-kit", count: 1 }], xp: 70 });
  });

  /** Moved from `core/hollow-mill.test.ts` — it stages the Snares' body (D122). */
  it("the trap-field stages strong concealed snares + one weak enemy", () => {
    const body = bodyOf(TRAP_FIELD_ID);
    const run = createRunFromExpedition(THE_HOLLOW_MILL);
    const staged = stageEncounter(body, run.party);
    const traps = staged.battle.entities.all().filter(isConcealedTrap);
    expect(traps).toHaveLength(5);
    expect(traps.every((t) => t.owner === "enemy" && !t.revealed && !t.sprung)).toBe(true);
    // Exactly one enemy body — the strong field is the encounter.
    expect(body.enemies).toHaveLength(1);
  });

  // --- L7 — The Outer Yard (`outer-yard`, conversion 6) -----------------------

  it("the Yard's body is served by the JSON file, not an inline const (the shadowing failure mode)", () => {
    injectContentNodes();
    expect(THE_HOLLOW_MILL.encounters?.[OUTER_YARD_ID]).toBeUndefined();
    expect(getAuthoredNode(OUTER_YARD_ID)).toBe(LEVELS[OUTER_YARD_ID]);
    expect(resolveAuthored(THE_HOLLOW_MILL, OUTER_YARD_ID)).toBe(LEVELS[OUTER_YARD_ID]);
  });

  /**
   * The Yard's authored design, pinned to the JSON: the **alert** garrison (every body's raised
   * `overrides.awareness` is the "watched approach"), and the trap concealment that is the whole
   * intel beat — 5–6, **above** the D83 careless-mark cap, so a tier-3 read marks nothing.
   */
  it("pins the Yard's authored properties (dims, the alert garrison, the unmarkable snares, reward)", () => {
    const body = bodyOf(OUTER_YARD_ID);
    expect(body.id).toBe("outer-yard");
    expect(body.name).toBe("The Outer Yard");
    expect([body.cols, body.rows]).toEqual([9, 6]);
    expect(body.enemies.map((e) => e.templateId)).toEqual(["bandit-captain", "bandit-cutthroat", "bandit-thug"]);
    expect(body.enemies[0].id).toBe("yard-sergeant");
    expect(body.enemies[0].role).toBe("captain");
    expect(body.enemies[0].overrides).toEqual({ maxHp: 34, attack: 10, defense: 3, awareness: 6 }); // softened, but alert
    // The whole detail is alert — that is what "watched approach" means mechanically.
    expect(body.enemies.map((e) => e.overrides?.awareness)).toEqual([6, 5, 4]);
    expect(body.traps).toEqual([
      { pos: { col: 2, row: 2 }, concealment: 5, damage: 16 },
      { pos: { col: 3, row: 3 }, concealment: 6, damage: 18 },
      { pos: { col: 2, row: 4 }, concealment: 5, damage: 16 },
    ]);
    // Every dig is ABOVE the careless-mark cap — the read-resists-you beat, from numbers alone.
    expect(body.traps!.every((t) => (t.concealment ?? 0) > TRAP_INTEL.markConcealmentMax)).toBe(true);
    expect(body.rumors).toHaveLength(3);
    // reward.xp with the Den's clears the C3 pacing budget (see the pacing guard above).
    expect(body.reward).toEqual({ gold: 100, materials: [{ id: "salve", count: 1 }], xp: 100 });
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
      xpOf(E1_SKIRMISH_ID) + xpOf(TRAP_FIELD_ID) + xpOf(THIEVES_DEN_ID) + xpOf(OUTER_YARD_ID);
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

  // --- Node 1, the Cook rescue (moved from `core/hollow-mill.test.ts` with conversion 2) ------
  // Each of these *enters* `e1`, whose body is `content/levels/e1-skirmish.json`, so the walk
  // needs the catalog injected: `runEncounter` throws on an unresolvable `authoredId` rather
  // than silently fabricating a procedural fight. No assertion changed in the move.

  it("node 1 stages Pip as a bound on-board captive — NOT in the party yet (D52)", () => {
    const loop = freshLoop();
    loop.choose("e1");
    const battle = loop.startEncounter();
    loop.beginBattle();
    // Pip is a player-side, bound token on the board…
    const pip = battle.units.find((u) => u.id === "pip");
    expect(pip).toBeDefined();
    expect(pip!.side).toBe("player");
    expect(pip!.captured).toBe(true);
    expect(pip!.pos).toEqual({ col: 7, row: 1 }); // beside the corner cutthroat (col 7,row 0)
    // …but he is NOT a party member until freed/won, and not a fielded combatant.
    expect(loop.run.party.some((u) => u.id === "pip")).toBe(false);
    expect(loop.combatants.some((u) => u.id === "pip")).toBe(false);
  });

  it("node 1 recruits the Cook on the win — even if never reached (the captive-recruit guarantee)", () => {
    const loop = freshLoop();
    loop.choose("e1");
    loop.startEncounter();
    loop.beginBattle();
    forceWin(loop); // the captors fall; the player never walked to Pip
    const res = loop.resolve();
    expect(loop.run.party.some((u) => u.id === "pip")).toBe(true); // joined permanently
    expect(loop.run.party.find((u) => u.id === "pip")!.authored).toBe(true);
    expect(res.rescued).toContain("pip"); // surfaced in the resolution (freed by winning)
    // …and every surviving fighter reached primary-job L2 (the 2nd-active unlock) — the
    // freed Cook included: he banks the encounter's completion XP, joining leveled with the
    // party rather than at base, and his level-up surfaces in the resolution readout.
    for (const u of loop.run.party) {
      expect(jobLevelOf(u, u.primaryJob)).toBeGreaterThanOrEqual(2);
    }
    expect(res.levels.pip).toBeDefined();
  });

  it("freeing the captive mid-fight makes Pip controllable, and the win recruits him once (no double-add)", () => {
    const loop = freshLoop();
    loop.choose("e1");
    const battle = loop.startEncounter();
    loop.beginBattle();
    const pip = battle.units.find((u) => u.id === "pip")!;
    // The rescue mechanic: free the captive (what BattleScene.playerRescue calls).
    freeCaptive(pip);
    expect(pip.captured).toBe(false); // no longer bound → on the CT clock, controllable
    // A freed captive is now an active player unit the clock can hand a turn.
    battle.seed();
    const handed: string[] = [];
    for (let i = 0; i < 40 && handed.length < 8; i++) {
      const a = battle.nextActor();
      if (!a) break;
      if (a.side === "player") handed.push(a.id);
      a.ct = 0;
    }
    expect(handed).toContain("pip");
    // Win → recruited, exactly once (idempotent: the mid-fight free didn't pre-add him).
    forceWin(loop);
    loop.resolve();
    expect(loop.run.party.filter((u) => u.id === "pip")).toHaveLength(1);
  });

  it("L1 stays winnable raw without freeing Pip — a bound captive never fails/blocks the node", () => {
    const loop = freshLoop();
    loop.choose("e1");
    const battle = loop.startEncounter();
    loop.beginBattle();
    const pip = battle.units.find((u) => u.id === "pip")!;
    expect(pip.captured).toBe(true);
    // Kill only the enemies; Pip is left bound (the trio "wins raw"). The graded outcome
    // is a clean win — a captive is not an active player the win check counts, and not a
    // required objective, so it can neither downgrade the win nor wedge the encounter.
    for (const u of battle.units) if (u.side === "enemy") u.alive = false;
    const res = loop.resolve();
    expect(res.result).toBe("win");
    expect(loop.run.party.some((u) => u.id === "pip")).toBe(true); // still recruited on the win
  });

  it("WIPE: losing node 1 ends the run", () => {
    const loop = freshLoop();
    loop.choose("e1");
    loop.startEncounter();
    loop.beginBattle();
    for (const u of loop.combatants) u.alive = false; // the party falls
    const res = loop.resolve();
    expect(res.result).toBe("wipe");
    expect(loop.isOver()).toBe(true);
  });

  /**
   * Moved from `core/exfil.test.ts` (D122) — the **D21 regression pin** on the shipped node: an
   * eliminate-all win must still auto-rescue exactly as before D120 narrowed the clause.
   */
  it("the shipped Hollow Mill E1 is byte-identical: Pip joins leveled, with no rescue quest", () => {
    const loop = freshLoop();
    loop.choose("e1");
    loop.startEncounter();
    loop.beginBattle();
    forceWin(loop);

    const res = loop.resolve();
    expect(res.result).toBe("win");
    expect(res.rescued).toContain("pip");
    expect(res.levels.pip).toBeDefined(); // the completion-XP join (D52)
    expect(loop.run.party.some((u) => u.id === "pip")).toBe(true);
    expect(loop.run.rescueQuests).toEqual([]);
  });

  it("CLEAR via the sustain arm: the Wagon frees the Medic (+ Merchant at the pre-fork Market)", () => {
    const loop = freshLoop();
    // Route: e1 → camp2 → snares → market → wagon → restCamp → finale.
    const route = ["e1", "camp2", "snares", "market", "wagon", "restCamp", "finale"];
    const visited = drive(loop, forceWin, (ids) => ids.find((id) => route.includes(id)) ?? ids[0]);
    expect(visited).toContain("wagon");
    expect(loop.run.party.some((u) => u.id === "sela")).toBe(true); // Medic freed at the Wagon
    expect(loop.run.flags["medic-freed"]).toBe(true);
    expect(loop.run.party.some((u) => u.id === "mira")).toBe(true); // Merchant at the pre-fork Market
    expect(loop.isComplete()).toBe(true);
  });

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

/**
 * **The intel lanes read over the arc's bodies** — moved from `core/intel.test.ts` (D122).
 *
 * Every case here reads the Sapper's Snares' body (its five traps and three rumors) or the Outer
 * Yard's, directly or through `previewNode(run, "snares")`. Those bodies are content JSON now, so
 * the reads only resolve with the catalog injected. The *lane mechanics* (banding, depth caps,
 * the D10 ladder) stay pinned in `core/intel.test.ts` on its local fixtures — this is the
 * **content-side half**: that the shipped bodies' authored numbers produce the intended read.
 * No assertion changed in the move.
 */
describe("intel over the Hollow Mill's content-JSON bodies (D83/D85)", () => {
  beforeEach(() => {
    clearInjectedNodes();
    injectContentNodes();
  });

  const body = (id: string): AuthoredEncounter => {
    const enc = resolveAuthored(THE_HOLLOW_MILL, id);
    if (!enc) throw new Error(`no body for "${id}"`);
    return enc;
  };

  /** Copied with the block from `core/intel.test.ts` — a rumor-less, trap-less local fixture. */
  const AMBUSH: AuthoredEncounter = {
    id: "amb",
    name: "Ambush",
    cols: 8,
    rows: 6,
    blocked: [],
    playerSpawns: [{ col: 0, row: 0 }],
    enemies: [
      { templateId: "bandit-thug", pos: { col: 6, row: 2 } },
      { templateId: "bandit-cutthroat", pos: { col: 6, row: 4 }, hidden: true },
    ],
    reward: { gold: 50, materials: [] },
    objectives: [],
  };

  /** Copied with the block from `core/intel.test.ts`. */
  function member(id: string, intelligence = 0): Unit {
    return createUnit({
      id,
      side: "player",
      pos: { col: 0, row: 0 },
      intelligence,
      speed: 10,
      maxHp: 20,
      attack: 5,
      defense: 1,
      moveRange: 4,
      sightRadius: 5,
    });
  }

  it("the trap lane bands presence → count → careless marks, honestly gated", () => {
    const snares = body(TRAP_FIELD_ID);
    // Tier 0: nothing — a no-intel party walks in blind.
    expect(readEncounter(snares, 0).traps).toBeUndefined();
    // Tier 1: presence only.
    const t1 = readEncounter(snares, 1);
    expect(t1.traps).toEqual({ present: true });
    // Tier 2: the count.
    expect(readEncounter(snares, 2).traps).toEqual({ present: true, count: 5 });
    // Tier 3: the careless mark — ONLY concealment ≤ cap (one snare at 4), never the field.
    const t3 = readEncounter(snares, 3);
    expect(t3.traps).toEqual({ present: true, count: 5, marked: 1 });
  });

  it("the dug-in garrison resists the read — the Outer Yard's careful work marks NOTHING at tier 3", () => {
    const t3 = readEncounter(body(OUTER_YARD_ID), 3);
    expect(t3.traps).toEqual({ present: true, count: 3, marked: 0 });
  });

  it("the info lane unlocks one rumor line per tier; the total exposes the locked ???s", () => {
    const snares = body(TRAP_FIELD_ID);
    const t0 = readEncounter(snares, 0);
    expect(t0.notes).toEqual([]);
    expect(t0.notesTotal).toBe(3);
    expect(readEncounter(snares, 1).notes).toHaveLength(1);
    expect(readEncounter(snares, 1).notes?.[0]).toMatch(/Folk around here/);
    expect(readEncounter(snares, 3).notes).toHaveLength(3);
    // No rumors authored → no info box at all.
    expect(readEncounter(AMBUSH, 3).notes).toBeUndefined();
  });

  it("tier 3 stages the careless snare pre-revealed — and ONLY it (the ceiling holds)", () => {
    const party = [member("edrin"), member("vale", 9)]; // int 9 → tier-3 floor for the read
    const staged = stageEncounter(body(TRAP_FIELD_ID), party, { markTrapsUpTo: TRAP_INTEL.markConcealmentMax });
    const traps = staged.battle.entities.all().filter(isConcealedTrap);
    const revealed = traps.filter((t) => t.revealed);
    expect(traps).toHaveLength(5);
    expect(revealed).toHaveLength(1);
    expect(revealed[0]?.concealment).toBe(4); // the sloppy dig; the careful work keeps its secret
  });

  it("unscouted staging marks nothing", () => {
    const staged = stageEncounter(body(TRAP_FIELD_ID), [member("edrin")], {});
    expect(staged.battle.entities.all().filter(isConcealedTrap).every((t) => !t.revealed)).toBe(true);
  });

  // --- the fully-read terminal + authored-shape omission (D85) ---------------

  it("an authored node is flagged authored with no procedural type to reveal", () => {
    const run = createRunFromExpedition(THE_HOLLOW_MILL); // Vale int 7 → tier-2 floor
    const p = previewNode(run, "snares");
    expect(p.authored).toBe(true);
    expect(p.encounterKind).toBeUndefined(); // never a phantom `???` Type lane
  });

  it("intelComplete is false below MAX_TIER and true once read to the deepest tier", () => {
    const run = createRunFromExpedition(THE_HOLLOW_MILL);
    expect(previewNode(run, "snares", 0).intelComplete).toBe(false); // tier 2 floor
    expect(previewNode(run, "snares", 1).intelComplete).toBe(true); // +1 Survey → tier 3
  });

  it("at the terminal the info lane is fully revealed — no locked ??? remain", () => {
    const run = createRunFromExpedition(THE_HOLLOW_MILL);
    const done = previewNode(run, "snares", 1);
    expect(done.intel?.notes?.length).toBe(done.intel?.notesTotal); // every rumor read
  });

  it("a rest node carries no intel-complete signal (nothing to scout)", () => {
    const run = createRunFromExpedition(THE_HOLLOW_MILL);
    expect(previewNode(run, "start").intelComplete).toBeUndefined();
  });
});
