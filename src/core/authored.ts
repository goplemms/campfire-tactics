/**
 * The authored-content substrate (D44) — hand-crafted, **deterministic** quests.
 *
 * Everything procedural in the game derives from a seed ({@link "./generation"});
 * this module is the opposite: a designer hand-populates a fixed map, enemy
 * roster, placements, rewards and beats. No RNG — building an authored encounter
 * twice yields identical units. It reuses the existing `Encounter`/`TileGrid`/
 * `Unit` structures so the camp→deploy→battle→resolution pipeline runs unchanged.
 *
 * Also defines **graded failure** (D43): an encounter resolves to `win`,
 * `objective-failure` (survivable — the party retreats alive), or `wipe`.
 *
 * Pure logic: no Phaser, no DOM, no `Math.random`.
 */

import type { GridCoord } from "./iso";
import type { Unit, UnitSpec } from "./units";
import { createUnit } from "./units";
import { TileGrid } from "./grid";
import { getEnemyTemplate, type EncounterReward } from "./generation";
import { isImmobilized } from "./status";
import { applyDamage } from "./combat";
import { CTClock } from "./clock";
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
  /** Objective role (D43): the Sapper drives the bridge-cut timer. */
  role?: "sapper" | "captain";
}

/**
 * A timed objective on an encounter (D43) — the demo's bridge-cut.
 *
 * **Retiring (D50):** generalized into the `closing-gate` {@link ObjectiveSpec}
 * kind. Kept only for the legacy {@link DemoRunner} path until M14 Phase 4 deletes
 * the demo; new content lists {@link AuthoredEncounter.objectives} instead.
 */
export interface BridgeCutObjective {
  kind: "bridge-cut";
  /** Gauge fill per tick; the cut completes when it reaches 100 (≈ N turns). */
  speed: number;
  /** Tiles swept (their occupants downed) when the cut completes. */
  span?: GridCoord[];
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
  reward: EncounterReward;
  /** XP each surviving deployed unit earns on a win (tunes the rest-beat level). */
  xp?: number;
  /**
   * The encounter's objectives (D50) — the converged, multi-objective model the
   * staging seam arms. A closing-gate goes here; the default elimination goal is
   * injected when none lists an explicit goal. (The legacy single `objective`
   * below is the retiring demo path.)
   */
  objectives?: ObjectiveSpec[];
  /** Legacy demo objective (D43) — retiring with {@link DemoRunner} in Phase 4. */
  objective?: BridgeCutObjective;
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

/** Live state of a timed objective (D43). */
export interface ObjectiveState {
  /** True once the cut completed (the objective was lost). */
  failed: boolean;
  /** The Sapper driving it — killed or Immobilized to fizzle the cut. */
  sapper?: Unit;
}

/**
 * Arm the encounter's timed objective on a battle's clock (D43): schedule the
 * bridge-cut as a {@link "./clock".ScheduledEffect}. Its **fizzle** fires when
 * the Sapper dies **or** is Immobilized (kill/snare it to stop the cut); if it
 * resolves, the span's occupants are swept (downed) and `state.failed` is set.
 * Returns the live state to poll. No objective → a state that never fails.
 */
export function armObjective(
  clock: CTClock,
  enc: AuthoredEncounter,
  units: readonly Unit[],
): ObjectiveState {
  const state: ObjectiveState = { failed: false };
  if (!enc.objective) return state;
  const idOf = (p: EnemyPlacement) => p.id ?? `${p.templateId}@${p.pos.col},${p.pos.row}`;
  const sapper = units.find(
    (u) => enc.enemies.find((p) => idOf(p) === u.id)?.role === "sapper",
  );
  state.sapper = sapper;
  const span = enc.objective.span ?? [];
  const onSpan = (u: Unit) => span.some((t) => t.col === u.pos.col && t.row === u.pos.row);
  clock.schedule({
    id: `objective:${enc.id}:bridge-cut`,
    speed: enc.objective.speed,
    // Kill OR Immobilize the Sapper to fizzle the cut (D43).
    fizzleWhen: () => !!sapper && (!sapper.alive || isImmobilized(sapper)),
    run: () => {
      state.failed = true;
      // The span collapses: its occupants are swept → downed (not auto-dead;
      // the runner resolves them per D9 — a survivable retreat, not a wipe).
      for (const u of units) {
        if (u.alive && onSpan(u)) applyDamage(u, u.hp);
      }
    },
  });
  return state;
}

/** The graded outcome of an authored encounter (D43). */
export type EncounterResult = "win" | "objective-failure" | "wipe";

// --- Quest beats (D44) ------------------------------------------------------

/** A material drop a story choice can grant. */
export interface ItemGrant {
  id: string;
  count: number;
}

/** The mechanical result of a story choice (deterministic). */
export interface StoryOutcome {
  summary: string;
  gold?: number;
  items?: ItemGrant[];
  /** Pre-reveal E2's hidden ambush (the "spare the deserter" branch). */
  revealAmbush?: boolean;
}

/** Beat 1 — Provision: load herbs under the cap with a little gold (D44). */
export interface ProvisionBeat {
  kind: "provision";
  storageCap: number;
  gold: number;
  /** Material ids on offer (the three herbs). */
  offer: string[];
  /** A banded intel preview of the next encounter. */
  intel?: string;
}

/** An encounter beat — a fixed authored fight. */
export interface EncounterBeat {
  kind: "encounter";
  encounter: AuthoredEncounter;
}

/** A rest beat — recover, level up, and make a story choice (D44). */
export interface RestBeat {
  kind: "rest";
  /** XP each surviving member earns here (tuned so E1's award reaches L2). */
  xp: number;
  choice?: {
    prompt: string;
    spareLabel: string;
    pressLabel: string;
    spare: StoryOutcome;
    press: StoryOutcome;
  };
}

/** One beat of an authored quest. */
export type QuestBeat = ProvisionBeat | EncounterBeat | RestBeat;

/** A hand-authored quest (D44): a starting party + an ordered list of beats. */
export interface AuthoredQuest {
  id: string;
  name: string;
  party: UnitSpec[];
  beats: QuestBeat[];
}
