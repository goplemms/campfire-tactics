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

import type { GridCoord, Region } from "./iso";
import type { Unit, UnitSpec, ReleaseRequirement } from "./units";
import { createUnit } from "./units";
import { TileGrid } from "./grid";
import { getEnemyTemplate, type EncounterReward } from "./generation";
import { TAGS } from "./tags";
import type { ObjectiveSpec } from "./objectives";
import { makeGate, makeLever, type Gate, type GateLock, type Lever } from "./gates";
import type { SpawnZone } from "./deployment";
import type { IntelTier } from "./intel"; // type-only (erased) — no runtime cycle

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
  /**
   * How this captive may be **freed** (D52/D69) — the rescue-gate requirement
   * ({@link "./units".ReleaseRequirement}). Absent ⇒ `reach` (any adjacent ally, the L1
   * Cook). A **cuffed** captive sets `{ kind: "lockpick" }` so only a Thief can pick the
   * cell — the first Thief-exclusive deploy payoff (the infiltration taste).
   */
  release?: ReleaseRequirement;
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
  /**
   * Where the party deploys (home edge). Ignored when {@link spawnZones} is declared —
   * the zones then own placement (everyone at the primary zone) *and* the safe ground.
   * Still authored so a level stays playable without zones (and the editor's spawn brush
   * keeps meaning something).
   */
  playerSpawns: GridCoord[];
  /**
   * **Authored spawn zones** (D119) — this encounter's declared safe ground, replacing the
   * derived campfire. Each zone is a fixed tile list with its own capacity cap; a unit
   * standing in one is capture-immune wherever the net has reached, and the deploy phase
   * force-starts when the net reaches the **primary** zone. A zone with `requiresFlag` is
   * unioned in only when that run flag is set (the intel gate) — no flag ⇒ no zone ⇒ no
   * entrance verb, which is D118's graceful degradation by construction. Absent ⇒ the
   * hardcoded campfire, exactly as before. See {@link AuthoredSpawnZone}.
   */
  spawnZones?: AuthoredSpawnZone[];
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
   * Interactable **gates** (D103) — locked tiles that enclose (a cell's prisoner) or seal
   * (a control-room door). A locked gate blocks its tile until an {@link "./gates".GateLock}
   * condition opens it (a Thief lockpicks it, or the keyholder is defeated). See {@link AuthoredGate}.
   */
  gates?: AuthoredGate[];
  /**
   * **Levers** (D103) — pull-switches that toggle the locked state of their target gates from a
   * distance (the control-room seal). See {@link AuthoredLever}.
   */
  levers?: AuthoredLever[];
  /**
   * The **control-room region** (D108/D117, M3b) — the objective span a garrison unit prioritizes foes
   * *inside* as attack targets (Decision G's lever-camp defuser: a foe working the objective/lever gets
   * attacked rather than pinning the garrison bodilessly). An inclusive {@link Region} rectangle; absent ⇒
   * no target-priority tilt (the door-drive alone). Read by the planner via `AIOptions`.
   */
  controlRoom?: Region;
  /**
   * **Rumors** (D83) — the free-form info lane of the intel read, tier-banded like the
   * structured lanes: `rumors[i]` is revealed at intel tier `i+1` ("folk around here
   * say…" at tier 1 → sharper hearsay as the read deepens). Locked lines render as
   * `???` on the intel card. Authored flavor; absent = no info box for the node.
   */
  rumors?: string[];
  /**
   * **Intel depth** (D86) — the deepest tier this node can be scouted to; the read is
   * **capped** here (`min(floor + scouting, intelDepth)`), so a shallow node genuinely
   * has less to know: a `2` never reveals positions (no tier-3 deploy vision / careless
   * mark), and its "✓ No new intel to find" terminal + intel-meter ring land at tier 2.
   * Defaults to {@link "./intel".MAX_TIER} (full depth — every current node). Author
   * content to fit: keep `rumors.length ≤ intelDepth` (deeper lines are unreachable).
   */
  intelDepth?: IntelTier;
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

/**
 * Fail loud (D117) if an authored unit carries an **intrinsic tag not in the {@link TAGS} registry** —
 * a designer typo (`"garrsion"`) would otherwise be a silent no-op (the tag never matches its constant).
 * Every authored enemy/captive stages through here, so a bad tag can't reach the board unnoticed.
 */
function assertRegisteredTags(u: Unit): void {
  for (const t of u.tags) {
    if (!TAGS[t]) throw new Error(`authored unit "${u.id}" carries unregistered tag "${t}" (not in TAGS)`);
  }
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
    assertRegisteredTags(u);
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
    const u = createUnit({ ...c.spec, side: "player", pos: c.pos, authored: true, release: c.release });
    u.captured = true;
    assertRegisteredTags(u);
    return u;
  });
}

/**
 * An authored **gate** placement (D103): a tile + how it opens ({@link GateLock} conditions).
 * `locked` defaults **true** — an authored gate starts shut (the interesting state); set it `false`
 * for a gate that begins open (e.g. a control-room door that a lever later *closes*).
 */
export interface AuthoredGate {
  id: string;
  pos: GridCoord;
  openBy: GateLock[];
  locked?: boolean;
}

/** Inflate an authored encounter's {@link AuthoredGate}s into live {@link Gate}s (locked by default). */
export function buildAuthoredGates(enc: AuthoredEncounter): Gate[] {
  return (enc.gates ?? []).map((g) => makeGate(g.id, g.pos, g.openBy, g.locked ?? true));
}

/** An authored **lever** placement (D103): a tile + the gate ids it toggles when pulled. */
export interface AuthoredLever {
  id: string;
  pos: GridCoord;
  targets: string[];
}

/** Inflate an authored encounter's {@link AuthoredLever}s into live {@link Lever}s. */
export function buildAuthoredLevers(enc: AuthoredEncounter): Lever[] {
  return (enc.levers ?? []).map((l) => makeLever(l.id, l.pos, l.targets));
}

/**
 * An authored **spawn zone** placement (D119): a named tile patch with a capacity cap,
 * optionally gated behind a run flag.
 *
 * ⚠️ **The tile list is load-bearing content, not decoration.** The deploy phase already
 * offers Pull Lever with no phase gate (D67 — engagement is board state, not a per-phase
 * verb ban) while the garrison is frozen, so a zone drawn *over* a lever makes throwing it
 * free. A zone drawn tight (the doorway only) means reaching that lever costs a step onto
 * unprotected ground — the intended "risk detection for efficiency" trade. Author tight.
 */
export interface AuthoredSpawnZone {
  id: string;
  /** Player-facing name — the deploy row reads "Take {label}"; keep it short (the button fits ~140px). */
  label: string;
  /** The zone's tiles, authored verbatim (fixed size — never presence-derived). */
  tiles: GridCoord[];
  /** How many player bodies may stand here. Authored per zone; never hardcoded to 1. */
  cap: number;
  /** The default/force-start zone. Exactly one zone in a set must be primary. */
  primary?: boolean;
  /**
   * Union this zone in only when `run.flags[requiresFlag]` is set — the intel gate. Must be
   * absent on the primary zone (the party always has somewhere to stand). The flag bag is an
   * untyped `Record<string, boolean>`, so a spelling slip fails **silently**: reference the
   * exported constant (`SIDE_DOOR_INTEL`) and pin the JSON's value against it in a test.
   */
  requiresFlag?: string;
}

/**
 * Inflate an authored encounter's {@link AuthoredSpawnZone}s into live {@link SpawnZone}s
 * (D119), dropping any whose `requiresFlag` is unset in `flags` — the intel gate, and the
 * whole of the graceful-degradation path. Returns `[]` when the encounter declares none (the
 * campfire default). **Fails loud** on a zone set with no surviving primary: a set that lost
 * its anchor would leave the party unplaceable and the phase unable to force-start, and a
 * silent fallback to the campfire would put the safe ground back inside a wall.
 */
export function buildSpawnZones(enc: AuthoredEncounter, flags: Record<string, boolean> = {}): SpawnZone[] {
  const declared = enc.spawnZones ?? [];
  if (declared.length === 0) return [];
  const zones = declared
    .filter((z) => z.requiresFlag === undefined || flags[z.requiresFlag] === true)
    .map((z) => ({ id: z.id, label: z.label, tiles: z.tiles.map((t) => ({ col: t.col, row: t.row })), cap: z.cap, primary: z.primary === true }));
  if (!zones.some((z) => z.primary)) {
    throw new Error(`buildSpawnZones: encounter "${enc.id}" declares spawn zones but none is primary (after flag filtering)`);
  }
  return zones;
}

/** Place the party at the encounter's spawn tiles (extras stack on the last). */
export function placeParty(party: readonly Unit[], spawns: readonly GridCoord[]): void {
  party.forEach((u, i) => {
    const s = spawns[Math.min(i, spawns.length - 1)] ?? { col: 0, row: 0 };
    u.pos = { col: s.col, row: s.row };
  });
}

/**
 * Place the whole party in the **primary** zone (D119) — the default that replaces
 * {@link placeParty}'s roster-order index-map for a zoned encounter.
 *
 * This is the fix, not a tidy-up: index-mapping `party[i] → spawns[i]` meant the finale's
 * first authored spawn (the side door) went to whoever happened to be first in the roster —
 * a Soldier, who cannot pick the cells — while the Thief started at the far mouth. Everyone
 * defaults to the primary zone with the other zones **EMPTY**; sending someone to the side
 * door is then a deliberate act (the entrance verb), and "I scouted but I'm still going in
 * the front" stays a legal play. Extras stack on the last tile, as `placeParty` always has.
 */
export function placeInZone(party: readonly Unit[], zone: SpawnZone): void {
  placeParty(party, zone.tiles);
}

/** The graded outcome of an encounter (D43): win, survivable failure, or wipe. */
export type EncounterResult = "win" | "objective-failure" | "wipe";
