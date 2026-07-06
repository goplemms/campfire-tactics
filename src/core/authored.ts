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

/**
 * A **captive recruit** an authored encounter starts with **on the board** (D52) — a
 * bound, player-side unit guarded by the enemy, freed by the existing capture/rescue
 * mechanic (reach + {@link "./deployment".freeCaptive}) *or* by winning the field. Unlike
 * a post-win {@link EncounterGrant.recruit} (a silent join on the win), the captive is a
 * real token from the first turn: visible during deployment, safe from the AI while bound
 * (a captured unit is not an active target), controllable the moment it's freed, and
 * recruited into `run.party` when the node is won. The L1 Cook rides this — "isolating the
 * captor IS the rescue," the flank corner and the rescue corner being the same. Reusable:
 * any authored encounter can stand a captive up the same way (e.g. a future on-board Medic).
 */
export interface CaptivePlacement {
  /**
   * The unit's authored stat block. It is staged **player-side and bound** (its `side`
   * is forced to `"player"` and `captured` is set at assembly), and — being an authored
   * cast member — joins the roster **permanently** when freed/won (`authored: true`).
   */
  spec: UnitSpec;
  /** The bound tile — at/adjacent to the captor's corner (the flank + rescue affordance). */
  pos: GridCoord;
}

/**
 * A **post-win grant** an authored encounter awards on a `win` (D52 vertical-slice).
 * Beyond the gold/materials/xp {@link EncounterReward}, an authored node can hand the
 * party a fresh **recruit** (joins `run.party`), a **relic/unique item** (into the
 * stash), and/or set a run **flag** (read by conditional map access). The slice's
 * rescue-on-win recruits (Cook/Medic) and the Den's relic ride this — there was no
 * "grant a unit/item on win" hook before, so it's added here and applied in
 * `RunLoop.applyRewards`. Idempotent: a recruit already in the party is not re-added.
 */
export interface EncounterGrant {
  /** A unit that joins `run.party` on the win (the rescued Cook/Medic, etc.). */
  recruit?: UnitSpec;
  /** A material/relic id dropped into the stash on the win (the Den's relic). */
  item?: string;
  /** A run flag set on the win — read by conditional node access (D52 gate). */
  flag?: string;
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
  /**
   * On-board **captive recruits** (D52) — bound, player-side units the player frees by
   * reaching them (the capture/rescue mechanic) or by winning the field, then keeps. Not
   * in `run.party` until freed/won. See {@link CaptivePlacement}.
   */
  captives?: CaptivePlacement[];
  /** Concealed enemy traps pre-placed on the field (spot to avoid, Survivalist to harvest). */
  traps?: AuthoredTrap[];
  /**
   * **Rumors** (D83) — the free-form info lane of the intel read, tier-banded like the
   * structured lanes: `rumors[i]` is revealed at intel tier `i+1` ("folk around here
   * say…" at tier 1 → sharper hearsay as the read deepens). Locked lines render as
   * `???` on the intel card. Authored flavor; absent = no info box for the node.
   */
  rumors?: string[];
  reward: EncounterReward;
  /**
   * Post-win grants (D52) — a recruit / relic / flag awarded on a `win`, beyond the
   * reward. Applied in `RunLoop.applyRewards` (win-only, forfeited on a non-win).
   */
  grants?: EncounterGrant;
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

/**
 * Inflate an authored encounter's {@link CaptivePlacement}s into live, **bound** player
 * units (D52). Each is forced player-side and authored (a freed authored cast member joins
 * permanently), placed at its `pos`, and stamped `captured` so it stages as a grey/bound
 * token: off the initiative clock, never an AI target, a rescuable sub-objective. Returns
 * `[]` when the encounter declares no captives.
 */
export function buildAuthoredCaptives(enc: AuthoredEncounter): Unit[] {
  return (enc.captives ?? []).map((c) => {
    const u = createUnit({ ...c.spec, side: "player", pos: c.pos, authored: true });
    u.captured = true;
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
