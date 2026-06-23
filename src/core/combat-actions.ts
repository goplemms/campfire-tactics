/**
 * Combat actions as data (the command substrate) — Phase 1 of the
 * [combat-actions design](../../docs/design/systems/combat-actions.md).
 *
 * A {@link CombatAction} is the **unit of player input, AI output, log, and
 * replay**: every battle verb lowers to one of these and flows through the single
 * {@link "./turn".Battle.apply} interpreter (validate → mutate → emit → append to
 * `battle.log`). The player path and the AI path can no longer drift, because
 * there is exactly one execution route. Adding a verb is a new variant + a case in
 * `apply` (the same registry ergonomics the skill-effect dispatch already has).
 *
 * **References are ids, not object refs** for the part that gets *rebuilt* on a
 * replay: a {@link UnitId} survives a replay that reconstructs fresh `Unit`
 * objects from an initial snapshot (the load-bearing requirement for the
 * `replay(log) === state` invariant). A {@link "./skills".SkillDef} is **immutable
 * authored data** shared across battles and *not* rebuilt on replay, so a skill
 * action carries the def directly — a stable reference that replays correctly and
 * keeps ad-hoc test skills (not in any job registry) working. A pure-id skill form
 * (for wire-format / netcode) is a Phase-2 serialization refinement, gated on a
 * global skill registry that doesn't exist yet.
 *
 * Pure data: no Phaser, no DOM, no behaviour.
 */

import type { GridCoord } from "./iso";
import type { SkillDef, SkillOutcome, PlaceTrapEffect } from "./skills";
import type { TurnSpend } from "./clock";
import type { RecoverableEntity } from "./entities";

/** A live unit referenced by its stable id (so an action survives a replay rebuild). */
export type UnitId = string;

/**
 * A battle action as data — the unit of player input, AI output, log, and replay.
 *
 * The combat verbs (`move`/`attack`/`skill`/`cleave`/`endTurn`) and the
 * **deployment-phase verbs** (D63 unification — `deployMove`/`digIn`/`placeTrap`/
 * `capture`) both lower to these and flow through the single
 * {@link "./turn".Battle.apply} interpreter, so the deploy phase and combat share
 * one execution route, one undo stack, and one log. The deploy verbs carry distinct
 * `kind`s so {@link "./turn".replay} can drain the (always-leading) deploy actions
 * before driving the combat turn loop.
 */
export type CombatAction =
  /** Walk a unit through a sequence of tiles (each step fires enter/leave events). */
  | { kind: "move"; unit: UnitId; path: GridCoord[] }
  /** A basic attack against a foe (flank-aware via the full roster). */
  | { kind: "attack"; unit: UnitId; target: UnitId }
  /**
   * Resolve a job skill against a target. `commitTurn` (default `true`) ends the
   * caster's turn, spending CT per the skill's `spend`; `false` is the D60 free-move
   * flow where the render layer keeps the turn open and ends it itself.
   */
  | { kind: "skill"; unit: UnitId; skill: SkillDef; target: UnitId; commitTurn?: boolean }
  /** The Heavy Knight's directional AoE: hit every foe in the 90° arc facing `dir`. */
  | { kind: "cleave"; unit: UnitId; skill: SkillDef; dir: GridCoord }
  /** End a unit's turn, spending its CT (acting costs more than only moving). */
  | { kind: "endTurn"; unit: UnitId; spend: TurnSpend }
  // --- Deployment-phase verbs (D63 unification) -----------------------------
  /** Reposition during Deployment (walks the path like `move`, and breaks dig-in). */
  | { kind: "deployMove"; unit: UnitId; path: GridCoord[] }
  /** Cast a dual-context ability during Deployment — resolves like `skill`, no CT commit (D67). */
  | { kind: "deploySkill"; unit: UnitId; skill: SkillDef; target: UnitId }
  /** Hunker for a reduced capture chance when the net's turn comes (D63). */
  | { kind: "digIn"; unit: UnitId }
  /** Lay a player trap on `pos`, consuming one kit from the shared stash (D11/D63). */
  | { kind: "placeTrap"; unit: UnitId; pos: GridCoord; effect: PlaceTrapEffect; id: string }
  /** Bind a unit captured by the closing net (D7/D63) — the deploy "enemy turn" outcome. */
  | { kind: "capture"; unit: UnitId };

/** Every {@link CombatAction} discriminant. */
export type CombatActionKind = CombatAction["kind"];

/** The deployment-phase discriminants — drained ahead of the combat loop by replay. */
const DEPLOY_KINDS: ReadonlySet<CombatActionKind> = new Set<CombatActionKind>([
  "deployMove",
  "deploySkill",
  "digIn",
  "placeTrap",
  "capture",
]);

/** True if `action` is a Deployment-phase verb (precedes the combat turn loop). */
export function isDeployAction(action: CombatAction): boolean {
  return DEPLOY_KINDS.has(action.kind);
}

/**
 * The outcome of an {@link "./turn".Battle.apply} call: `ok` carries the verb's
 * natural result (so the thin public wrappers can return their original shapes —
 * attack damage, a {@link SkillOutcome}, cleave hits, a placed trap), or a refusal
 * with a reason (a skill on cooldown, no trap kit). A refused action is **not**
 * appended to the log.
 */
export type ActionResult =
  | { ok: true; damage?: number; hits?: number; outcome?: SkillOutcome; trap?: RecoverableEntity; levels?: number }
  | { ok: false; reason: string };

/**
 * True if `action` **commits** the acting unit's turn (spends its CT). The replay
 * driver uses this to delimit one turn's recorded actions: an `endTurn`, a `cleave`
 * (always commits), or a `skill` with `commitTurn` left default/true. A `move`,
 * `attack`, free-move `skill` (`commitTurn: false`), or any deploy verb leaves the
 * turn open (deploy turns are committed by the scene's explicit End Turn).
 */
export function commitsTurn(action: CombatAction): boolean {
  switch (action.kind) {
    case "endTurn":
    case "cleave":
      return true;
    case "skill":
      return action.commitTurn ?? true;
    default:
      return false;
  }
}
