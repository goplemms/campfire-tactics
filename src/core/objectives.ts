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
 *
 * Objectives are **tag-bound** ({@link ObjectiveTag}: a unit role or id, a span by
 * coordinate), designed so a generator can emit them later. The graded
 * win/objective-failure/wipe classifier lives next to staging ({@link
 * "./staging".encounterOutcome}).
 *
 * Pure logic: no Phaser, no DOM, no `Math.random`.
 */

import type { GridCoord } from "./iso";
import type { Unit } from "./units";
import { CTClock } from "./clock";
import { isImmobilized } from "./status";
import { applyDamage, battleOutcome } from "./combat";

/** The objective kinds M14 ships (D50). */
export type ObjectiveKind = "eliminate-all" | "closing-gate";

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
  /** Tiles swept (their occupants downed) when the gate closes. */
  span?: GridCoord[];
  /** The driver to disable (kill/immobilize) to stop the gate. */
  driver?: ObjectiveTag;
}

/** A live, armed objective: its current {@link ObjectiveStatus} + render progress. */
export interface ArmedObjective {
  spec: ObjectiveSpec;
  /** The objective's current standing — polled by the loop + the HUD. */
  status: () => ObjectiveStatus;
  /** Gauge fill 0..1 for a timed objective, else `undefined` (HUD readout). */
  progress: () => number | undefined;
}

/** The injected default goal (D50): clear the field when none is authored. */
export const DEFAULT_GOAL: ObjectiveSpec = {
  id: "eliminate-all",
  kind: "eliminate-all",
  required: true,
  label: "Defeat all enemies",
};

/**
 * Prepend the {@link DEFAULT_GOAL} unless the list already names an explicit goal
 * (an `eliminate-all`) — so every encounter has a way to *win*, but authored
 * goals are honored as-is (D50). A closing-gate alone is a *constraint*, not a
 * goal, so it still gets the default elimination goal.
 */
export function withDefaultGoal(specs: readonly ObjectiveSpec[] = []): ObjectiveSpec[] {
  return specs.some((s) => s.kind === "eliminate-all") ? [...specs] : [DEFAULT_GOAL, ...specs];
}

/** Match a unit against an objective tag (role or explicit id). */
function matchesTag(u: Unit, tag?: ObjectiveTag): boolean {
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
