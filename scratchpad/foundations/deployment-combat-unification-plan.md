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
2. **Deployment bypasses `Battle.apply`** — move/dig-in/place-trap/capture mutate
   state directly, so deployment has **no replay and no undo** (combat has both).
3. **Separate RNG** — `streamFor(run.seed,"deploy")` drawn in the scene, not via
   `Battle.roll(label)`'s draw-counter seam.
4. **Parallel scene orchestration** — `deployNextActor`/`beginDeployTurn`/
   `endDeployTurn`/`runFrontTurn` beside `onAdvance`/`beginPlayerTurn`/`endPlayerTurn`.

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

### Phase 3 — One action log (deploy verbs through `Battle.apply`)
- Add `CombatAction` variants (or a sibling `DeployAction` set) for deploy
  move / dig-in / place-trap / capture; lower them through the one interpreter.
- Route deploy RNG through `Battle.roll(label)` so the deploy sub-phase is
  replayable; bring **undo** to deployment for parity with the D60 free-move turn.
- This is the audit's `#7` graph→replay item (higher risk) — land it last, one
  verb at a time, each suite-green.
- Gate: a replay test over a deploy+battle log; undo works in the deploy phase.

## Invariants honoured throughout
- core/render split; core has no `Math.random` (`rng.test.ts`).
- ids-not-refs across any new logged command.
- Each phase is its own commit; the suite is green before each push.
</content>
</invoke>
