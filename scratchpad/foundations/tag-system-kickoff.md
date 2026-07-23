# Tag system — focused-session kickoff prompt (design + minimal build)

**Origin:** surfaced mid-conversation while defining the finale's *special spawn condition* and the
D108 guard doctrine. The doctrine's open crux is **what sets/clears `in-combat`** (the flag that
suppresses a guard from abandoning a fight to batter a slammed seal). Defining `in-combat` well kept
pulling toward a **general tag concept** the whole game can hook on to — so we split it off into its
own focused session rather than smuggle it in under finale cover.

Read this **plus** `decisions.md` **D108** (guard doctrine + `in-combat` as "the first tag-status"),
**D41** (statuses gained a `kind` classifier — the proto-tag), **D116/D99** (the finale flank this
ultimately unblocks), and **D114 + `docs/design/implementation/conventions.md`** (the one-spelling /
registry / living-exemplar / guard-test discipline any new shared structure must follow).

---

## Why this is its own session (the motivation)

The core already carries a **scatter of ad-hoc proto-tags**:
- `src/core/units.ts` — loose per-unit booleans: `isLord`, `authored`, `thief`, `captured`.
- `src/core/status.ts` — the `kind` classifier (`"buff" | "debuff"`, D41) that statuses already carry.
- No general `hasTag` query surface exists today (only informal uses: rider tags, the clock-domain
  type-tag in `cost.ts`, the objective role tag in `authored.ts`).

So a tag system isn't a concept from nothing — it **consolidates those four booleans + the status
`kind` under one queryable surface**. That consolidation is the real prize, and it sits squarely in
the repo's current audit/conventions theme.

---

## The proposed design (our working delineation — do not relitigate the core split; refine within it)

The rule that keeps tags from just becoming "statuses again":

- **Status** = a *stateful, effect-bearing* condition. Has duration/ticks/magnitude; read by
  combat/clock hooks; the mechanical **actor**. (Unchanged — this session does not touch the status
  model's behavior.)
- **Tag** = a *classification / predicate* — a queryable label, **no inherent duration or effect**.
  One query surface, three provenances:
  - **Intrinsic** — authored on the unit/template (`non-combatant`, `boss`, `undead`; the migration
    targets `lord`/`authored`/`thief`/`captured`).
  - **Conferred** — a status stamps a tag **while active** (flanked status → `flanked` tag). A **live
    projection** of the active status, so it clears when the status clears — the status stays the single
    source of truth, no drift.
  - **Derived** — computed from world-state **on query** (`in-combat`, `adjacent-to-ally`). A **pure
    function of battle state**.

**Unified query:** `hasTag(unit, tag, ctx)` unions the three sources; `ctx` (= battle state) feeds the
derived predicates. Stays pure/deterministic — no `Math.random`, no Phaser/DOM (core discipline), and
recomputes from snapshotted state so replay (D22) is unaffected.

**The payoff (the point):** producer and consumer **decouple**. An ability / the AI / an objective hooks
`hasTag(u, "flanked")` and does **not** care whether that came from intrinsic data, an active status, or
a live computation.

---

## Scope — the finale forces a MINIMAL slice; the migration is a follow-on

Build the general **mechanism** + exactly the two tags the finale forces, as the living exemplar:
- **`in-combat`** — derived (spec below).
- **`non-combatant`** — intrinsic (a unit that *can* deal damage but is **deprioritized** as a target —
  not ignored).

**Do NOT, this session:** migrate `captured`/`thief`/`lord`/`authored` onto the tag surface (a separate,
guard-covered follow-on — not a prerequisite); turn tags into a second status engine; add a general
provides/requires-style capability engine. Keep the registry to the tags actually used.

---

## The `in-combat` working spec (from the conversation)

`in-combat(U)` is **true** iff there exists an enemy `E` such that **all** hold:
1. `U` has **dealt damage to** or **received damage from** `E` **since `U`'s last turn (inclusive)**.
2. `E` is **targetable**.
3. `E` is a **combatant** (does **not** hold the `non-combatant` tag).
4. `E` is **within striking distance**.

Anchoring the memory window to "since its last turn" is deliberate — it **self-clears on the clock**
instead of needing an arbitrary tick timer.

### Open rulings to resolve in-session (with our leanings)
- **R1 — the four clauses bind to one `E`, so the *first* engagement is "free."** An enemy stepping
  adjacent with no blows yet traded ⇒ not `in-combat` ⇒ a guard could peel toward the door instead of
  turning to fight the foe on its doorstep. **Leaning: close the gap** — `in-combat` if *either* (recent
  damage exchange with a still-valid `E`) *or* (a valid combatant enemy is within striking distance right
  now). Confirm, or keep the strict "blows must actually be traded" reading if that's the intent.
- **R2 — the window is Speed-dependent** (CT clock): "since its last turn" is shorter for a fast unit,
  longer for a slow one. **Leaning: a feature** (fast units re-evaluate more, read as more alert).
  Confirm we're happy with stickiness being Speed-dependent vs. a fixed duration.
- **R3 — escortee interaction.** Captives on the extraction path likely carry `non-combatant`, so a guard
  whose only nearby foe is a fleeing captive is **not** `in-combat` ⇒ it peels to batter the door rather
  than chase the runner. That's a real lever (raises seal-delay tension, lowers recapture pressure).
  **Leaning: intended** — `non-combatant` deliberately does **not** confer `in-combat`, so the alarm/door
  always wins a guard's attention over a runner (captives remain a valid *low-priority* attack target).
  Confirm.

---

## Repo discipline this session must honor (D114 / conventions.md)

- A **new decision record** (its own `D##`) capturing the status-vs-tag split, the three provenances, the
  `hasTag` surface, and the minimal-slice scope.
- A **canonical `TAGS` registry** — one spelling per tag, a `getTag`-style fallback — modeled on the
  living exemplar `STATUS_VISUALS` (`src/core/status.ts:285`) and `icons.ts`'s single-source registry.
- A **guard test** that enforces the registry/shape (the pattern conventions.md requires).
- **Player-facing tag names → `docs/design/glossary.md`.**
- **Core purity + determinism:** derived tags are pure fns of battle state; no `Math.random`/Phaser/DOM;
  replay (D22) recomputes from snapshotted state.
- If any tag drives a **player-facing surface** (e.g. `in-combat` shown on a unit, or the batter behavior
  it gates rendering in a scene), add/extend a **visual e2e** (the freeze-catcher doctrine, CLAUDE.md).

---

## What this unblocks (the through-line back to the finale)

`in-combat` (suppresses converge-to-door battering) → makes the **D108 guard doctrine** buildable →
makes the finale's **seal-delay** read as *fair* → the seal-delay is what the whole prison-rescue tension
(and the D99/D116 infiltration flank) rests on. This is finale-checklist crux **C1**.

---

## Key files

- **Consumer to refine:** `src/core/ai.ts` — the D103 walled-off **batter** logic (`~L70` door-break
  value, `~L132/143` the gate/target wiring, `~L307–376` "terrain-walled-off from every seen foe" probe).
  Guards: `src/core/ai.test.ts` (the batter cases). `in-combat` refines *when* a guard peels to batter.
- **Proto-tags to consolidate:** `src/core/units.ts` (`isLord`/`authored`/`thief`/`captured`),
  `src/core/status.ts` (`kind`, D41).
- **Registry exemplars to copy:** `src/core/status.ts:285` (`STATUS_VISUALS`), `src/game/icons.ts`.
- **Seal substrate the doctrine sits on:** `src/core/gates.ts`, `src/core/staging.ts`, D103–D108.
- **Docs:** `docs/design/implementation/conventions.md` (D114), `docs/design/glossary.md`,
  `docs/guides/adding-statuses.md` (the sibling authoring pattern to mirror for tags).
- **Decisions:** `decisions.md` **D108** (guard doctrine / `in-combat`), **D41** (status `kind`),
  **D116/D99** (finale flank), **D103–D107** (gates/levers/destructible seals).

---

## Approach

Plan it first (consider the memento discussion-to-plan / orchestrate workflow), **red-team it**
(`decision-adversary` — especially the R1–R3 rulings and the status/tag boundary), and keep every guard
green (`npm run build` / `test` / `sim`, and `test:e2e:*` for any player-facing surface). Log the outcome
as a new decision record and cross-reference it from the finale checklist (crux C1).
