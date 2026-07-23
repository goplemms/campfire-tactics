/**
 * The tag system (D117) — one query surface for "is this unit an X?".
 *
 * A **tag** is a *classification / predicate*, not a stateful actor. Where a
 * {@link "./status".StatusInstance} has a duration, ticks, and a mechanical effect,
 * a tag has **none of those** — it is simply *evaluated*. This is the line that
 * keeps tags from becoming "statuses again": statuses *do* something over time;
 * tags *answer a question*. The two are designed to compose — a planned provenance
 * (*conferred*, below) is a live projection of an active status — but they stay
 * different kinds.
 *
 * The prize is **consolidation**: the ad-hoc per-unit booleans (`isLord`/`authored`/
 * `thief`/`captured`) and the informal role/`kind` classifiers all want to live
 * behind one `hasTag(unit, tag, ctx)` query. This module ships the *mechanism* plus
 * the three tags the prison-break finale forces (D108); migrating the existing
 * booleans onto the surface is a deliberate, guard-covered follow-on (not built here).
 *
 * **Provenances** — a {@link TagDef} resolves through one. Two ship today:
 *  - **intrinsic** — a static authored property, read straight off {@link Unit.tags}
 *    (`non-combatant`, `garrison`). Ignores `ctx`.
 *  - **derived** — computed at query time from battle state in {@link TagContext}
 *    (`in-combat`). "Derived" reads battle state **including the D87 command log** (the
 *    `in-combat` memory window is a *history* predicate — see {@link TagContext}); it
 *    stores nothing of its own, which is why it has no duration.
 *
 * A third provenance — **conferred** (a tag true exactly while a *duration-bearing* status
 * is active, a live projection of it) — is the **documented seam, deliberately not yet in
 * code** (rev-2 YAGNI: no status-backed tag has a consumer today). Add it *with* its first
 * real consumer. Two revisit threads (owner, 2026-07-23), to settle when one pulls:
 *   1. **conferred's natural debut** is a `captured` tag projecting a future `captured`-status
 *      (the status-model indicator pass) — the honest first status→tag projection.
 *   2. **flanked-as-status.** Today flanking is *derived* by deliberate D36 design
 *      (`combat.isFlanked` is "positional and instantaneous… rather than storing it as a
 *      status"), so a `flanked` tag would be *derived*, not conferred. But re-examine whether
 *      materializing flank into a status (⇒ a conferred `flanked` tag) **simplifies later
 *      behaviors** — a suspected win worth testing before the second AI consumer lands.
 *
 * Pure and deterministic (D2/D22): no `Math.random`, no Phaser/DOM. `hasTag` is a
 * pure read, safe to call inside the AI's scoring loop.
 */

import { type Unit, isActive } from "./units";
import { manhattan } from "./combat";

/** Which of the two shipped sources a {@link TagDef} resolves through (see the module doc for the `conferred` seam). */
export type TagProvenance = "intrinsic" | "derived";

/**
 * What a **derived** tag reads. Deliberately a *narrow query interface*, not the
 * whole `Battle` — so `tags.ts` does not couple to the `CombatAction` union or the
 * scene. The live `Battle` satisfies it (M2/M3); tests supply a hand-built stub.
 */
export interface TagContext {
  /** Every unit on the field, both sides. */
  readonly units: readonly Unit[];
  /**
   * Did `unitId` and `otherId` **exchange damage** (either direction) within
   * `unitId`'s current engagement window — i.e. since the start of `unitId`'s
   * **most-recently-completed turn**? This is `in-combat` clause 1, a *history*
   * predicate the caller computes from the D87 command log (scan back to `unitId`'s
   * previous `endTurn`). `unitId`'s own not-yet-executed damage this turn does not
   * count. The window is Speed-anchored **by design** (R2): a faster unit's window
   * spans fewer real ticks, so it drops out of combat sooner.
   */
  exchangedDamageSince(unitId: string, otherId: string): boolean;
}

/** A tag definition — data, one per classification. */
export interface TagDef {
  /** Stable id, e.g. `"in-combat"`. The registry keys off this. */
  readonly id: string;
  /** Display name (glossary-facing). */
  readonly name: string;
  /** Which source resolves it. */
  readonly provenance: TagProvenance;
  /**
   * For a **derived** tag: the pure predicate over `(unit, ctx)`. Required iff
   * `provenance === "derived"`.
   */
  readonly derive?: (unit: Unit, ctx: TagContext) => boolean;
}

// --- The tags this session ships --------------------------------------------

/**
 * `in-combat` (derived) — the sole off-switch on the D108 guard door-doctrine: a
 * garrison unit trading blows does **not** peel off to its objective (key/batter the
 * seal). See {@link deriveInCombat} for the five clauses.
 */
export const IN_COMBAT = "in-combat";
/**
 * `non-combatant` (intrinsic) — a unit **deprioritized as a target**, and one that
 * **does not confer `in-combat`** (clause 3): a guard whose only nearby foe is a
 * fleeing captive stays free to answer the door. Deprioritized, **not ignored** — a
 * non-combatant may still deal damage and remains a valid *low-priority* target.
 */
export const NON_COMBATANT = "non-combatant";
/**
 * `garrison` (intrinsic) — marks a finale-garrison unit as **door-driven** (D108):
 * the M3 planner reorder that lets its objective outrank attacking a reachable,
 * un-engaged foe reads this tag. Order-less generic bandits lack it and keep the
 * default "fight what's reachable" behavior; an explicit `hold` order still wins.
 */
export const GARRISON = "garrison";

/**
 * `in-combat(U)` — true iff some enemy `E` satisfies **all** clauses (ratified
 * 2026-07-23; see `scratchpad/foundations/tag-system-kickoff.md`):
 *  1. `U` and `E` exchanged damage since `U`'s last completed turn (via `ctx`);
 *  2. `E` is targetable (active — alive, uncaptured, on the field);
 *  3. `E` is a combatant (does **not** hold {@link NON_COMBATANT});
 *  4. `E` is within `U`'s striking distance (`attackRange`);
 *  5. `U` is still capable of dealing damage to `E` (see {@link canDamage}).
 *
 * Purely a read of battle state (positions/sides/tags + the `ctx` history query) —
 * proximity alone never engages, and `U` is freed the moment the exchange lapses on
 * the clock (no stored timer).
 */
function deriveInCombat(u: Unit, ctx: TagContext): boolean {
  if (!isActive(u)) return false;
  // Clauses ordered cheapest-first; the log-scan history query is last.
  return ctx.units.some(
    (e) =>
      e.side !== u.side &&
      isActive(e) && // (2) targetable
      !hasTag(e, NON_COMBATANT, ctx) && // (3) combatant
      manhattan(u.pos, e.pos) <= u.attackRange && // (4) striking distance
      canDamage(u, e) && // (5) U can still land a hit
      ctx.exchangedDamageSince(u.id, e.id), // (1) the engagement memory
  );
}

/**
 * Clause 5 — can `U` currently land a damaging hit on `E`? Today: `U` has a nonzero
 * attack (there is **no damage-type / immunity model** in combat yet, so an "immune"
 * defender cannot exist). This is the seam a future immunity system plugs into — an
 * enemy `U` cannot meaningfully damage does not pin `U` in combat, even adjacent.
 */
function canDamage(u: Unit, _e: Unit): boolean {
  return u.attack > 0;
}

/**
 * The tag registry (D114 §Registries): keyed off `.id`, getter returns `undefined`.
 * Object-literal form ⇒ duplicate ids are impossible at load; `registry-contracts.test.ts`
 * walks key⇔id. A stronger exemplar than a single tag — three tags across two provenances.
 */
export const TAGS: Record<string, TagDef> = {
  [IN_COMBAT]: { id: IN_COMBAT, name: "In Combat", provenance: "derived", derive: deriveInCombat },
  [NON_COMBATANT]: { id: NON_COMBATANT, name: "Non-Combatant", provenance: "intrinsic" },
  [GARRISON]: { id: GARRISON, name: "Garrison", provenance: "intrinsic" },
};

/** The def for a tag id, or `undefined` if unregistered (the registry-getter convention). */
export function getTag(id: string): TagDef | undefined {
  return TAGS[id];
}

/**
 * The unified query: does `unit` hold `tag`? Resolves through the tag's provenance.
 *
 * - **intrinsic** → reads {@link Unit.tags} (ignores `ctx`).
 * - **derived** → the tag's `derive(unit, ctx)`; **requires `ctx`** and throws without it.
 *
 * An unregistered `tag` id **throws** (fail-loud, D116) — call sites pass the exported
 * id constants, so this only fires on a genuine bug, never on a validly-absent tag.
 */
export function hasTag(unit: Unit, tag: string, ctx?: TagContext): boolean {
  const def = TAGS[tag];
  if (!def) throw new Error(`hasTag: unknown tag "${tag}" (not in TAGS)`);
  switch (def.provenance) {
    case "intrinsic":
      return unit.tags.includes(def.id);
    case "derived":
      if (!ctx) throw new Error(`hasTag: derived tag "${tag}" requires a TagContext`);
      return def.derive!(unit, ctx);
  }
}
