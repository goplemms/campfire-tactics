# Kickoff — The tag system (classification surface: `hasTag(unit, tag, ctx)`)

> **Status: DESIGN — reconstructed brief.** The original brief was authored in a prior
> (local/desktop) session and never committed; this container was cloned fresh, so it was
> **lost**. This file is a faithful reconstruction from the in-repo canon — **D108**
> (`decisions.md`), **Epic #171** (`status-model-kickoff.md`), and the code substrate — plus the
> owner's summary of the intent. The three open rulings (**R1–R3**) carry *proposed* resolutions
> below; the prior session's exact leanings did not survive, so they are **owed a confirm** before
> build (see "Open rulings"). Branch: `claude/tag-system-foundations-9k29hd`.

## Why this is its own session

This is **consolidation, not a from-scratch concept.** Four classification booleans already live
scattered on `Unit` (`units.ts`) — `captured`, `thief`, `isLord`, `authored` — each read by an
ad-hoc `u.<flag>` predicate at its call sites, and the status layer already carries a `kind`
classifier (`status.ts:18`, `debuff | buff`) that cross-cutting consumers hand-read. The tag system
gives all of that **one surface**: a single `hasTag(unit, tag, ctx)` query and a `TAGS` registry,
so "is this unit an X?" has one spelling instead of five. `in-combat` is the **first new tag** and
the concrete use-site (D108) that pulls the surface into existence.

## The delineation — status vs. tag

The parked status-model track (#171) kept calling `in-combat` a "tag-status," which blurred two
genuinely different things. This session draws the line:

| | **Status** | **Tag** |
| --- | --- | --- |
| Nature | a **stateful, effect-bearing actor** — it *does* something over time | a **classification / predicate** — it *is* an answer to "is this unit an X?" |
| Duration | has one (timed countdown, or the #171 `scaled`/cadence axes) | **none** — a tag is evaluated, never ticked |
| Examples | Poisoned, Slowed, Guarded, Exposed | `in-combat`, `non-combatant`, (later) `captured`, `thief`, `lord`, `authored` |
| Home | `status.ts` (`StatusInstance`, `applyStatus`, `tickStatuses`) | `tags.ts` (`TagDef`, `TAGS`, `hasTag`) — **new** |

A tag is not a lightweight status and a status is not a durable tag. They **compose**: one of a
tag's provenances is *conferred by an active status* (below).

### The three provenances of a tag

`hasTag(unit, tag, ctx)` resolves a tag through exactly one of three provenance kinds, declared on
the `TagDef`:

1. **intrinsic** — a static property of the unit's authored identity. Read straight off the unit /
   its job. (`non-combatant`, later `thief`/`lord`/`authored`.)
2. **conferred-by-active-status** — the unit *currently carries* a status that confers the tag. The
   tag is true exactly while that status is live. (Bridges to `status.ts`; the seam that lets a
   future `captured`-as-status still answer `hasTag(u, "captured")`.)
3. **derived** — computed at query time from board/battle state in `ctx`, **stored nowhere**. This
   is why a derived tag has no duration: it is re-evaluated freshly on every read. (`in-combat`.)

The `ctx` argument carries whatever a derived tag needs (the battle / grid / foe set). Intrinsic and
conferred tags ignore it; derived tags require it. `hasTag` is **pure and deterministic** — no
`Math.random`, no clock mutation, safe to call inside the AI's scoring loop.

## Minimal slice — what this session actually ships

The finale (D108's pull) forces exactly **two** tags:

- **`in-combat`** — *derived*. The single off-switch on the guard door-doctrine (D108): a guard
  trading blows does **not** peel off to answer the sealed door. `ai.ts`'s existing batter drive
  (ai.ts:368–392, `doorBreak`/`gateTarget`) is the consumer — it gates on `!hasTag(unit, "in-combat", ctx)`.
- **`non-combatant`** — *intrinsic*. An escortee / freed prisoner / camp-only job (Cook, Merchant)
  is a non-combatant by identity; it interacts with `in-combat` (see **R3**).

**Explicitly a flagged follow-on, NOT a prerequisite** (per D108 + #171 rev-1): migrating the four
existing booleans (`captured`, `thief`, `isLord`, `authored`) onto the tag surface. That's the
~30-site `captured` rework #171 already flagged; it is **capability-neutral** and sequenced apart.
This session introduces the *vocabulary* and its two first inhabitants — nothing more.

## `in-combat` — the spec

> The prior session's verbatim spec was lost with the file. This is the reconstructed intent,
> consistent with D108's doctrine and the tag delineation above. **The set/clear semantics are
> R1–R3 — confirm before build.**

`in-combat` is **derived, purely positional, evaluated at decision time**:

> A unit is `in-combat` when a **combat-capable live enemy** is within its **engagement range**
> (adjacent for melee; `attackRange` generalizes it), read fresh from `ctx` at query time.

Being purely positional (no stored "attacked-this-turn" memory) is what keeps it a *tag*, not a
status — there is nothing to tick or serialize. It also makes the derivation Speed-independent and
gap-free by construction; see the rulings.

## Open rulings (the crux D108 owed — resolve, don't assume)

D108's one owed crux was *"what sets and clears `in-combat`."* The prior session split it into three
edges and recorded leanings; those leanings were lost. Proposed resolutions, each flowing from the
"purely positional, decision-time" definition:

- **R1 — the first-engagement gap.** *Question:* on the tick a foe first steps adjacent but neither
  has acted, is the guard already `in-combat` (stays and fights) or still free (peels to the door)?
  *Proposed:* **already `in-combat`.** Proximity is symmetric and read at decision time, so a foe
  stepping into engagement range suppresses the door-drive **immediately** — there is no action-based
  gap because the tag never depends on who has swung. Closes R1 by construction.

- **R2 — the Speed-dependent window.** *Question:* if `in-combat` cleared after "no adjacent foe for
  N *ticks*," a fast unit would flicker in/out between a slow foe's turns — a window whose length
  depends on Speed. *Proposed:* **no tick-decay window at all.** The tag clears the moment no
  combat-capable foe is in range, evaluated fresh — so it is **Speed-independent**. If we ever want
  stickiness (a just-disengaged foe still pins you briefly), it must be counted in **unit-turns /
  actions**, never CT ticks, to stay Speed-fair. For the minimal slice: purely positional, no window.

- **R3 — escortee / non-combatant interaction.** *Question:* an escortee (intrinsic `non-combatant`)
  cowering adjacent to a guard — does that make the guard `in-combat` and stop it answering the door?
  *Proposed:* **no.** The derived relation counts only **mutually combat-capable** adjacency: a
  `non-combatant` neither *is* `in-combat` itself nor *confers* it on a foe. So an escortee cannot
  tarpit a guard against the sealed door, and a freed prisoner isn't mislabelled as fighting.

These three are mutually reinforcing: `in-combat` = "a **combatant** enemy is within engagement
range, read at decision time, purely positional." R1/R2/R3 all fall out of that one sentence.

## D114 discipline (the build contract)

- **Own decision record.** A full `## D##` entry in `decisions.md` (next id after D116) authored when
  the build lands — the tag/status delineation, the three provenances, the `in-combat` spec, and the
  R1–R3 resolutions as ratified.
- **`TAGS` registry + guard** (conventions.md §Registries): a `TagDef` record + const registry keyed
  **off `.id`** (never hand-duplicated), getter returning `undefined`, duplicate ids **throw at load**;
  covered by `registry-contracts.test.ts`'s key⇔id walk (or a sibling `tags.test.ts`). Exemplars to
  copy: `jobs.ts` `SKILLS` (load-time collision check), `status.ts` `STATUS_VISUALS`, `game/icons.ts`.
- **Glossary.** Player-/design-facing wording for `in-combat` and `non-combatant` in
  `docs/design/glossary.md`.
- **Purity / determinism.** `tags.ts` lives in `src/core` — headless, no Phaser/DOM, **no
  `Math.random`**; `hasTag` is pure. The grep guard already enforces the RNG rule.
- **Visual e2e (NOT optional).** The door-doctrine is a *player-clicked* finale surface: a guard
  peeling to / holding off the sealed door is a rendered behavior. Add/extend a visual e2e
  (`scripts/e2e-*.mjs` via `scripts/harness.mjs`) so an uncaught scene exception reads as a caught
  failure, not a freeze (CLAUDE.md's cautionary tale). The core suite + sim never render the guard
  choosing the door.

## Key files

| Role | File |
| --- | --- |
| The consumer | `src/core/ai.ts` — the batter drive (ai.ts:368–392: `doorBreak`, `gateTarget`, `breakableDoors`) gates on `!hasTag(u, "in-combat", ctx)` |
| New home | `src/core/tags.ts` (+ `tags.test.ts`) — `TagDef`, `TAGS`, `hasTag`, the three provenance kinds |
| Registry exemplars | `src/core/jobs.ts` `SKILLS`, `src/core/status.ts` `STATUS_VISUALS`, `src/game/icons.ts` |
| Status seam (provenance 2) | `src/core/status.ts` (`StatusInstance`, `kind`) |
| Consolidation targets (follow-on, not now) | `src/core/units.ts` (`captured`/`thief`/`isLord`/`authored`) |
| Registry guard | `src/core/registry-contracts.test.ts` |
| Conventions | `docs/design/implementation/conventions.md` §Registries · Glossary `docs/design/glossary.md` |

## Through-line

`in-combat` graduates Epic #171's parked status-model track at a concrete use-site (D108), and it is
the off-switch that makes the finale's **guard door-doctrine** fair — the crux the finale (arc **C1**
lineage) needs before its timer feels intentional rather than an accident of the AI's targeting model.
The tag surface it introduces is the one place the game will answer "is this unit an X?" from here on.
