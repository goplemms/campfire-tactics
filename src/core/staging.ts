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
 * {@link encounterOutcome} is the single graded classifier (D50/D51): `wipe →
 * any required objective failed → all required met = win`.
 *
 * Pure logic: no Phaser, no DOM, no `Math.random`.
 */

import type { GridCoord } from "./iso";
import type { Unit } from "./units";
import { TileGrid } from "./grid";
import { Battle } from "./turn";
import { makeConcealedTrap } from "./entities";
import { buildGrid, buildEnemies, type EncounterDef } from "./generation";
import {
  buildAuthoredGrid,
  buildAuthoredEnemies,
  placeParty,
  type AuthoredEncounter,
  type EncounterResult,
} from "./authored";
import {
  armObjectives,
  withDefaultGoal,
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
  let objectiveSpecs;

  if (isAuthoredEncounter(source)) {
    grid = buildAuthoredGrid(source);
    enemies = buildAuthoredEnemies(source);
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

  const battle = new Battle(grid, [...players, ...enemies]);

  // Pre-place the authored concealed enemy traps (the trap-field lever, D12): they
  // ride the same entity registry the player's Set Trap uses, so movement springs
  // them and the Survivalist can disarm them — no special case in the loop (D4).
  if (isAuthoredEncounter(source) && source.traps) {
    source.traps.forEach((t) =>
      battle.entities.register(
        makeConcealedTrap(t.id ?? `enemy-trap@${t.pos.col},${t.pos.row}`, t.pos, "enemy", t.damage ?? 12, t.concealment ?? 4),
      ),
    );
  }

  const objectives = armObjectives(battle.clock, battle.units, objectiveSpecs);
  return { battle, objectives, source };
}

/**
 * Grade a staged encounter (D50/D51). **Wipe** if no combat-capable player
 * remains; else **objective-failure** if any *required* objective failed; else
 * **win** once every *required* objective is met. Optional objectives never
 * downgrade a win. Returns `undefined` while the encounter is still undecided
 * (the failure poll calls this each checkpoint and finishes when it resolves).
 */
export function encounterOutcome(staged: StagedEncounter): EncounterResult | undefined {
  const playersStanding = staged.battle.units.some(
    (u) => u.side === "player" && u.alive && !u.captured,
  );
  if (!playersStanding) return "wipe";
  const required = staged.objectives.filter((o) => o.spec.required);
  if (required.some((o) => o.status() === "failed")) return "objective-failure";
  if (required.every((o) => o.status() === "met")) return "win";
  return undefined;
}
