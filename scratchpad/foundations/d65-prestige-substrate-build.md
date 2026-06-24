# Build prompt — Prestige & transition substrate (realizes D65)

> **Status:** ready to dispatch (design settled across the Scout per-class pass; this is the build brief
> for the *shared machinery*, not the Scout's content).
> **Realizes:** **D65** (the job-growth framework — `scratchpad/foundations/decisions.md`), whose status is
> "design only — build not started." This is that build. It is **also the shared machinery the Soldier
> line called its "increment 2 prestige machinery"** — build it ONCE here; the Soldier's Elite Soldier and
> the Scout's Assassin/Thief both consume it.
> **Decision to record:** prefer a **D65 addendum** (you are literally resolving D65's own deferred
> questions — per-unit-memory shape/scope, replace-in-place mechanics, the `jobId`→`primaryJob`
> standardization — which *is* what an addendum is). If you mint a fresh record instead, the next free
> number is **D69**, **not** D67: `decisions.md` now has **D67 decided + shipped** (commit `6bd5868`,
> PR #50) and **D68 reserved** for the Scout per-class pass. Re-confirm at build time.
>
> **▸ Hardened against the code (2026-06-23).** The draft of this brief was reviewed against the live
> tree; four material corrections are folded in below and flagged inline with **(Verified)**:
> 1. **The `jobId`-read landmine is wider than the draft named** — *seven* mechanic-driving readers, not
>    two. The prescribed "non-prestiged unit unchanged" test **cannot** detect the under-scoping. See the
>    landmine section and Build §3.
> 2. **Decision-number landscape refreshed** — D67 is shipped (it *is* the deploy/combat-unification the
>    draft treated as a future parallel brief); record a **D65 addendum** (or D69). The "sequence the two
>    PRs' merges" boundary is **retired** (nothing parallel to sequence against).
> 3. **Fixtures must never enter the live event pool** — registering a fixture event in the production
>    registry shifts deterministic event selection and breaks the byte-identical sim. New invariant +
>    checklist box.
> 4. **Two event-integration details made explicit** — an offer event's `autoResolve` must *decline*
>    (agency), and "target a unit" requires the **choiceId to encode the unit** (the current
>    `choose(run,node,choiceId)` carries no unit handle). See Build §5.
>
> Line numbers below were re-verified: `stampPassives` is `jobs.ts:485` (draft said 463), `unitSkills` is
> `jobs.ts:494` (draft said 472), re-run equality is `sim.test.ts:57`, suite is ~665 today (draft said
> ~648).

## Goal (one line)

Build the **generic prestige + transition substrate** D65 designed: per-unit memory, the
`predicate → effect` grant seam, **replace-in-place** prestige, and the node-event hooks that let an
authored event **offer** a prestige and a player **accept** it — proven end-to-end with **fixtures**, with
**no Scout/Soldier content**.

## Scope rule (read twice)

> Build the **machinery**; author **none** of the per-class content.

- **IN (the shared substrate):** per-unit memory; the composable predicate kinds; the `addHeldJob` /
  `prestige` effects; replace-in-place application (carry the job's level, re-stamp passives/skills off the
  *evolved* job); `JobDef.prestige` branch data; node-event integration (offer → choice → accept, write/read
  memory); a minimal **fixture** job-pair + event that exercises every use case in tests.
- **OUT (the per-class pass that builds on this — do NOT touch):** the real **Assassin/Thief/Elite-Soldier
  `JobDef`s**, wiring `SCOUT_JOB.prestige`, and the **authored events** (thieves' guild, the traveling-
  companion chain, the convinced-assassin mentor). Those are the Scout/Soldier content passes. Your tests use
  **throwaway fixture jobs/events**, never real class content.

## Project invariants (non-negotiable)

- **Pure core / render split (D2):** all logic in `src/core/` — no Phaser, no DOM, **no `Math.random`** (any
  roll flows through a seeded stream, e.g. `streamFor(seed, label)` as `node-events.ts`/`theft.ts` do).
  There is a test that greps core for `Math.random(` (`rng.test.ts`) — keep it green.
- **Determinism:** the headless sim stays byte-identical where behavior shouldn't change (re-run equality is
  `sim.test.ts:57`, `expect(b.summary).toEqual(a.summary)`). Prestige/grants applied via the auto path must
  be seed-stable.
- **Fixtures stay out of the live registries (Verified — new invariant).** `eventForNode` picks from the
  production event pool by seed/weight; **adding a fixture `EventDef`/`StorySpec` to the global registry
  shifts which event fires for existing nodes and breaks the byte-identical sim.** Fixture jobs and events
  are **test-injected only** — pass them into the evaluator/handlers under test; never append them to
  `JOBS`, `STORIES`, or the event-def pool. (The real events that *do* enter the pool are the per-class
  pass's problem, by design.)
- **Green at every increment:** `npm run test` (~665 today, +new), `npm run build` (`tsc --noEmit && vite
  build`), `npm run test:e2e` all pass after **each** increment. Each increment self-contained + reversible.
- **Data-driven (D4 ethos):** new predicates/effects/events are **new records**, not new switch arms.
  Grants and triggers are **data**; one interpreter evaluates them. Mirror the `node-events.ts` registry
  shape and the `BATTLE_EFFECT_HANDLERS` (`skills.ts:451`) / `FORECAST_HANDLERS` (`ability-forecast.ts:314`)
  exhaustive-mapped-type pattern for any new union.

## What D65 specifies (the design to implement)

From D65 (and the Scout pass that exercised it). Implement exactly this shape:

- **One grant seam:** `grant := { when: <predicate>, then: <effect> }`, `effect ∈ { addHeldJob, prestige
  from→into }`. The *same* machinery serves base-job acquisition (breadth) and prestige (depth).
- **Composable, default-open predicate kinds:** `jobLevel ≥ N` (the default prestige floor), `charLevel ≥ N`,
  `holdsItem(x)` (Master-Seal, consumed), `atNode(x)`/event-choice, `unitId(x)`/story-flag, and
  **`unitMemory(flag)`** (linked events). They compose (all/any).
- **Prestige = replace-in-place, a diff on the base kit.** The prestige job occupies the **same slot** its
  base did (replace, **not** stack), is authored as a normal `JobDef`, and **chains** (a prestige job may
  itself carry `.prestige`).
- **Per-unit memory — the one genuinely new substrate:** a cross-node **flag bag on the unit** so a later
  event reads what an earlier one wrote (the meet-traveler → later-reveal chain). D65 deferred the exact
  shape/scope — **resolve it here: run-scoped, a `Record<string, …>` on `Unit`** (flag guild/cross-run
  persistence as a follow-on, don't build it).
- **Agency:** generic acquisition **costs a choice** — the event presents an **offer**; the player **accepts**.
  Do not auto-apply a generic prestige on threshold.

## Current seams (verify, then build on)

- **Node events** (`src/core/node-events.ts`) are a clean data registry: an `EventDef` carries `autoResolve`
  / `choices(run,node)` / `choose(run,node,choiceId)`; `eventForNode` picks deterministically;
  `resolveEvent`/`eventChoices`/`chooseEventOption` interpret. The **`story`** kind (`STORIES`,
  `StoryOutcomeSpec`, `applyStoryChoice`) is the authored-as-data choice→outcome pattern to **extend** (not
  re-invent). Events mutate `run` and return an `EventOutcome` (flat today: `goldDelta`, `moraleDelta`,
  `fatigueDelta`, `materials`, `recruited?`, `stolen?`, `summary`). **There is no prestige/grant event and no
  memory today.**
- **Run state** (`src/core/run.ts`): `run.party: Unit[]` are the *same* `Unit` objects across nodes for a run
  — so memory on a `Unit` persists run-scoped for free. `run.inventory` (`.counts`) backs `holdsItem`;
  `run.mapNodeId` backs `atNode`.
- **Job/level seams:** `Unit` has `primaryJob`, `heldJobs: JobId[]`, `jobLevels: Record<string,{level,xp}>`
  (`units.ts`). `jobLevelOf(unit, jobId)` (`leveling.ts:59`), `primaryJobOf(unit)` (`units.ts:282` =
  `primaryJob ?? jobId`). `JobDef` (`jobs.ts`) holds `skills`/`passives`; `stampPassives` (`jobs.ts:485`).
  Every `Unit` is built through `createUnit` (`units.ts:212`) — no direct object literals anywhere — so an
  optional `memory` field defaulted to `{}` is a non-breaking add.

### ⚠ The landmine — `jobId` vs `primaryJob` (Verified: wider than the draft named)

`unit.jobId` is **`readonly`** (`units.ts:141`) and is the **frozen original/authored class** — it never
changes, even on prestige. Prestige changes **`primaryJob`/`heldJobs`**, never `jobId`. So any code that
reads `unit.jobId` to decide a unit's **current effective class** is a silent no-op after prestige: the unit
keeps its **old** passives/skills/upkeep/gating.

**The deciding principle (add this to the record so the scope is decidable, not ad-hoc):**

> `jobId` = the **frozen authored/original class** (identity & bootstrap; never changes on prestige). Any
> read of a unit's **current effective class** MUST go through `primaryJobOf(unit)` / `heldJobs`. `jobId` is
> legitimate **only** for identity, authoring bootstrap, and original-class display.

**The draft named two readers (`stampPassives`, `unitSkills`). The real inventory of mechanic-driving
readers is seven** — a code audit found 23 `.jobId` reads total; 7 drive game mechanics and must be
standardized, the rest (the `readonly` declaration, the `createUnit` bootstrap, test fixtures, render
display) correctly treat `jobId` as frozen identity and stay as-is:

| File:line | Function | What silently breaks for a prestiged unit |
|---|---|---|
| `jobs.ts:485` | `stampPassives` | old passives (draft named ✓) |
| `jobs.ts:494` | `unitSkills` | old skills (draft named ✓) |
| `upkeep.ts:72` | `hasChef` | wrong food upkeep |
| `upkeep.ts:200` | `rpPerNight` | wrong rest-point banking |
| `overworld.ts:142` | `merchantFloor` | market access mis-gated |
| `economy-actions.ts:176` | `merchantSell` | merchant verb mis-gated |
| `node-events.ts:654` | `describeUnit` | wrong job name in event prose |

> **The trap (why the prescribed test is insufficient):** the brief's regression test — "a non-prestiged
> unit is unchanged by the standardization" — **structurally cannot** catch under-scoping. For every
> non-prestiged unit `primaryJobOf(u) === u.jobId`, so the two reads agree no matter how many readers you
> fixed. The gap only bites a prestiged *chef/merchant*, which the throwaway fixtures never exercise. So the
> build can go **green** with "standardization done" ticked while five of seven readers still carry the
> no-op. **Closing the landmine means fixing all seven now**, per the principle above — see Build §3.

- **No `Math.random`/`prestige`/`memory` exists in core** (greps confirm: zero `prestige`/`Prestige`
  anywhere; no `memory` field; `grant*` only refers to the unrelated XP helpers). This is greenfield on top
  of the seams above.

## The build

### 1. Per-unit memory `[CORE]`
- Add `memory: Record<string, string | number | boolean>` to `Unit` (+ `UnitSpec` optional, default `{}` in
  `createUnit`, `units.ts`). Helpers: `remember(unit, flag, value=true)`, `recalls(unit, flag): boolean`,
  `recall(unit, flag)`, `forget(unit, flag)`. Run-scoped (lives on the `run.party` unit). Pure.

### 2. The grant seam `[CORE]`
- A discriminated-union **`Predicate`** with a pure `evalPredicate(pred, unit, ctx): boolean`, where
  `ctx = { run, node? }` (so `atNode` reads `run.mapNodeId`/`node`, `holdsItem` reads `run.inventory.counts`,
  `jobLevel`/`charLevel` read the unit, `unitMemory` reads `unit.memory`). Kinds: `jobLevel{job,min}`,
  `charLevel{min}`, `holdsItem{item}`, `atNode{node}` (+ `atNodeKind` if cheap), `unitId{id}`,
  `remembers{flag}`, and composites `all{of[]}` / `any{of[]}`. Default-open.
- **`GrantEffect`** = `{kind:"addHeldJob", job}` | `{kind:"prestige", from, into}`. `Grant = {when:Predicate,
  then:GrantEffect}`.
- `eligibleGrants(unit, grants, ctx): Grant[]` and `applyGrant(grant, unit, run): GrantResult`. Keep the
  effect application exhaustive (a mapped type over `GrantEffect["kind"]`, like the skill registries) so a new
  effect kind fails the build until handled.

### 3. Prestige application — replace-in-place `[CORE]`
- `prestige(unit, from, into)`: if `from` is the unit's effective primary, set `primaryJob = into`; replace
  `from` **in place** in `heldJobs` (same index). **Carry the job's progression**: move
  `jobLevels[from] → jobLevels[into]` (the evolved job keeps its level/xp — it *is* the job evolved), drop the
  old entry. Then **re-stamp passives off the evolved primary** and ensure skills read the evolved job (see
  the landmine fix). **Guard (Verified):** refuse if the unit doesn't hold `from`, **and** refuse/short-
  circuit if the unit already holds `into` (else the move clobbers/duplicates `jobLevels`/`heldJobs`).
  Idempotent.
- **Standardize job reads — all seven, per the principle (Verified):** make `stampPassives` (`jobs.ts:485`),
  `unitSkills` (`jobs.ts:494`), `hasChef` (`upkeep.ts:72`), `rpPerNight` (`upkeep.ts:200`), `merchantFloor`
  (`overworld.ts:142`), `merchantSell` (`economy-actions.ts:176`), and `describeUnit` (`node-events.ts:654`)
  read through `primaryJobOf(unit)`/`heldJobs` instead of `unit.jobId`. This is **behavior-preserving today**
  (every existing unit has `primaryJob === jobId` via the `createUnit` default), so the sim stays
  byte-identical — **verify that assumption first** with a grep that no shipping content authors
  `primaryJob ≠ jobId`; if any does, the merchant/chef reads would shift and the determinism test will catch
  it. Add the regression test (non-prestiged unit's passives + skills unchanged) **and** — because that test
  can't see the under-scoping — at least one **prestiged-fixture** assertion per standardized path (give the
  fixture job `passives`, `restPoints`/`upkeep`, and a merchant-style id so the chef/merchant/RP readers are
  actually exercised post-prestige). Where a path can't be fixture-exercised, note it as covered-by-
  standardization in the test file so the gap is documented, not silent.
  - Render-layer `jobId` reads (guild/overworld UI job labels) are **out of scope** for this core build but
    are the same latent bug for a prestiged unit — log them as a documented follow-on for the render pass.

### 4. Prestige branches as data `[CORE]`
- Add `prestige?: { into: JobId; when: Predicate }[]` to `JobDef`. Chains fall out (a prestige `JobDef` may
  carry its own `.prestige`). The substrate provides the **field + evaluator**; do **not** populate it on any
  real job (that's the per-class pass).

### 5. Node-event integration — offer → choice → accept `[CORE]`
- Extend the **`story` data pattern** so an authored event can: (a) gate a choice on a `Predicate` (floor +
  memory + which unit qualifies); (b) **target a unit** (list eligible party members as choices); (c) on
  `choose`, either **write a memory flag** (a linked-chain step) or **apply a grant** (the prestige). Extend
  `StoryOutcomeSpec` (or a sibling spec) with optional `remember?: string` and `grant?: GrantEffect`, and the
  apply path to honor them. Extend `EventOutcome` to **report** a prestige/memory change (e.g.
  `prestiged?: {unitId, from, into}`, `remembered?: string`) so the render + run-history can react (consumers
  today: `OverworldScene`, `runloop`'s `EventResolution`/`recordEventNight`, `playtest-log`).
- **`autoResolve` must decline the offer (Verified).** Every `EventDef` is required to implement
  `autoResolve`. For agency, the offer event's `autoResolve` is a **no-op/decline** — it must NOT apply the
  grant on threshold. Only the explicit `choose` applies it.
- **"Target a unit" means the choiceId encodes the unit (Verified).** `choose(run, node, choiceId)` carries
  no unit handle and `applyStoryChoice` currently applies effects to the *whole* party. To target one unit,
  **list each eligible member as its own choice** and encode the unit in the `choiceId` (e.g.
  `prestige:<unitId>`); the apply path decodes it to pick the target. Spell this out — it's the load-bearing
  mechanic of unit-targeting, not an incidental detail.
- Keep it deterministic (auto path seed-stable) and data-driven (new opportunity events = new records). The
  fixture event used by tests is **injected into the evaluator under test, not registered in the live pool**
  (see the fixtures invariant).

### 6. Fixtures + tests `[CORE]`
Prove **every use case the Scout pass surfaced**, with **throwaway fixture jobs/events** (never real content,
never registered in the production pool):
- **Floor:** a `jobLevel ≥ N` predicate gates a fixture prestige (below N → ineligible; at N → eligible).
- **Linked-memory chain:** event A writes a memory flag; event B reads it (+ floor) to offer the prestige —
  the meet→reveal pattern, proving the memory bag end-to-end.
- **Replace-in-place:** after `prestige(from→into)` the unit's primary/heldJobs slot holds `into`, the **level
  carries**, passives/skills are the **evolved** job's, and the old job is gone.
- **Standardization-under-prestige:** a prestiged fixture unit reads the **evolved** job through the
  standardized readers (passives/skills, and — with a chef/merchant-shaped fixture — upkeep/RP/market gating),
  closing the landmine that the non-prestiged regression test can't see.
- **Agency:** the prestige does **not** auto-apply on threshold or via `autoResolve` — only on the accept
  choice.
- **Chain:** a fixture prestige job that itself has `.prestige` prestiges again (tier-1→2→3).
- **`addHeldJob`** effect adds a held job (the breadth half of the same seam).
- **Determinism:** the auto path is byte-identical across re-runs for a fixed seed, **and** the existing sim
  is byte-identical to before (fixtures not in the live pool).

## Completeness checklist (don't open the PR until every box is true)

- [ ] Per-unit **memory** persists run-scoped; helpers pure + tested.
- [ ] All predicate kinds (`jobLevel`/`charLevel`/`holdsItem`/`atNode`/`unitId`/`remembers` + `all`/`any`)
      evaluate correctly; default-open; composable.
- [ ] **Replace-in-place** verified: same slot, **level carried**, evolved passives/skills, old job gone;
      guarded against missing-`from` **and** already-holds-`into`.
- [ ] **The `jobId`→`primaryJob` standardization is done for all seven mechanic-driving readers** (not just
      `stampPassives`/`unitSkills`), the deciding principle is recorded, a non-prestiged regression test
      passes, **and** a prestiged-fixture test exercises each standardized path (the silent-no-op landmine is
      closed, not half-closed).
- [ ] `JobDef.prestige` field exists + chains work; **no real job is populated** with it.
- [ ] An authored-as-data event can gate on predicates, target a unit (choiceId-encoded), write memory, and
      apply a grant — all via data, no new switch arms; `EventOutcome` reports it; the offer's `autoResolve`
      declines.
- [ ] **Agency:** no generic prestige auto-applies on a threshold or via `autoResolve`.
- [ ] Every use case above is covered by **fixture** tests; **zero** Assassin/Thief/Elite-Soldier content;
      **no fixture is registered in the live `JOBS`/`STORIES`/event pool.**
- [ ] `npm run test` / `build` / `test:e2e` green at every increment; **sim byte-identical** (re-run *and*
      vs. pre-change golden).
- [ ] Decision/D65-addendum recorded (resolved deferred questions); **Prestige** glossary keyword added.

## Decision & glossary

- **Record the resolved deferred questions** as a **D65 addendum** (preferred) or **D69** (`decisions.md` —
  D67 is shipped, D68 is reserved for the Scout pass): per-unit memory = run-scoped `Record` on `Unit`
  (cross-run/guild persistence deferred); prestige = replace-in-place carrying job level; the
  `jobId`→`primaryJob` read-standardization **and its deciding principle** (`jobId` = frozen original class;
  effective class → `primaryJobOf`). Cite **D65** (framework), **D38/D39** (jobs/leveling), **D33**
  (acquisition — the recruit alternative already exists via the `recruiter` event; the mentor path is a
  *prestige trigger*, no recruitment work), and the **D3/D4** "effects are data, one interpreter" ethos
  (Verified: D4 is field-entities + trigger-bus; the effects-as-data pattern you're invoking is tagged D3/D4
  in `skills.ts` — cite it that way rather than as "data-driven events").
- **Glossary** (`docs/design/glossary.md`): add the **Prestige** keyword (D65 flagged it — one word per
  concept) as a new row in the canonical table (format `| Canonical | Means | Banned synonyms (and why) |`).
  Banned synonyms for the *label*: "evolve" / "promote" / "advance". (Verified: no `Prestige` entry exists
  today; the table + banned-synonym format is already established.)

## Boundaries

- **Author NO per-class content.** No Assassin/Thief/Elite-Soldier `JobDef`s, no `SCOUT_JOB.prestige` wiring,
  no thieves'-guild / traveling-companion / convinced-assassin events. Those are the **per-class passes** that
  consume this substrate. Use **fixtures** for all tests.
- This **is** the Soldier line's "increment-2 prestige machinery" — coordinate so it's built once here and the
  Soldier/Scout content both build on it (don't let a parallel Soldier pass re-build it).
- **(Verified — sequencing boundary retired.)** D67 (the deploy/combat-unification) is **already merged to
  `main`** (commit `6bd5868`, PR #50), so there is no parallel deploy/combat PR to sequence merges against.
  Branch off **current `main`** (post-D67) and build on the `jobs.ts`/`leveling.ts` state already in the tree
  (e.g. `routeCombatXp`, `usableContext`).

## Operational

- Dedicated branch off current `main` (e.g. `claude/<prestige-substrate>`), **one commit per increment**, one
  **PR to `main`**. Do **not** push to the Scout branch (`claude/practical-brahmagupta-vqoxbp`); it rebases on
  this once merged.
- Standard commit-footer + PR-footer conventions.
- Verify with `npm run test`, `npm run build`, `npm run test:e2e`, `npm run sim`.
