# Deployment ↔ Combat unification — phased plan

> Status: **in progress** · branch `claude/combat-predeployment-refactor-h3v2cf`
> Goal: make the on-map **Deployment** phase a true *phase of* `Battle`, not a
> parallel system beside it — incrementally, suite-green at every gate.

## The thesis (and the one thing that is *not* in scope)

Three phases wear the word "deployment"; only the middle one converges with combat:

| Phase | Grid? | Home | Verdict |
|---|---|---|---|
| **Pre-deployment** (camp / provisioning) | no | `OverworldScene` camp + `run/camp/upkeep` | **Stays separate** (D3) — no grid, no turn order |
| **Deployment** (on-map setup) | yes | `BattleScene` `phase:"deployment"` + `core/deployment.ts` | **Unify into `Battle`** |
| **Combat** | yes | `BattleScene` `phase:"battle"` + `core/turn.ts` (`Battle`) | the substrate to converge onto |

The off-map camp is genuinely a different space; merging it would fight D3. The
**on-map Deployment** phase, since **D63** (the closing-net model), is a
turn-based CT-clock move-and-act board phase — i.e. it already *is* combat's
substrate, implemented twice.

## What is already shared (the convergence that happened on its own)

- The `Unit` model and the live roster (`battle.units`).
- Board geometry + movement (`findPath` / `occupiedGrid` / `CombatView`).
- The **entity registry** — player traps register on `battle.entities`; combat
  springs them through the one trigger bus (D4). Cleanest seam; already unified.
- Capture/rescue state on `Unit` (`captured`/`ct`), read by combat + staging.
- CT *constants* (`deployment.ts` imports `effectiveSpeed`/`TURN_THRESHOLD`/
  `ACT_COST`/`MOVE_COST` from `clock.ts`).

## What is still a *parallel* system (the refactor surface)

1. ~~**`DeployClock` (deployment.ts) duplicates `CTClock`'s loop**~~ — *Phase 2:*
   the guarded tick-until-ready loop + the determinism comparator are now shared
   (`tickUntilReady`/`byReadiest` in `clock.ts`); each clock keeps only its own
   actor policy (the front's strict-lead tie rule is intentional, so it stays a
   distinct actor).
2. ~~**Deployment bypasses `Battle.apply`**~~ — *Phase 3:* deploy verbs
   (`deployMove`/`digIn`/`placeTrap`/`capture`) now lower through the one interpreter,
   sharing combat's log + undo; the deploy turn has **Undo** like the combat turn,
   and `replay()` reconstructs across the phase boundary.
3. **Separate RNG** — `streamFor(run.seed,"deploy")` is drawn live in the scene; the
   capture *outcome* is recorded by the logged `capture` action, so replay needs no
   re-keying. (Left as-is by design — see the Phase 3 RNG note.)
4. **Parallel scene orchestration** — `deployNextActor`/`beginDeployTurn`/
   `endDeployTurn`/`runFrontTurn` beside `onAdvance`/`beginPlayerTurn`/`endPlayerTurn`.
   Still distinct (the deploy clock is the front-aware `DeployClock`); the *verbs*
   underneath are now unified. Folding the orchestration itself is a possible future
   pass, not required for the action-path unification.

## Drift to fix regardless of refactor

- `02-deployment.md` + decision **D11** still describe the *superseded* "safe
  period → auto-retreat → per-step capture" model; the code runs **D63**.
- **D63 has no decision record** — code/tests/comments cite it; `decisions.md`
  stops at D62.

## The phases

### Phase 1 — Truth reconciliation (docs only, no behaviour change) ✅
- Write the **D63** decision record (the closing-net deployment + the convergence
  intent + this phased plan).
- Rewrite `02-deployment.md` to the implemented D63 model; mark D11
  `Superseded by: D63` and the old retreat clause superseded.
- Light-touch the design `README.md` deployment line for accuracy.
- Gate: `npm test` + `tsc --noEmit` green (no code touched).

### Phase 2 — One clock engine (shared stepping core) ✅
- **Finding that reshaped the approach:** the front is *not* cleanly a "first-class
  unit on `CTClock`." `DeployClock` deliberately gives **players tie priority** (the
  front wins only on a *strict* CT lead), and its participant set is players + a
  non-`Unit` front. Folding the front into the unit pool would change the tie rule
  and risk the 74 deploy tests + the determinism sim. The strict-lead rule is
  intentional design, so the front stays a **distinct actor**.
- **What shipped instead — extract the shared engine, not the participant model.**
  The genuinely duplicated parts were the **guarded tick-until-ready loop** and the
  **determinism comparator**, copied verbatim in both clocks. Both now live in
  `clock.ts` as `tickUntilReady(ready, canProgress, tick)` and
  `byReadiest(a, b)`; `CTClock.advanceToNextActor` and `DeployClock.next` are rebuilt
  on them. Each clock keeps its own *policy* (which actors tick, the front's
  strict-lead tie rule) — only the engine is shared, so initiative reads identically
  in either phase by construction.
- Behaviour-preserving: same turn order, same capture-on-front's-turn cadence.
- Gate met: full suite green (578, +3 engine tests), typecheck clean.
- **Deferred to Phase 3 (render-layer):** `BattleScene`'s parallel
  `deployNextActor`/`beginDeployTurn`/`endDeployTurn` vs
  `onAdvance`/`beginPlayerTurn`/`endPlayerTurn` orchestration.

### Phase 3 — One action log (deploy verbs through `Battle.apply`) ✅
- **Shipped (the audit's `#7` graph→replay item):** the deploy verbs now lower to
  `CombatAction`s — `deployMove` / `digIn` / `placeTrap` / `capture` — through the
  single `Battle.apply` interpreter, sharing combat's log + undo stack.
  - `unit.dugIn` is now battle state (snapshotted for undo, reset at staging,
    broken by moving); the scene's `dugIn` Set is gone.
  - `placeTrap` draws from a wired `stash`; the undo checkpoint snapshots the stash
    counts **and** entity membership, so undoing a trap **refunds the kit and drops
    the entity** (extended `EntityRegistry.snapshot/restore` to carry membership,
    previously flags-only).
  - `resolveFrontTurn` now *decides* the catch; the interpreter's `capture` action
    binds the unit — one mutation path.
  - `replay()` drains the (always-leading, discriminable) deploy prelude before
    seeding + driving the combat loop, so `replay(initial, log) === state` holds
    across the phase boundary.
- **Feature delivered:** the deploy turn has the same **Undo** (button + Esc) as the
  combat free-move turn — take back repositions, dig-in, and trap placement.
- **RNG note:** the front capture *outcome* is recorded by the logged `capture`
  action, so replay reproduces it from the log — no need to re-key the live
  `deployRng` to `Battle.roll` (that would only matter for a re-rolling replay,
  which the logged decision makes unnecessary).
- Gate met: core suite green (585, +7 deploy-verb/undo/replay tests); typecheck +
  `vite build` clean; **`shots:deploy` and `shots:mill` walkthroughs render with no
  page errors** (the only way to exercise the Phaser deploy scene headlessly).

## Invariants honoured throughout
- core/render split; core has no `Math.random` (`rng.test.ts`).
- ids-not-refs across any new logged command.
- Each phase is its own commit; the suite is green before each push.

## Closing the scene-test gap (follow-on)

The deploy/battle *orchestration* lives in the Phaser `BattleScene`, which the
node `core/` suite can't reach. Two layers, built phased:

- **Phase A — assertion-bearing E2E (done).** `scripts/harness.mjs` (a shared
  Chrome+Vite harness with scene-eval + real-input helpers) + `scripts/e2e-deploy-
  battle.mjs` (`npm run test:e2e`): drives the *real* scene with real tile clicks
  and Space/Escape key presses through deploy→battle, asserting outcomes (move +
  log + undo, dig-in + undo, Start Battle transition, a driven player turn). 17
  assertions, no page errors. Needs Chrome (kept out of the fast unit suite).
- **Phase B — headless interaction controller (incremental, started).** Lift the
  scene's deploy *decisions* into the fast suite. **Finding:** the heavy deploy
  mechanics were already pure in `core/deployment.ts` (clock order, capture odds,
  front resolution, safe-ground) and covered by its 74 tests — the scene was mostly
  render/animation/input glue. So the first increment extracted the two genuinely-
  stranded decisions into `core/deploy-flow.ts` (vitest-tested, +9):
  - `frontTurnStage(out, grid, camp, front)` → `capture | overrun | continue` (the
    `runFrontTurn` branch), and
  - `deployActions(ctx)` → the ordered action-row ids (the `refreshDeployButtons`
    decision).
  The scene now *renders* those choices instead of making them. Verified: unit
  suite (594), `vite build`, `test:e2e` (17 assertions), `shots:deploy` — all green.
  - **Battle phase (done).** Same finding held — the heavy combat logic was already
    pure (CT clock + `nextActor`, the AI, resolution gates). The stranded *decisions*
    moved to `core/battle-flow.ts` (vitest-tested, +13): `advanceOutcome` (the
    `onAdvance` branch: finish / ambush-pass / enemy / player), `noActionsAvailable`
    (the D55 auto-pass backstop), and `adjacentRevealedTrap` (the disarm scan). The
    scene now renders those choices. Verified: unit suite (607), build, `test:e2e`,
    `shots:mill` — all green.
- **CI (done).** `.github/workflows/ci.yml` runs build + unit suite + `test:e2e`
  (headless, on the runner's Chrome) on every PR and main push.
</content>
</invoke>
