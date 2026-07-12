# Kickoff — Status-model generalization (timed + scaled/banded, cross-phase)

> **Status: DESIGN — kickoff brief, no build.** The design target and the four red-team
> revisions are **canon** (Epic [#171], Roadmap candidate in
> [`decisions.md`](decisions.md) §Roadmap). This brief graduates that candidate into a
> **risk-ordered, use-site-gated phased plan**. Per the owner ruling (2026-07-12), this track
> runs **design-only** for now: **no gameplay code** until a concrete use-site pulls a phase.
> Each phase is authored as a full `## D##` entry *when its build starts*; child issues mint
> *as phases activate* (Epic #171's own policy), not up front.

## Why this track exists

Statuses today are a **single-shape, combat-only** layer: a `StatusInstance`
([`status.ts:21`](../../src/core/status.ts)) is `{id, name, duration, kind?, data?}`, ticked
once per unit turn in the combat turn-open ([`turn.ts:560`](../../src/core/turn.ts)). Two things
it can't yet express:

1. **Cross-phase statuses** — a status that lives (and decays) in **deployment** or the
   **overworld/night**, not just inside a fight.
2. **Banded-accumulating conditions** — a **magnitude** that accrues on re-apply and decays over
   time, whose *effect* keys off a named **tier** (tiered poison, exhaustion), rather than a flat
   turn countdown.

**Design target (canon, Epic #171):** a `StatusInstance` gains a **cadence**
(`turn | night | node | never`) + two **shapes** — `timed` (today's countdown) and `scaled`
(a magnitude banded into named tiers via the existing [`bandFor`](../../src/core/num.ts), accruing
on apply + decaying per tick; effects key off the tier).

**Orthogonal to the arc.** This is foundational plumbing, not arc content. Nothing currently
active (Wave-0 topology #168, the finale #169) demands a status — which is exactly why it runs
**use-site-gated**, not on a build clock.

## The four revisions (canon — do not relitigate)

1. **Decoupled from the taste.** D90 shipped on the `captured` **boolean**; `captured`→status is
   at most an **optional epilogue** here, never a prerequisite of anything.
2. **Concrete-first (YAGNI).** Build the first `scaled` consumer **hand-rolled** via `bandFor`
   (the canonical example: **tiered poison**). **Extract** the general `scaled` shape only when a
   **second** scaled consumer appears — and by the same rule, don't build even the *first* one
   speculatively; wait for its use-site.
3. **Fatigue: coexist, likely don't migrate.** [`fatigue.ts`](../../src/core/fatigue.ts) is a raw
   number on `Unit`, banded via `bandFor`, but its decay is genuinely bespoke
   (tier-floor-step-per-night · Deep-Rest-wipe · Tier-0 resolve gate · raw story deltas across
   ~10 systems). Forcing it into the model **fakes generality**. It stays as-is; the model
   coexists beside it.
4. **Sequence by replay cost.** Combat-cadence decay is reconstructed for free in the
   `tickStatuses` turn-open path ([`turn.ts:560`](../../src/core/turn.ts)); **overworld/night**
   cadence needs **new `snapshotRun` serialization** — the snapshot
   ([`run.ts:451`](../../src/core/run.ts)) persists seed/route/rng/night/overworld and **not**
   `statuses` (nor the party). `captured`→status is replay-safe but a ~30-site migration +
   snapshot-shape edit.

### One sharpening of revision 4 (verified 2026-07-12)

Deploy is **not** literally free. During deploy, statuses are **read** but never **ticked** —
`tickStatuses` is called *only* from the combat turn-open ([`turn.ts:560`](../../src/core/turn.ts));
deploy reads e.g. `SWIFT` at [`deployment.ts:260`](../../src/core/deployment.ts) and runs its own
flow ([`deploy-flow.ts`](../../src/core/deploy-flow.ts)) with no status tick. So **deploy-cadence
decay is replay-safe** (deploy is a deterministically reconstructed phase, like combat) but needs a
**new deploy-side tick hook + goldens** — cheap, not zero.

## The seams (facts behind the plan)

| Seam | Where | State today |
| --- | --- | --- |
| `StatusInstance` | `status.ts:21` | `{id, name, duration, kind?, data?}` — one *timed* shape, combat-only. Effects hand-read via `hasStatus`/`statusAmount`/`kind`. |
| Tier banding | `num.ts:55` `bandFor` | Generic floor-table bander; already the spine of fatigue's tiers. A hand-rolled `scaled` poison reuses it directly. |
| Combat tick | `turn.ts:560` | The one `tickStatuses` call site (per unit turn-open). Combat-cadence decay is reconstructed here on replay. |
| Deploy | `deploy-flow.ts` / `deployment.ts:260` | Reads statuses, does **not** tick them. Its own flow. |
| Fatigue | `fatigue.ts` | Bespoke raw-number meter; **coexists**, does not migrate (rev 3). |
| Snapshot | `run.ts:451` `snapshotRun` | Persists seed/route/rng/night/overworld — **not** `statuses`, **not** the party. Overlaps the open save-model design session (#117). |
| `captured` | `units.ts:257` + ~30 sites | Boolean. Optional epilogue migration (rev 1). |

## The phased ladder (risk-ordered — a menu, not a fixed schedule)

The phases are ordered by **replay/serialization cost** (rev 4). But **the use-site pulls the
order** — a phase activates when a concrete consumer wants it; replay-cost is the **tiebreaker +
the risk label**, not a gate. If the first genuine use-site is an overworld condition, you pay
Phase 3's cost first (and fold in #117). Each phase is a **lazy extraction**, not an upfront
framework: the general shape/field is factored out of the hand-rolled concrete only once a
**second** consumer of that axis exists (rev 2, applied to both the *shape* and the *cadence*
axis).

- **Phase 1 — combat · turn-cadence · `scaled` (tiered poison). Replay-free.**
  The concrete-first seed (rev 2). A magnitude on the status accrues on re-apply and decays in the
  existing turn-open tick; the effect keys off a **poison-specific band table** via `bandFor`.
  **No** general `scaled`/`cadence` field yet — hand-rolled. **Activates when** a fight/ability
  wants tiered poison.

- **Phase 2 — deploy-cadence status. Replay-safe, cheap (not free).**
  Introduces the **first non-`turn` cadence** — a status that ticks on the **deploy** clock. Needs
  a **new deploy-side tick hook** + deploy goldens (the sharpening above). Still no `snapshotRun`
  change. **Activates when** the deployment deep-dive (the parked alarm/detection model, C5) or a
  deploy condition wants one.

- **Phase 3 — overworld/night-cadence status. Needs serialization — fold into #117.**
  The first status that **persists across nodes** ⇒ the first that requires `snapshotRun` to
  serialize `statuses`. This is the real infra cost, and it **belongs with the save-model design
  session #117** (RunSnapshot is already partial by design). **Activates when** a cross-node
  condition (a lingering ailment, or exhaustion-as-status *if* rev 3 is ever revisited) wants one.

### The generalization is emergent, not a Phase 0 build

There is **no "build the general status model" milestone.** The `cadence` enum and the general
`scaled` shape become first-class fields on `StatusInstance` **only as the byproduct** of the
second consumer on each axis forcing the extraction. If Phase 1's poison and Phase 2/3's first
cross-phase status happen to both be `scaled`, the shape- and cadence-extractions may land together
as a single refactor. That's fine — the plan optimizes for *not* abstracting ahead of evidence.

## Parked — deliberately *not* on the ladder (owner-ruled 2026-07-12)

Two things that felt like they belonged here but don't — recorded so they aren't rediscovered
from scratch:

- **`captured`→status is representation, not capability — revisit on an *indicator* pass, not a
  freeing one.** The value it *does* carry is **information surfacing**: "Captured" showing up in
  the same tracker/badge lane as Poisoned/Exhausted (owner: "makes a lot of sense in terms of
  information surfacing"). What it does **not** buy is any freeing-mechanism flexibility (see
  below). It's a ~30-site `u.captured`→`hasStatus` migration + snapshot-shape edit that is
  **capability-neutral** and **never a prerequisite** (rev 1). And its end-condition is
  **event-driven** (freed / battle won / roster-abandon / encounter-over), *not* a cadence tick —
  the same "bespoke, resists the model" tell as fatigue (rev 3). So it's a `never`-cadence
  representational refactor whose trigger is *"we're adding more status indicators and want capture
  to surface uniformly,"* not this track's critical path.

- **New freeing mechanisms (key, etc.) are a `ReleaseRequirement` concern — off this track
  entirely.** "What it takes to free a captive" already lives in the extensible union
  `ReleaseRequirement` (`units.ts:179`) evaluated by `canRelease` (`deployment.ts:53`) — shipped by
  D90 as `{ kind:"reach" } | { kind:"lockpick" }`, with a `key` variant explicitly reserved
  (`units.ts:176`). Adding one is a **two-edit** change (a union variant + a `switch` arm), gated by
  the compiler, needing **no status system and no `captured` migration**. It belongs with the
  content that wants it (Wave-0 / finale), not with the status-model epic. The *lock* axis
  (`ReleaseRequirement`) and the *state* axis (`captured`) are independent; generalizing the latter
  does not touch the former.

## Child issues (shape only — mint on activation, per Epic #171)

Not created yet (design-only). Ready to mint when a phase activates:

- **#171-a — Phase 1: tiered poison (`scaled`, combat, hand-rolled via `bandFor`).**
- **#171-b — Phase 2: deploy-cadence status + deploy-side tick hook + goldens.**
- **#171-c — Phase 3: overworld/night-cadence status + `snapshotRun` serialization (with #117).**
- **#171-x — the lazy extraction: general `scaled` shape / `cadence` field** — opened only when a
  *second* consumer on an axis exists (references whichever two phases forced it).

*(`captured`→status is **not** a child of this epic — it's the parked, indicator-triggered
representational refactor above; freeing mechanisms are a `ReleaseRequirement` content concern.)*

## Working rules & guards (every build PR, when phases activate)

- Pure logic in `src/core` (headless, tested); the scene stays a thin renderer.
- Determinism: no `Math.random` in `core/`.
- Guards green: `tsc` · `vitest run` · `npm run build` · e2e · `npm run sim` (re-pin the digest
  where routing/rewards/status-decay move).
- Fatigue is **not** touched (rev 3).

## Pointers

- **Epic:** [#171] — Status-model generalization (timed + scaled/banded, cross-phase).
- **Roadmap candidate:** [`decisions.md`](decisions.md) §Roadmap — authored as a full `## D##`
  when a phase's build starts.
- **Adjacent design session:** #117 — the save model (RunSnapshot is partial); Phase 3 folds in.
- **Arc canon (orthogonal):** [`hollow-mill-backhalf-arc-plan.md`](hollow-mill-backhalf-arc-plan.md)
  — this track is foundational, not part of the arc waves.
- **Visual harness (a future consumer):** #170 — an isolated scene to screenshot a new status.

[#171]: https://github.com/goplemms/campfire-tactics/issues/171
