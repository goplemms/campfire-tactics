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
  // --- Deployment-only verbs (D63/D67) --------------------------------------
  // `move`/`skill` are reused in the pre-combat phase (the interpreter detects the
  // Battle's phase and skips the combat turn-commit) — only these genuinely deploy-only
  // verbs, with no combat equivalent, stay distinct. The pre-combat → combat boundary is
  // marked by `beginBattle`, so they no longer need a "deploy kind" to be drained.
  /** Hunker for a reduced capture chance when the net's turn comes (D63). */
  | { kind: "digIn"; unit: UnitId }
  /** Lay a player trap on `pos`, consuming one kit from the shared stash (D11/D63). */
  | { kind: "placeTrap"; unit: UnitId; pos: GridCoord; effect: PlaceTrapEffect; id: string }
  /** Bind a unit captured by the closing net (D7/D63) — the deploy "enemy turn" outcome. */
  | { kind: "capture"; unit: UnitId }
  /**
   * The **pre-combat → combat boundary** (D67): logged once when the alarm trips / the
   * player commits. Flips the Battle's phase to `combat` and announces it (the
   * `battleBegan` event). {@link "./turn".replay} drains the deploy prelude up to this
   * marker, so the deploy verbs no longer need a distinct `kind` to be drained — the
   * boundary delimits the phases explicitly.
   */
  | { kind: "beginBattle" };

/** Every {@link CombatAction} discriminant. */
export type CombatActionKind = CombatAction["kind"];

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
 * driver uses this to delimit one **combat** turn's recorded actions (the pre-combat
 * prelude is drained wholesale up to the `beginBattle` boundary, so it never reaches
 * here): an `endTurn`, a `cleave` (always commits), or a `skill` with `commitTurn` left
 * default/true. A `move`, `attack`, or free-move `skill` (`commitTurn: false`) leaves the
 * turn open.
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
