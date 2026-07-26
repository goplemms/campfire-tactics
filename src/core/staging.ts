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
import type { Unit } from "./units";
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
  placeParty,
  type AuthoredEncounter,
  type EncounterResult,
} from "./authored";
import type { Gate, Lever } from "./gates";
import {
  armObjectives,
  withDefaultGoal,
  isGoalKind,
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
    placeParty(players, opts.playerSpawns ?? source.playerSpawns);
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
  const battle = new Battle(grid, [...players, ...captives, ...enemies], { seed: opts.seed, gates, levers, controlRoom });

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
  return undefined;
}
