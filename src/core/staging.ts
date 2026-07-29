/**
 * Encounter staging (D50) — the one seam that converges the authored and
 * procedural combat stacks.
 *
 * A node resolves to an {@link EncounterSource}: a procedural {@link EncounterDef}
 * (off a seed, {@link "./generation"}) or a hand-authored {@link AuthoredEncounter}
 * ({@link "./authored"}). {@link stageEncounter} turns *either* into one shape —
 * `{ battle, objectives }` — the renderer and the run loop consume uniformly. The
 * enemy-representation difference (specs vs placements) and the player-placement
 * policy (explicit spawns vs the auto home edge) are hidden behind this function.
 *
 * {@link encounterOutcome} is the single graded classifier (D50/D51/D97): `wipe →
 * any required *constraint* failed → (all required constraints met AND any required
 * *goal* met) = win`. Goals are **OR'd** (any one wins), constraints AND'd (D97/C2).
 *
 * Pure logic: no Phaser, no DOM, no `Math.random`.
 */

import type { GridCoord, Region } from "./iso";
import { isActive, type Unit } from "./units";
import { TileGrid } from "./grid";
import { Battle } from "./turn";
import { makeConcealedTrap } from "./entities";
import { buildGrid, buildEnemies, type EncounterDef } from "./generation";
import {
  buildAuthoredGrid,
  buildAuthoredEnemies,
  buildAuthoredCaptives,
  buildAuthoredGates,
  buildAuthoredLevers,
  buildSpawnZones,
  placeParty,
  placeInZone,
  type AuthoredEncounter,
  type EncounterResult,
} from "./authored";
import { primaryZone, type SpawnZone } from "./deployment";
import type { Gate, Lever } from "./gates";
import {
  armObjectives,
  withDefaultGoal,
  isGoalKind,
  onExfilSite,
  type ArmedObjective,
} from "./objectives";

/** A node's encounter is either procedural or hand-authored (D49/D50). */
export type EncounterSource = EncounterDef | AuthoredEncounter;

/** Discriminate the union: an authored encounter carries explicit player spawns. */
export function isAuthoredEncounter(source: EncounterSource): source is AuthoredEncounter {
  return "playerSpawns" in source;
}

/** A staged encounter ready to play — one shape for both sources (D50). */
export interface StagedEncounter {
  battle: Battle;
  /** The armed objectives (incl. the default elimination goal when none authored). */
  objectives: ArmedObjective[];
  /** The source the staging came from (rewards/records read it). */
  source: EncounterSource;
  /**
   * Set once by {@link callExfil} — the player called **"Go now"** (D120). It makes the call
   * *sticky*: with the captives out the extraction goal now reads `met` on its own, but with
   * them still inside nothing else would ever decide the encounter, so this is what grades the
   * deliberate withdrawal as a **survivable retreat** instead of leaving it undecided.
   */
  exfilCalled?: boolean;
}

/** Options for {@link stageEncounter}. */
export interface StageOptions {
  /**
   * The D9 rescue "ambush-in-reverse" modifier — shrinks the player's usable home
   * columns on the **auto-edge** (procedural) placement. Ignored for authored
   * spawns (fixed by design).
   */
  deploymentPenalty?: number;
  /** Override the player spawn tiles (else authored uses its own; procedural auto-edges). */
  playerSpawns?: GridCoord[];
  /**
   * Reveal hidden ambush bodies (D10/D44): when the run scouted the node to full
   * positional intel, the hidden-until-scouted enemies start the fight **visible**
   * — the ambush is blown, no surprise. Authored sources only.
   */
  revealHidden?: boolean;
  /**
   * Mark the **careless trap-work** (D83): concealed traps with concealment at/below
   * this cap stage **already-revealed** — the tier-3 trap-lane read. The well-hidden
   * work keeps its secret (intel *informs*; Awareness *resolves*). Undefined = none.
   */
  markTrapsUpTo?: number;
  /**
   * The run seed for this encounter's RNG (D67): wired onto the {@link Battle} so it
   * owns the one seed the whole encounter draws from — combat's variance rolls
   * ({@link Battle.roll}) and deployment's label-keyed streams ({@link Battle.stream}:
   * the front-capture + trap-spot draws) all derive from it. Defaults to the
   * deterministic `0` floor when unset (a bare staged battle / test).
   */
  seed?: string | number;
  /**
   * The run's **flags** (D52/D119) — read only to gate {@link AuthoredEncounter.spawnZones}:
   * a zone declaring `requiresFlag` is unioned in only when that flag is set (`side-door-intel`
   * opens the finale's side entrance). Omitted ⇒ `{}` ⇒ every gated zone is dropped, which is
   * the graceful-degradation path, not an error. Nothing else in staging reads it.
   */
  flags?: Record<string, boolean>;
}

/** Reset a unit's combat-scoped transient state for a fresh encounter. */
function resetForBattle(u: Unit): void {
  u.ct = 0;
  u.statuses = [];
  u.captured = false;
  u.dugIn = false;
}

/**
 * Place player combatants on the home (left) edge, auto-filling walkable tiles —
 * the procedural placement policy (extracted from the old `RunLoop.placePlayers`).
 * `deploymentPenalty` pushes the home edge inward (fewer setup columns).
 */
export function placePlayersAutoEdge(
  players: readonly Unit[],
  grid: TileGrid,
  blocked: readonly GridCoord[],
  rows: number,
  deploymentPenalty = 0,
): void {
  const homeCols = Math.max(1, 2 - Math.min(1, deploymentPenalty));
  const taken = new Set<string>();
  for (const b of blocked) taken.add(`${b.col},${b.row}`);
  players.forEach((u, i) => {
    let pos: GridCoord = { col: i % homeCols, row: i % rows };
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < homeCols; col++) {
        const key = `${col},${row}`;
        if (!taken.has(key) && grid.isWalkable({ col, row })) {
          pos = { col, row };
          taken.add(key);
          row = rows;
          break;
        }
      }
    }
    taken.add(`${pos.col},${pos.row}`);
    u.pos = pos;
  });
}

/**
 * Stage an encounter from either source into one `{ battle, objectives }` shape
 * (D50). Authored ⇒ fixed grid + hand-placed enemies + explicit player spawns +
 * authored objectives; procedural ⇒ generated grid/enemies + auto-edge placement
 * + the default elimination goal only. The default goal is injected when no
 * explicit goal is listed.
 */
export function stageEncounter(
  source: EncounterSource,
  roster: readonly Unit[],
  opts: StageOptions = {},
): StagedEncounter {
  const players = [...roster];
  for (const u of players) resetForBattle(u);

  let grid: TileGrid;
  let enemies: Unit[];
  // On-board captive recruits (D52): bound, player-side units the player frees mid-fight or
  // by winning. Built **outside** `players` so the roster `resetForBattle` (which clears
  // `captured`) never touches them — a captive stays bound on entry. Authored sources only.
  let captives: Unit[] = [];
  // Interactable gates + levers (D103) — authored sources only. Handed to the Battle, which blocks each
  // locked gate's tile, opens keyholder cells on the keyholder's death, and toggles gates on a lever pull.
  let gates: Gate[] = [];
  let levers: Lever[] = [];
  let controlRoom: Region | undefined;
  let spawnZones: SpawnZone[] = [];
  let objectiveSpecs;

  if (isAuthoredEncounter(source)) {
    grid = buildAuthoredGrid(source);
    enemies = buildAuthoredEnemies(source);
    captives = buildAuthoredCaptives(source);
    gates = buildAuthoredGates(source);
    levers = buildAuthoredLevers(source);
    controlRoom = source.controlRoom; // D117/M3b: the garrison's target-priority span (authored only)
    // Scouted-to-full intel blows the ambush: hidden bodies start visible (D10).
    if (opts.revealHidden) for (const e of enemies) e.hidden = false;
    // D119 — authored spawn zones: when the encounter declares them, the zones own placement.
    // Everyone starts in the **primary** zone with the others EMPTY (the roster-order index-map
    // that stranded a Soldier at the finale's side door is exactly what this replaces); an
    // explicit `playerSpawns` override still wins, so the scenario/level harnesses are unchanged.
    spawnZones = buildSpawnZones(source, opts.flags);
    const primary = spawnZones.length > 0 ? primaryZone(spawnZones) : undefined;
    if (primary && !opts.playerSpawns) placeInZone(players, primary);
    else placeParty(players, opts.playerSpawns ?? source.playerSpawns);
    objectiveSpecs = withDefaultGoal(source.objectives);
  } else {
    grid = buildGrid(source);
    enemies = buildEnemies(source);
    if (opts.playerSpawns) placeParty(players, opts.playerSpawns);
    else placePlayersAutoEdge(players, grid, source.blocked, source.rows, opts.deploymentPenalty);
    objectiveSpecs = withDefaultGoal();
  }

  // Captives ride between the roster and the enemies: player-side and bound, so they're off
  // the clock (the `isActive` participant predicate excludes captured), never an AI target
  // (`activeUnits` foe-lists skip them), and visible in deployment (only enemies are veiled).
  const battle = new Battle(grid, [...players, ...captives, ...enemies], { seed: opts.seed, gates, levers, controlRoom, spawnZones });

  // Pre-place the authored concealed enemy traps (the trap-field lever, D12): they
  // ride the same entity registry the player's Set Trap uses, so movement springs
  // them and the Survivalist can disarm them — no special case in the loop (D4).
  if (isAuthoredEncounter(source) && source.traps) {
    source.traps.forEach((t) => {
      const trap = makeConcealedTrap(t.id ?? `enemy-trap@${t.pos.col},${t.pos.row}`, t.pos, "enemy", t.damage ?? 12, t.concealment ?? 4);
      // The tier-3 careless mark (D83): sloppy work stages pre-revealed.
      if (opts.markTrapsUpTo !== undefined && trap.concealment <= opts.markTrapsUpTo) trap.revealed = true;
      battle.entities.register(trap);
    });
  }

  const objectives = armObjectives(battle.clock, battle.units, objectiveSpecs);
  return { battle, objectives, source };
}

/**
 * Grade a staged encounter (D50/D51/D97). **Wipe** if no combat-capable player
 * remains; else **objective-failure** if any *required constraint* failed; else
 * **win** once every required constraint is met **and any required *goal* is met**.
 *
 * Required objectives split into **goals** ({@link isGoalKind} — `eliminate-all` /
 * `extraction`, the win-paths) and **constraints** (`closing-gate`, must-not-fail).
 * Goals are **OR'd** — achieving any one wins (the finale's frontal-vs-extraction
 * either/or, C2); constraints are AND'd. A goal never *fails* (an unmet goal is just
 * pending), so an abandoned extraction leaves the frontal path open. Optional
 * objectives never downgrade a win. Returns `undefined` while still undecided (the
 * failure poll calls this each checkpoint and finishes when it resolves).
 */
export function encounterOutcome(staged: StagedEncounter): EncounterResult | undefined {
  const playersStanding = staged.battle.units.some(
    (u) => u.side === "player" && u.alive && !u.captured,
  );
  if (!playersStanding) return "wipe";
  const required = staged.objectives.filter((o) => o.spec.required);
  const goals = required.filter((o) => isGoalKind(o.spec.kind));
  const constraints = required.filter((o) => !isGoalKind(o.spec.kind));
  if (constraints.some((o) => o.status() === "failed")) return "objective-failure";
  const constraintsMet = constraints.every((o) => o.status() === "met");
  // No required goal (constraint-only encounter) ⇒ constraints alone decide (legacy shape).
  const goalMet = goals.length === 0 || goals.some((o) => o.status() === "met");
  if (constraintsMet && goalMet) return "win";
  // The player called "Go now" and no goal landed (D120) — a *deliberate* withdrawal, graded as
  // the existing survivable retreat rather than a fourth outcome. Checked last so a call that
  // does complete the extraction still reads as the win it is.
  if (staged.exfilCalled) return "objective-failure";
  return undefined;
}

// --- Exfil: the "Go now" call (D120) ----------------------------------------

/**
 * **Field control** (D21) — no *active* enemy remains ({@link isActive}: alive, uncaptured,
 * not fled). The clause that decides whether a win auto-frees everyone the enemy is holding.
 *
 * This is exactly the predicate `eliminate-all` resolves on ({@link "./combat".battleOutcome}
 * reads the same {@link isActive} over the enemy side), which is *why* narrowing D21's auto-free
 * to field control leaves every elimination win byte-identical: an eliminate-all win holds the
 * field by construction. The only wins that can lack it are **extraction** wins — a flight, not
 * a field hold, where the garrison is still standing between you and whoever you left.
 */
export function heldTheField(units: readonly Unit[]): boolean {
  return !units.some((u) => u.side === "enemy" && isActive(u));
}

/** The encounter's required `extraction` goal — the exfil objective, if it has one (D97/D120). */
export function exfilObjective(staged: StagedEncounter): ArmedObjective | undefined {
  return staged.objectives.find((o) => o.spec.kind === "extraction" && o.spec.required);
}

/** Who walks out and who does not, if extraction resolved right now (D120) — a pure read. */
export interface ExfilStandings {
  /** Cohort members standing on a mouth — they come home. */
  out: Unit[];
  /** Cohort members still on their feet inside — they do not. */
  leftBehind: Unit[];
}

/**
 * Read the exfil board *without* committing (D120): who of the cohort is on a mouth and who is
 * still inside. Drives the "Go now" control's label and its hover copy, so the player can see
 * the price of the call **before** paying it. Units already down or already bound are in
 * neither list — the call decides the fate of those still on their feet.
 */
export function exfilStandings(staged: StagedEncounter): ExfilStandings {
  const obj = exfilObjective(staged);
  const out: Unit[] = [];
  const leftBehind: Unit[] = [];
  if (!obj) return { out, leftBehind };
  for (const u of staged.battle.units) {
    if (!obj.cohort?.has(u.id) || !isActive(u)) continue;
    (onExfilSite(u, obj.spec) ? out : leftBehind).push(u);
  }
  return { out, leftBehind };
}

/**
 * Whether the **"Go now"** call is available: the encounter carries an exfil objective **and at
 * least one of the cohort is standing on a mouth**.
 *
 * The second clause is load-bearing, not decoration — with nobody out, the call would bind the
 * entire cohort and {@link encounterOutcome}'s standing-players check would grade the result a
 * **wipe**. A button press must never be able to manufacture a run-ending loss, so the control
 * simply does not exist until someone has actually reached a door.
 */
export function canCallExfil(staged: StagedEncounter): boolean {
  return !!exfilObjective(staged) && exfilStandings(staged).out.length > 0;
}

/** What the {@link callExfil} commitment produced (D120). */
export interface ExfilCall {
  /** The grade at the call: captives out ⇒ `win`, else the survivable `objective-failure`. */
  result: EncounterResult;
  /** Cohort members who were on a mouth — they come home. */
  extracted: Unit[];
  /** Cohort members left inside — now **captured**, and recorded by the resolution (D9/D120). */
  leftBehind: Unit[];
}

/**
 * **"Go now" (D120)** — resolve extraction *on demand*, so leaving early is a decision the
 * player makes rather than one the mission makes for them. The outcome is computed from what is
 * true **at the call**: whoever stands on a mouth escapes; whoever does not is left behind.
 *
 * The one place position is ever consulted. Every off-mouth member of the cohort is bound
 * ({@link "./combat-actions".CombatAction} `capture`, so the marking is logged, replayable and
 * undo-aware like any other in-battle mutation) — and from here on the whole resolution path
 * reads only `captured`. That is what lets **two populations on two code paths** (roster units
 * via `resolveRescues`, on-board captives via `resolveCaptiveRecruits`) converge without either
 * of them re-deriving the geometry.
 *
 * Binding them is also what *makes* the extraction resolve: a bound unit is no longer part of the
 * "everyone must be out" clause, so with the prisoners on a mouth the goal now reads `met` and the
 * call grades a **win**; without them it grades the survivable **retreat** ({@link exfilCalled}).
 *
 * Returns `undefined` — committing nothing — when the encounter has no exfil objective or nobody
 * is at a door ({@link canCallExfil}). Idempotent: a second call finds nobody left to bind.
 */
export function callExfil(staged: StagedEncounter): ExfilCall | undefined {
  if (!canCallExfil(staged)) return undefined;
  const { out, leftBehind } = exfilStandings(staged);
  for (const u of leftBehind) staged.battle.apply({ kind: "capture", unit: u.id });
  staged.exfilCalled = true;
  return { result: encounterOutcome(staged) ?? "objective-failure", extracted: out, leftBehind };
}
