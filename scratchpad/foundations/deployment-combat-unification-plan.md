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

1. **`DeployClock` (deployment.ts) duplicates `CTClock`'s loop** — seed/tick/
   ready/next/spend, with the enemy `front` bolted in as a pseudo-actor.
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

### Phase 2 — One clock (`DeployClock` → `CTClock`)
- Model the enemy `front` as a first-class actor on the **one** `CTClock` (a
  special unit/scheduled actor), retiring `DeployClock`'s duplicated loop.
- `BattleScene` deployment drives `battle.clock` (seeded for the deploy sub-phase)
  instead of a second clock object.
- Behaviour-preserving: same turn order, same capture-on-front's-turn cadence.
- Gate: `deployment.test.ts` + full suite green; `shots:deploy` smoke renders.

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
