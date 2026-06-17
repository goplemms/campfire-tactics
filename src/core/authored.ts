/**
 * The authored-content substrate (D44/D52) — hand-crafted, **deterministic**
 * encounters.
 *
 * Everything procedural in the game derives from a seed ({@link "./generation"});
 * this module is the opposite: a designer hand-populates a fixed grid, enemy
 * roster, placements, rewards and objectives. No RNG — building an authored
 * encounter twice yields identical units. It reuses the existing `TileGrid`/`Unit`
 * structures so the deploy→battle→resolution pipeline runs unchanged, and its
 * objectives ride the converged {@link "./objectives"} model. An authored
 * encounter binds to an overworld node and is staged through {@link
 * "./staging".stageEncounter}, exactly like a procedural one.
 *
 * Graded failure (D43): an encounter resolves to `win`, `objective-failure`
 * (survivable — the party retreats alive), or `wipe` ({@link EncounterResult}).
 *
 * Pure logic: no Phaser, no DOM, no `Math.random`.
 */

import type { GridCoord } from "./iso";
import type { Unit, UnitSpec } from "./units";
import { createUnit } from "./units";
import { TileGrid } from "./grid";
import { getEnemyTemplate, type EncounterReward } from "./generation";
import type { ObjectiveSpec } from "./objectives";

/** A hand-placed enemy in an authored encounter. */
export interface EnemyPlacement {
  /** Template id (a bandit archetype or procedural template). */
  templateId: string;
  pos: GridCoord;
  /** Optional explicit unit id (defaults to `${templateId}@col,row`). */
  id?: string;
  /** Stat overrides (a tougher captain, a named escort). */
  overrides?: Partial<UnitSpec>;
  /**
   * An ambush body **hidden until scouted** (D44). A render/fog concern — the
   * core fields it normally; the flag rides through for the scene to respect.
   */
  hidden?: boolean;
  /** Objective role tag (D50): the closing-gate binds its driver to the Sapper. */
  role?: "sapper" | "captain";
}

/** A hand-placed, concealed enemy trap in an authored encounter (the trap-field lever). */
export interface AuthoredTrap {
  /** Optional explicit id (defaults to `trap@col,row`). */
  id?: string;
  pos: GridCoord;
  /** Damage on a spring (defaults to the trap-kit's 12). */
  damage?: number;
  /** How hard it is to spot — higher resists the Awareness roll (defaults to 4). */
  concealment?: number;
}

/** A fixed, hand-authored encounter (D44). */
export interface AuthoredEncounter {
  id: string;
  name: string;
  cols: number;
  rows: number;
  blocked: GridCoord[];
  /** Where the party deploys (home edge). */
  playerSpawns: GridCoord[];
  enemies: EnemyPlacement[];
  /** Concealed enemy traps pre-placed on the field (spot to avoid, Survivalist to harvest). */
  traps?: AuthoredTrap[];
  reward: EncounterReward;
  /**
   * The encounter's objectives (D50) — the converged, multi-objective model the
   * staging seam arms. A closing-gate goes here; the default elimination goal is
   * injected when none lists an explicit goal.
   */
  objectives?: ObjectiveSpec[];
}

/** Build the fixed {@link TileGrid} for an authored encounter. */
export function buildAuthoredGrid(enc: AuthoredEncounter): TileGrid {
  return new TileGrid(enc.cols, enc.rows, enc.blocked);
}

/** Inflate an authored encounter's placements into live enemy {@link Unit}s. */
export function buildAuthoredEnemies(enc: AuthoredEncounter): Unit[] {
  return enc.enemies.map((p) => {
    const tpl = getEnemyTemplate(p.templateId);
    if (!tpl) throw new Error(`buildAuthoredEnemies: unknown template "${p.templateId}"`);
    const u = createUnit({
      id: p.id ?? `${p.templateId}@${p.pos.col},${p.pos.row}`,
      name: tpl.name,
      side: "enemy",
      pos: p.pos,
      speed: tpl.speed,
      maxHp: tpl.maxHp,
      attack: tpl.attack,
      defense: tpl.defense,
      moveRange: tpl.moveRange,
      sightRadius: tpl.sightRadius,
      awareness: tpl.awareness,
      attackRange: tpl.attackRange,
      jobId: tpl.jobId,
      thief: tpl.thief,
      role: p.role,
      ...p.overrides,
    });
    u.hidden = p.hidden ?? false;
    return u;
  });
}

/** Place the party at the encounter's spawn tiles (extras stack on the last). */
export function placeParty(party: readonly Unit[], spawns: readonly GridCoord[]): void {
  party.forEach((u, i) => {
    const s = spawns[Math.min(i, spawns.length - 1)] ?? { col: 0, row: 0 };
    u.pos = { col: s.col, row: s.row };
  });
}

/** The graded outcome of an encounter (D43): win, survivable failure, or wipe. */
export type EncounterResult = "win" | "objective-failure" | "wipe";
