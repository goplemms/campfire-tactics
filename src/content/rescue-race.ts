/**
 * **The split-force extraction race** (finale crux **C2**, issue #209) — the scripted, headless,
 * deterministic proof that extraction is a win a player would *choose*, not a dead path.
 *
 * **Why this has to exist.** `npm run sim` cannot prove any of it: its naive bot skips the deploy
 * phase and every interactive screen, so it never splits the deploy, never slams a lever, never
 * drives an escort. Extraction is therefore invisible to every headless guard the repo already has.
 * This driver is the missing half — it *plays* the canonical solution the finale is authored around
 * (`finale-extraction-viability.md`) and reports what actually happened, turn by turn.
 *
 * **The model under test** (D118): `head-start ≥ pursuit-close-time`. The front party **pins**
 * garrison bodies (`in-combat` ⇒ they stop driving and fight), the infiltrator **slams a lever-seal**
 * for a head start, the garrison **breaks through — designed in, not a failure** — and the escort
 * **outruns the thinned pursuit through a chokepointed corridor**.
 *
 * **Fidelity — what is real here and what is modelled.**
 *  - **Real:** the authored board, gates, levers and objectives (`the-rescue.json` via `stageEncounter`);
 *    the shipped garrison AI (`runPolicyTurn` — the D117 door-drive, the `in-combat` gate,
 *    control-room targeting); the real CT clock, so a `speed 13` cutthroat genuinely acts more often
 *    than a `speed 9` prisoner (a round-based loop would quietly understate the pursuit); real damage,
 *    real lockpicking, real captive release, and the real `callExfil` / `encounterOutcome` grading.
 *  - **Modelled:** the *outcome* of the deploy phase (bodies placed at the two mouths) rather than its
 *    verbs. D119's split-deploy allocation and its rendered surface are guarded separately, by
 *    `test:e2e:rescue` — repeating them here would prove placement, not pacing.
 *  - **Modelled:** the player's *skill*. The scripted side plays a competent, legible plan through the
 *    same `planMove`/`planAttack` planners the real scenes drive — not an optimal one. The bar it
 *    measures is therefore a floor: a better player does better than this report.
 *
 * The three {@link RescueRaceOpts} mutation knobs exist so the pacing bar can be proven
 * **non-vacuous** (#209: halving `sealHp`, removing the distraction pin, and widening the corridor
 * past its chokepoint must each flip it red, or the guard measures nothing).
 *
 * Pure logic — no Phaser, no DOM, no `Math.random`. Lives in `content/` rather than `core/` because it
 * drives a specific authored level (core must not import content).
 */

import {
  stageEncounter,
  planMove,
  planAttack,
  findPath,
  manhattan,
  onExfilSite,
  exfilObjective,
  exfilStandings,
  canCallExfil,
  callExfil,
  encounterOutcome,
  heldTheField,
  hasTag,
  GARRISON,
  IN_COMBAT,
  orthoNeighbors,
  canLockpickGate,
  unitHasCapability,
  enumeratePaths,
  traverseRoute,
  activeParty,
  jobLevelOf,
  grantJobXp,
  prestige,
  THE_HOLLOW_MILL,
  type Unit,
  type Gate,
  type GridCoord,
  type EncounterResult,
  type StagedEncounter,
} from "../core";
import { SCOUT_PRESTIGE_FLOOR } from "../core/jobs-data/scout-line";
import { getLevel } from "./levels";

/**
 * **The declared reference party** (#209 — the owner's note asks the pacing bar be written against
 * one, and re-confirmed at arc promotion #210).
 *
 * Built from the arc's **own arrival state** rather than hand-authored stats, so it re-derives when
 * arc balance moves: walk the Hollow Mill's **infiltration arm** (the route through `cuffedCell` —
 * the only arm that earns the side-door intel) and take the party as it actually arrives at the
 * finale, levels, wounds, recruits and all.
 *
 * ⚠️ **Then one deliberate correction, and it is the finding this helper exists to expose.** The arc
 * has **no Thief in its cast** — the Thief is a *prestige* of the Scout, granted by the
 * `thieves-guild-rite` story and gated on `jobLevel scout ≥ SCOUT_PRESTIGE_FLOOR` (5). The sim's
 * canonical playthrough arrives with the Scout at **job level 1**, so the rite **declines** (D92's
 * "gracious decline") and the party reaching the finale holds **no lockpick capability at all** —
 * which means no cell can be picked and **extraction is not merely unpinned, it is unreachable**.
 * So this helper takes the Scout to the floor and through the rite using the shipped verbs
 * (`grantJobXp` → `prestige`), modelling the player who levelled their Scout and took the trade.
 * That is the branch extraction requires; measuring the race against a party that cannot pick a lock
 * would prove nothing.
 */
export function referenceParty(): Unit[] {
  const arm = enumeratePaths(THE_HOLLOW_MILL.map, "finale").find((r) => r.includes("cuffedCell"));
  if (!arm) throw new Error("referenceParty: the Hollow Mill has no route to the finale via cuffedCell");
  const party = activeParty(traverseRoute(THE_HOLLOW_MILL, arm).run);

  // Take the Scout through the rite — the conditional branch that makes a Thief.
  const scout = party.find((u) => u.heldJobs.includes("scout"));
  if (!scout) throw new Error("referenceParty: the arc's arrival party holds no Scout to prestige");
  for (let guard = 0; guard < 100 && jobLevelOf(scout, "scout") < SCOUT_PRESTIGE_FLOOR; guard += 1) {
    grantJobXp(scout, "scout", 100);
  }
  const res = prestige(scout, "scout", "thief");
  if (!res.ok) throw new Error("referenceParty: the scout→thief prestige was refused");
  return party;
}

/** Knobs for {@link runRescueRace} — the three mutations are the pacing bar's non-vacuity proof. */
export interface RescueRaceOpts {
  /** The party that reaches the finale (see `referenceParty`). Copied — never mutated in place. */
  party: readonly Unit[];
  /**
   * **MUTATION** — override `seal-inner`'s durability. The head start is `sealHp / batterThroughput`,
   * so halving this must break the bar (#209). Default: as authored (64).
   */
  sealHp?: number;
  /**
   * **MUTATION** — whether the front party engages the garrison at all. `false` removes the
   * distraction pin: nothing is `in-combat`, so the whole garrison drives the seal and then pursues.
   * Default `true`.
   */
  pin?: boolean;
  /**
   * **MUTATION** — open a second doorway beside the east-leg chokepoint at `(14,5)`, so the escort
   * route no longer runs a cut vertex and the pursuit can flow around the rearguard. Default `false`.
   */
  widenChoke?: boolean;
  /** Safety cap on actor turns, so a stalled script fails loudly instead of hanging. */
  turnCap?: number;
}

/** What the race actually did — a tuning readout first, an assertion surface second. */
export interface RescueRaceReport {
  /** The graded result: the auto-resolve outcome, or the "Go now" grade if the escort called it. */
  result?: EncounterResult;
  /** Actor turns consumed (CT-clock turns across both sides). */
  turns: number;
  /** The actor turn on which `seal-inner` was battered open (undefined = it held all race). */
  sealBreachTurn?: number;
  /** The actor turn each captive was freed, by id. */
  freedOn: Record<string, number>;
  /** Cohort members standing on a mouth at the end — they come home. */
  extracted: string[];
  /** Cohort members still inside at the end — they do not. */
  leftBehind: string[];
  /** Garrison bodies still standing / authored — an extraction win must leave some. */
  garrisonAlive: number;
  garrisonTotal: number;
  /** Party members who went down during the race. */
  partyDown: string[];
  /** Whether the field was held at the end (i.e. this was eliminate-all in disguise). */
  fieldHeld: boolean;
  /** A readable turn-by-turn trace — the reason a red bar is diagnosable rather than just red. */
  trace: string[];
}

// --- The authored geometry the script keys off (asserted by `levels.test.ts`) ---
const WINCH_WALL = "winch-wall"; // the side-door lever → slams `seal-inner`
const SEAL_INNER = "seal-inner";
const HALL_GATE = "hall-gate"; // lockpick door between the control room and the cellblock
const CHOKE_EAST: GridCoord = { col: 14, row: 5 }; // the east leg's cut vertex (B6c)
const WIDEN_TILE: GridCoord = { col: 14, row: 6 }; // the wall the `widenChoke` mutation removes
const SIDE_SPAWN: GridCoord = { col: 18, row: 5 };
const FRONT_TILES: GridCoord[] = [
  { col: 9, row: 18 },
  { col: 8, row: 18 },
  { col: 10, row: 18 },
  { col: 11, row: 18 },
  { col: 9, row: 17 },
];

const isPrisoner = (u: Unit): boolean => u.role === "prisoner";
const standing = (u: Unit): boolean => u.alive && !u.captured;
const gateOf = (staged: StagedEncounter, id: string): Gate =>
  staged.battle.gates.find((g) => g.id === id)!;

/** Mouth tiles from the authored extraction span — every mouth counts (D118 G5). */
function mouths(staged: StagedEncounter): GridCoord[] {
  return [...(exfilObjective(staged)?.spec.span ?? [])];
}

/** The mouth a unit should run for: the reachable one with the shortest walk. */
function nearestMouth(staged: StagedEncounter, u: Unit): GridCoord | undefined {
  let best: GridCoord | undefined;
  let bestLen = Infinity;
  for (const m of mouths(staged)) {
    const path = findPath(staged.battle.grid, u.pos, m);
    if (path && path.length < bestLen) {
      bestLen = path.length;
      best = m;
    }
  }
  // Unreachable (a slammed seal between us and every door) — fall back to the closest as the crow
  // flies so the unit still walks *toward* a door rather than standing still.
  return best ?? [...mouths(staged)].sort((a, b) => manhattan(u.pos, a) - manhattan(u.pos, b))[0];
}

/**
 * A free, walkable tile orthogonally beside `target` — where a unit has to stand to rescue or pick.
 * Walking *onto* a body is illegal (D55: bodies are passable, never stoppable), so scripting a walk to
 * `target.pos` strands the actor one tile short forever. This is that fix.
 */
function tileBeside(staged: StagedEncounter, target: GridCoord, mover: Unit): GridCoord | undefined {
  const taken = new Set(
    staged.battle.units.filter((u) => u.alive && u !== mover).map((u) => `${u.pos.col},${u.pos.row}`),
  );
  return orthoNeighbors(target).find(
    (t) => staged.battle.grid.inBounds(t) && staged.battle.grid.isWalkable(t) && !taken.has(`${t.col},${t.row}`),
  );
}

/** Is this garrison body currently pinned (`in-combat`, so it fights instead of driving)? */
function isPinned(staged: StagedEncounter, u: Unit): boolean {
  return hasTag(u, IN_COMBAT, staged.battle.tagContext());
}

/** Walk `unit` as far toward `dest` as this turn allows. Returns whether it moved. */
function walkToward(staged: StagedEncounter, unit: Unit, dest: GridCoord): boolean {
  const steps = planMove(unit, dest, staged.battle.units, staged.battle.grid);
  if (!steps) return false;
  staged.battle.moveUnit(unit, steps);
  return true;
}

/** Strike `foe` this turn, closing first if needed. Returns whether a blow landed. */
function strike(staged: StagedEncounter, unit: Unit, foe: Unit): boolean {
  const plan = planAttack(unit, foe, staged.battle.units, staged.battle.grid);
  if (!plan) return false;
  if (plan.path.length > 0) staged.battle.moveUnit(unit, plan.path);
  if (!plan.attackTarget) return false;
  return staged.battle.attack(unit, plan.attackTarget) > 0;
}

/**
 * The nearest standing garrison body to `unit`, by real walking distance. With `unpinnedOnly`, skips
 * bodies already `in-combat` — which is what makes the front party **pin a slice** rather than focus
 * one body down. Pinning costs bodies and cannot cover the whole garrison; that is D117's tension, and
 * a script that always hit the nearest foe would quietly turn the distraction into eliminate-all.
 */
function nearestGarrison(staged: StagedEncounter, unit: Unit, unpinnedOnly = false): Unit | undefined {
  const foes = staged.battle.units.filter(
    (u) => u.side === "enemy" && standing(u) && (!unpinnedOnly || !isPinned(staged, u)),
  );
  let best: Unit | undefined;
  let bestLen = Infinity;
  for (const f of foes) {
    const path = findPath(staged.battle.grid, unit.pos, f.pos);
    const len = path ? path.length : Infinity;
    if (len < bestLen) {
      bestLen = len;
      best = f;
    }
  }
  return best;
}

/**
 * The infiltrator's plan, as a phase machine — the canonical solution in order:
 * slam the seal → pick into the cellblock → free each prisoner → rearguard the choke → run.
 */
function infiltratorTurn(staged: StagedEncounter, unit: Unit, trace: (s: string) => void): void {
  const { battle } = staged;
  const seal = gateOf(staged, SEAL_INNER);
  const lever = battle.levers.find((l) => l.id === WINCH_WALL)!;

  // 1. Slam the seal — the head start. (Adjacent or on the tile pulls it.)
  if (!seal.locked && !seal.broken) {
    if (manhattan(unit.pos, lever.pos) <= 1) {
      battle.pullLever(lever, unit);
      trace(`infiltrator slams ${WINCH_WALL} → ${SEAL_INNER} shut`);
      return;
    }
    if (walkToward(staged, unit, lever.pos)) return;
  }

  // 2. Pick the hall gate — the only way from the control room into the cellblock.
  const hall = gateOf(staged, HALL_GATE);
  if (hall.locked) {
    if (canLockpickGate(hall, unit)) {
      battle.openGate(hall, unit);
      trace(`infiltrator picks ${HALL_GATE}`);
      return;
    }
    if (walkToward(staged, unit, { col: hall.pos.col + 1, row: hall.pos.row })) return;
  }

  // 3. Free the prisoners — nearest cell first.
  const bound = battle.units
    .filter((u) => isPrisoner(u) && u.captured && u.alive)
    .sort((a, b) => manhattan(unit.pos, a.pos) - manhattan(unit.pos, b.pos));
  if (bound.length > 0) {
    const target = bound[0];
    // The cell door in front of that prisoner (a lockpick gate on its column).
    const cell = battle.gates.find((g) => g.locked && g.id.startsWith("cell-") && g.pos.col === target.pos.col);
    if (cell) {
      if (canLockpickGate(cell, unit)) {
        battle.openGate(cell, unit);
        trace(`infiltrator picks ${cell.id}`);
        return;
      }
      if (walkToward(staged, unit, { col: cell.pos.col, row: cell.pos.row + 1 })) return;
    }
    if (manhattan(unit.pos, target.pos) <= 1) {
      battle.rescue(target, unit);
      trace(`infiltrator frees ${target.id}`);
      return;
    }
    const beside = tileBeside(staged, target.pos, unit);
    if (beside && walkToward(staged, unit, beside)) return;
  }

  // 4. Rearguard: hold the choke while anyone is still crossing, striking what closes on us.
  // A **bound** prisoner counts as crossing — it is the whole reason we are here. (Reading only
  // `standing()` bodies is what made an earlier draft of this script abandon the cells and walk out.)
  const spec = exfilObjective(staged)!.spec;
  const stillCrossing = battle.units.some(
    (u) => isPrisoner(u) && u.alive && (u.captured || !onExfilSite(u, spec)),
  );
  if (stillCrossing) {
    const foe = nearestGarrison(staged, unit);
    if (foe && manhattan(unit.pos, foe.pos) <= unit.attackRange + unit.moveRange) {
      if (strike(staged, unit, foe)) {
        trace(`rearguard strikes ${foe.id}`);
        return;
      }
    }
    if (manhattan(unit.pos, CHOKE_EAST) > 1 && walkToward(staged, unit, CHOKE_EAST)) return;
    return;
  }

  // 5. Everyone is out but us — run for a door.
  const mouth = nearestMouth(staged, unit);
  if (mouth && !onExfilSite(unit, exfilObjective(staged)!.spec)) walkToward(staged, unit, mouth);
}

/** A freed prisoner never fights (`non-combatant`) — it runs for the nearest door. */
function prisonerTurn(staged: StagedEncounter, unit: Unit): void {
  if (onExfilSite(unit, exfilObjective(staged)!.spec)) return;
  const mouth = nearestMouth(staged, unit);
  if (mouth) walkToward(staged, unit, mouth);
}

/**
 * The front party: pin the garrison while the prisoners are still cuffed (every pinned body is one
 * fewer chasing the escort — D118's *thinned* pursuit), then fall back out the main entrance, which
 * is what makes "everyone gets out" realistic (D118 G5).
 */
function frontTurn(staged: StagedEncounter, unit: Unit, pin: boolean, trace: (s: string) => void): void {
  const { battle } = staged;
  const spec = exfilObjective(staged)!.spec;
  const anyCuffed = battle.units.some((u) => isPrisoner(u) && u.captured && u.alive);

  if (pin && anyCuffed) {
    // Pin an UNPINNED body — spreading the distraction instead of focusing one down.
    const foe = nearestGarrison(staged, unit, true);
    if (foe) {
      if (strike(staged, unit, foe)) {
        trace(`${unit.id} pins ${foe.id}`);
        return;
      }
      if (walkToward(staged, unit, foe.pos)) return;
    }
    // Everything in reach is already pinned — hold the line rather than farming kills. Standing
    // still is what keeps the distraction a *distraction* and the win an *extraction*.
    return;
  }

  // Falling back (or never pinning at all): stand on a mouth and stay there.
  if (onExfilSite(unit, spec)) {
    // Already home — but keep swinging at anything that followed us to the door.
    if (pin) {
      const foe = nearestGarrison(staged, unit);
      if (foe && manhattan(unit.pos, foe.pos) <= unit.attackRange) staged.battle.attack(unit, foe);
    }
    return;
  }
  const mouth = nearestMouth(staged, unit);
  if (mouth) walkToward(staged, unit, mouth);
}

/**
 * Play the split-force extraction race headlessly and report what happened.
 *
 * The party is placed as the deploy phase would leave it under D119: **one** body (the lockpick-capable
 * infiltrator) at the side door, everyone else at the front gate. Then the CT clock runs: player
 * actors follow the scripted plan above, garrison actors are planned by the shipped AI, until the
 * encounter grades itself or the turn cap trips.
 */
export function runRescueRace(opts: RescueRaceOpts): RescueRaceReport {
  const level = getLevel("the-rescue")!;
  const roster = opts.party.map((u) => ({ ...u, pos: { ...u.pos } }) as Unit);
  const staged = stageEncounter(level, roster);
  const { battle } = staged;
  const trace: string[] = [];
  let turns = 0;
  const log = (s: string): void => void trace.push(`t${turns}: ${s}`);

  // --- Place the split deploy (D119's outcome, not its verbs) -----------------
  const players = battle.units.filter((u) => u.side === "player" && !isPrisoner(u));
  // The infiltrator is whoever can actually work the locks — a capability, never a jobId (D54/D72).
  // Without one the side door is pointless, so this fails loud rather than sending a body that can do
  // nothing when it arrives.
  const infiltrator = players.find((u) => unitHasCapability(u, "lockpick"));
  if (!infiltrator) throw new Error("runRescueRace: the party has no lockpick-capable body to infiltrate with");
  infiltrator.pos = { ...SIDE_SPAWN };
  let slot = 0;
  for (const u of players) {
    if (u === infiltrator) continue;
    u.pos = { ...FRONT_TILES[Math.min(slot, FRONT_TILES.length - 1)] };
    slot += 1;
  }

  // --- Apply the mutations ---------------------------------------------------
  const seal = gateOf(staged, SEAL_INNER);
  if (opts.sealHp !== undefined) {
    seal.hp = opts.sealHp;
    seal.maxHp = opts.sealHp;
  }
  if (opts.widenChoke) battle.grid.setWalkable(WIDEN_TILE, true);
  const pin = opts.pin ?? true;
  const turnCap = opts.turnCap ?? 400;

  // --- Run the clock --------------------------------------------------------
  let sealBreachTurn: number | undefined;
  const freedOn: Record<string, number> = {};
  const wasFreed = new Set<string>();
  battle.seed();

  while (turns < turnCap) {
    if (encounterOutcome(staged)) break;
    const actor = battle.nextActor();
    if (!actor) break;
    turns += 1;

    if (actor.side === "enemy") {
      battle.runPolicyTurn(actor);
    } else {
      const before = { ...actor.pos };
      if (isPrisoner(actor)) prisonerTurn(staged, actor);
      else if (actor === infiltrator) infiltratorTurn(staged, actor, log);
      else frontTurn(staged, actor, pin, log);
      const moved = actor.pos.col !== before.col || actor.pos.row !== before.row;
      battle.endTurn(actor, { moved, acted: true });
    }

    // Observations worth a trace line.
    if (sealBreachTurn === undefined && (seal.broken || (!seal.locked && seal.hp === 0))) {
      sealBreachTurn = turns;
      log(`${SEAL_INNER} BREACHED`);
    }
    for (const p of battle.units) {
      if (isPrisoner(p) && !p.captured && !wasFreed.has(p.id)) {
        wasFreed.add(p.id);
        freedOn[p.id] = turns;
      }
    }
  }

  // --- Grade ----------------------------------------------------------------
  // The escort calls "Go now" only if the encounter never resolved on its own — the honest read of a
  // race that ran out of road, and the same control the player has (D120).
  let result = encounterOutcome(staged);
  if (!result && canCallExfil(staged)) {
    const call = callExfil(staged);
    result = call?.result;
    log(`Go now → ${result}`);
  }
  const standings = exfilStandings(staged);
  const garrison = battle.units.filter((u) => u.side === "enemy");

  return {
    result,
    turns,
    sealBreachTurn,
    freedOn,
    extracted: standings.out.map((u) => u.id).sort(),
    leftBehind: standings.leftBehind.map((u) => u.id).sort(),
    garrisonAlive: garrison.filter((u) => hasTag(u, GARRISON) && standing(u)).length,
    garrisonTotal: garrison.length,
    partyDown: battle.units.filter((u) => u.side === "player" && !u.alive).map((u) => u.id).sort(),
    fieldHeld: heldTheField(battle.units),
    trace,
  };
}
