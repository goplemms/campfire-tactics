/**
 * Encounter objectives (D50) — the generalized, multi-objective seam that
 * converges the authored bridge-cut (D43) and procedural elimination into one
 * data-driven model the renderer and the run loop read uniformly.
 *
 * An encounter carries a **list** of {@link ObjectiveSpec}, each `required` or
 * optional, each resolving to one of {@link ObjectiveStatus} (`met | failed |
 * pending`). M14 ships two **kinds**:
 *
 * - **`eliminate-all`** — a required *goal*, **met** when the player has cleared
 *   the field (a thin delegate over the unchanged win primitive). Default-injected
 *   when an encounter lists no explicit goal ({@link withDefaultGoal}).
 * - **`closing-gate`** — a required *constraint* generalizing the bridge-cut: a
 *   timed gauge that, on completion, sweeps a coordinate span (downing occupants)
 *   and **fails** the objective. It **fizzles** (resolves **met**) when its tagged
 *   driver is killed or immobilized — kill/snare the driver to stop the gate.
 * - **`extraction`** — a *goal* (D97/C2): **met** when every tagged escortee (a freed
 *   prisoner, `escort`) is alive, no longer captured, and standing on the `span` exfil
 *   tiles — **and every surviving party member is standing there too** (D120). The finale's
 *   second win-path — free the cells and get *everyone* out — OR'd against `eliminate-all`
 *   (the frontal path) by the classifier. The player may resolve it early and deliberately
 *   with the **"Go now"** call ({@link "./staging".callExfil}), accepting that whoever is not
 *   on a mouth does not come home.
 *
 * A **goal** kind ({@link isGoalKind}: `eliminate-all` / `extraction`) *wins* the
 * encounter when met; goals are **OR'd** — achieving *any one* wins (D97/C2). A
 * **constraint** kind (`closing-gate`) must *not fail*; constraints are AND'd. Both
 * are combined by the classifier next to staging ({@link "./staging".encounterOutcome}).
 *
 * Objectives are **tag-bound** ({@link ObjectiveTag}: a unit role or id, a span by
 * coordinate), designed so a generator can emit them later.
 *
 * Pure logic: no Phaser, no DOM, no `Math.random`.
 */

import type { GridCoord } from "./iso";
import { isActive, type Unit } from "./units";
import { CTClock } from "./clock";
import { isImmobilized } from "./status";
import { applyDamage, battleOutcome } from "./combat";

/**
 * The canonical objective kinds (D50; `extraction` added D97) — the **single source** the type
 * *and* every runtime kind-check derive from. Add a kind here and it propagates to
 * {@link ObjectiveKind} and to consumers like the content pipeline's `validateLevel` (which
 * imports this list rather than hand-copying it, so the editor/pipeline can't drift, D98).
 */
export const OBJECTIVE_KINDS = ["eliminate-all", "closing-gate", "extraction"] as const;

/** The objective kinds (D50; `extraction` added D97), derived from {@link OBJECTIVE_KINDS}. */
export type ObjectiveKind = (typeof OBJECTIVE_KINDS)[number];

/**
 * The **goal** kinds (D97/C2) — objectives that represent *winning*: achieving any one
 * wins the encounter (goals are OR'd by {@link "./staging".encounterOutcome}). Every
 * other kind is a **constraint** (must-not-fail, AND'd). `eliminate-all` (clear the
 * field) and `extraction` (get the prisoners out) are the two win-paths the finale ORs.
 */
export const GOAL_KINDS: ReadonlySet<ObjectiveKind> = new Set<ObjectiveKind>([
  "eliminate-all",
  "extraction",
]);

/** True if `kind` is a win-achieving **goal** (OR'd), false if a must-not-fail **constraint**. */
export function isGoalKind(kind: ObjectiveKind): boolean {
  return GOAL_KINDS.has(kind);
}

/** Where an objective stands right now (D50). */
export type ObjectiveStatus = "met" | "failed" | "pending";

/**
 * Addresses the unit an objective hangs on, by **tag** (D50): a `role` (e.g. the
 * closing-gate `"sapper"`) or an explicit `id`. Designed so a generator can bind
 * objectives to roles it stamps, without hand-wiring unit references.
 */
export interface ObjectiveTag {
  role?: string;
  id?: string;
}

/** One objective on an encounter (D50). */
export interface ObjectiveSpec {
  /** Unique within the encounter — the clock-effect key + HUD id. */
  id: string;
  kind: ObjectiveKind;
  /** Required objectives gate the outcome; optional ones never downgrade a win. */
  required: boolean;
  /** Authored HUD label. */
  label: string;
  // --- closing-gate fields ---
  /** Gauge fill per tick; the gate closes (fails) when it reaches 100 (≈ N turns). */
  speed?: number;
  /**
   * A coordinate span. For `closing-gate`: the tiles swept (occupants downed) when the
   * gate closes. For `extraction`: the **exit tiles** the escortees must reach (D97).
   */
  span?: GridCoord[];
  /** The driver to disable (kill/immobilize) to stop the gate. */
  driver?: ObjectiveTag;
  // --- extraction fields (D97) ---
  /**
   * The units to escort to the `span` exit tiles (the freed prisoners) — tagged by
   * role/id like {@link driver}. Extraction is **met** when *every* escortee is freed
   * (uncaptured), alive and standing on an exit tile **and the surviving party is out with
   * them** (D120); a lost prisoner leaves it *pending* (a goal never *fails*, so the frontal
   * `eliminate-all` path stays open).
   */
  escort?: ObjectiveTag;
}

/** A live, armed objective: its current {@link ObjectiveStatus} + render progress. */
export interface ArmedObjective {
  spec: ObjectiveSpec;
  /** The objective's current standing — polled by the loop + the HUD. */
  status: () => ObjectiveStatus;
  /** Gauge fill 0..1 for a timed objective, else `undefined` (HUD readout). */
  progress: () => number | undefined;
  /**
   * **`extraction` only (D120): the exfil cohort** — the ids of the units the exfil rule
   * governs, **snapshotted when the objective is armed**. At that moment (immediately after
   * the `Battle` is constructed in {@link "./staging".stageEncounter}) the player-side units
   * are exactly *the roster plus the declared captives* — the people who go home.
   *
   * It is a snapshot rather than a live `side === "player"` filter because a **swayed** enemy
   * (the Noble's Bribe, D30/D62) flips `side` to `"player"` mid-fight. A turncoat standing deep
   * in the prison would otherwise block the extraction win **forever** and be recorded as
   * "left behind" — neither of which is true of someone who was never yours.
   */
  cohort?: ReadonlySet<string>;
}

/** True if `u` stands on one of `spec`'s exfil tiles (the `extraction` `span`, D97/D120). */
export function onExfilSite(u: Unit, spec: ObjectiveSpec): boolean {
  return (spec.span ?? []).some((t) => t.col === u.pos.col && t.row === u.pos.row);
}

/** The injected default goal (D50): clear the field when none is authored. */
export const DEFAULT_GOAL: ObjectiveSpec = {
  id: "eliminate-all",
  kind: "eliminate-all",
  required: true,
  label: "Defeat all enemies",
};

/**
 * Prepend the {@link DEFAULT_GOAL} unless the list already names a **required** goal
 * ({@link isGoalKind} — `eliminate-all` *or* `extraction`) — so every encounter has a
 * *required* way to *win*, but authored required goals are honored as-is (D50/D97). A
 * closing-gate alone is a *constraint*, not a goal, so it still gets the default elimination
 * goal; an extraction-only encounter (win solely by getting the prisoners out) does **not**.
 *
 * The `required` guard closes the C2 footgun: an *optional* goal (e.g. an `eliminate-all` row
 * with `required:false`) no longer suppresses the default. Without it a level whose only goal
 * is optional would carry **zero required goals**, which {@link "./staging".encounterOutcome}
 * scores as a vacuous instant win — a live enemy and turn-one victory.
 */
export function withDefaultGoal(specs: readonly ObjectiveSpec[] = []): ObjectiveSpec[] {
  return specs.some((s) => isGoalKind(s.kind) && s.required) ? [...specs] : [DEFAULT_GOAL, ...specs];
}

/** Match a unit against an objective tag (role or explicit id) — shared with the gate keyholder lock (D103). */
export function matchesTag(u: Unit, tag?: ObjectiveTag): boolean {
  if (!tag) return false;
  if (tag.id !== undefined && u.id !== tag.id) return false;
  if (tag.role !== undefined && u.role !== tag.role) return false;
  return tag.id !== undefined || tag.role !== undefined;
}

/** The scheduled-effect id for a closing-gate objective. */
function gateKey(spec: ObjectiveSpec): string {
  return `objective:${spec.id}`;
}

/**
 * Arm one objective on a battle's clock + unit set, returning its live readers.
 * `eliminate-all` reads the win primitive; `closing-gate` schedules its gauge.
 */
function armOne(clock: CTClock, units: readonly Unit[], spec: ObjectiveSpec): ArmedObjective {
  if (spec.kind === "eliminate-all") {
    return {
      spec,
      status: () => {
        const o = battleOutcome(units);
        return o.over && o.winner === "player" ? "met" : "pending";
      },
      progress: () => undefined,
    };
  }

  if (spec.kind === "extraction") {
    // A goal (D97, broadened by D120): met when every tagged escortee (a freed prisoner) is
    // alive, uncaptured and standing on an exfil site — **and the surviving party is out too**.
    // Before D120 the escortees alone decided it, so the mission declared victory the instant
    // the prisoners touched a mouth with half the party still crossing the corridor; "Go now"
    // could not mean anything, because leaving early was the only thing that ever happened.
    // Never *fails* — a downed/lost prisoner just leaves it pending, so the frontal path stays
    // open (D97). A **downed** or **fled** (D84 `escaped`) party member does not block it:
    // only the living, still-on-the-field cohort has to walk out.
    const onExit = (u: Unit) => onExfilSite(u, spec);
    // The cohort snapshot — see {@link ArmedObjective.cohort} for why this is not a live filter.
    const cohort: ReadonlySet<string> = new Set(units.filter((u) => u.side === "player").map((u) => u.id));
    const mine = () => units.filter((u) => cohort.has(u.id));
    const escortees = () => mine().filter((u) => matchesTag(u, spec.escort));
    /** Everyone who still has to be accounted for: the escortees + the party still on its feet. */
    const owed = () => {
      const es = escortees();
      const ids = new Set(es.map((u) => u.id));
      return [...es, ...mine().filter((u) => !ids.has(u.id) && isActive(u))];
    };
    /** An escortee is out only if alive+uncaptured+on a mouth; anyone else, only if on a mouth. */
    const isOut = (u: Unit) => (matchesTag(u, spec.escort) ? u.alive && !u.captured && onExit(u) : onExit(u));
    return {
      spec,
      cohort,
      status: () => {
        if (escortees().length === 0) return "pending"; // nothing tagged to extract yet
        return owed().every(isOut) ? "met" : "pending";
      },
      // HUD readout: the fraction of everyone who must get out that currently is — so the bar
      // can no longer read 100% while the objective is still pending.
      progress: () => {
        if (escortees().length === 0) return undefined;
        const all = owed();
        return all.length === 0 ? 1 : all.filter(isOut).length / all.length;
      },
    };
  }

  // closing-gate: a timed gauge sweeping a span, fizzled by disabling its driver.
  const driver = spec.driver ? units.find((u) => matchesTag(u, spec.driver)) : undefined;
  const span = spec.span ?? [];
  const onSpan = (u: Unit) => span.some((t) => t.col === u.pos.col && t.row === u.pos.row);
  const state = { failed: false };
  const key = gateKey(spec);
  clock.schedule({
    id: key,
    speed: spec.speed ?? 1,
    // Kill OR immobilize the driver at completion to fizzle the gate (D50).
    fizzleWhen: () => !!driver && (!driver.alive || isImmobilized(driver)),
    run: () => {
      state.failed = true;
      for (const u of units) {
        if (u.alive && onSpan(u)) applyDamage(u, u.hp); // swept → downed (D9 resolves)
      }
    },
  });
  return {
    spec,
    status: () => {
      if (state.failed) return "failed";
      // A dead driver can never let the gate land → the constraint is permanently met.
      if (driver && !driver.alive) return "met";
      // Resolved off the schedule (fizzled at completion) without failing → met.
      if (clock.scheduledProgress(key) === undefined) return "met";
      return "pending";
    },
    progress: () => clock.scheduledProgress(key),
  };
}

/**
 * Arm a list of objective specs on a battle's clock + units (D50), returning the
 * live {@link ArmedObjective}s the loop + HUD poll. Pass the specs through
 * {@link withDefaultGoal} first if you want the default elimination goal injected.
 */
export function armObjectives(
  clock: CTClock,
  units: readonly Unit[],
  specs: readonly ObjectiveSpec[],
): ArmedObjective[] {
  return specs.map((s) => armOne(clock, units, s));
}
