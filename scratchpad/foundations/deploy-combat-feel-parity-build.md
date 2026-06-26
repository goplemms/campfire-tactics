# Build brief — Deployment ↔ Combat: feel/render parity (the shared scene path)

> **Status (updated 2026-06-26):** **largely landed.** PR #66 (D67 substrate unification)
> shipped **#1** (combat FX + log in deployment, via `wireBattleFx`), **#2** (the deploy
> reach wash + hover path), and the cleanly-shared half of **#3** (Search / Disarm /
> click-ahead / Undo folded onto `BoardCtx`; the `pushTrapVerbs` + `readStepTraps` spines).
> The follow-up PR here finished **#3's movement half**: `deployMove` + `playerMoveStep`
> collapsed into one **weighted** `moveStep` over the one `moveBudget` (raw-vs-weighted drift
> fixed; `deployMoveBudget` / `deployReachByKey` / `recomputeDeployReach` retired). **Still
> open:** only the deliberately phase-specific rows the D67 brief calls out as *not* worth
> merging (`refreshDeployButtons`/`showSkillButtons`, `castDeploySkill`/`commitSkill`) and
> the deferred D67 #10–12 structural fold below. Historical plan retained for the record.
>
> **Relationship to prior work:** the **data/core** substrate is already shared (D67
> increments 1–9 landed — `availableSkills(unit, ctx)`, the `deploySkill` cast verb,
> `moveBudget()`, and the D63 shared action-log/undo/replay). This brief is the
> **render-layer** companion: give the on-map **Deployment** phase the combat
> functionality it's still missing, and collapse the parallel **scene** methods into one
> context-parameterized path. It does **not** require the deep structural fold
> (D67 #10–12: `DeployClock`→`CTClock`, RNG consolidation, controller merge) — that stays
> a separate, determinism-gated follow-on (see "Out of scope" + `d67-substrate-
> unification-build.md`).

## Read first (grounding)
- `scratchpad/foundations/d67-substrate-unification-build.md` — the substrate audit (the
  "10 forks") + what already landed. **This brief assumes #1–9 are done; verify.**
- `scratchpad/foundations/deployment-combat-unification-plan.md` — the historical D63
  phases 1–3 (shared clock engine, shared action log/undo/replay).
- `docs/design/02-deployment.md` (the capture-wave model — the phase-specific layer to
  preserve) and `docs/design/03-combat.md`.
- `src/game/scenes/BattleScene.ts` — both phases live here; the parallel methods are the
  refactor surface.

## Goal (one line)
Deployment should expose the **same moment-to-moment functionality as combat** (damage
feedback, the combat log, reach/path visualization) and run through the **same scene
helpers**, with only the genuinely **phase-specific** behavior branching.

## The scope rule
> Pre-combat and combat **share their render/interaction path**; only phase-specific
> behavior branches. When a behavior exists in combat but not deployment, the default is
> to **share it**, not to re-implement it — unless it's on the preserve list below.

## Phase-specific layers to PRESERVE (do NOT dissolve)
- **Capture-wave:** campfire safe core, the enemy danger front + per-turn growth, the
  capture roll on the front's turn, **Dig In**, the deploy **risk forecast**
  (`deployForecast`), and the **alarm → battle** transition. (`core/deployment.ts`.)
- **Engagement is combat-only:** no attacks / offensive skills during deployment (the
  stealth/alarm invariant). The deployment preview must never offer a strike.
- **Concealment veil** (`CombatView.concealEnemies`, lifted at `startBattle`).
- **AI / win-lose** are combat-only.

## Current state — verified (file:line)
- **Combat FX + combat log are battle-only.** The damage/heal/defeat/turnStart/trapSprung
  bus listeners attach **only in `startBattle`** (`BattleScene.ts:1058–1076`), not in
  `enterDeploy`. ⇒ a unit that **springs a concealed trap during deployment** takes the HP
  hit with **no floating number and no log line** — silent. In battle the identical hit
  floats `-N` and logs it.
- **No reach visualization in deployment.** The blue reach wash + lit hover-path live in
  `CombatView.drawPreview`, called only on the battle path (`drawPreview` early-returns
  when `phase !== "battle"`). Deployment computes `reachableTiles` **only** for the
  focus-card risk forecast (`BattleScene.ts:~2389`), never to light the board. Now that a
  deploy turn moves **tile-by-tile** (`deployMoveBudget`), the player can't see how far
  they may step.
- **Parallel render twins** (same shape, two copies):
  `deployMove`(`:939`)↔`playerMoveStep`(`:1907`), `doDeploySearch`(`:766`)↔`doSearch`(`:1376`),
  `doDeployDisarm`(`:779`)↔`doDisarm`(`:1389`), `undoDeployTurn`(`:613`)↔`undoTurn`(`:1968`),
  `processDeployQueuedClick`(`:1797`)↔`processQueuedClick`(`:1784`),
  `refreshDeployButtons`(`:686`)↔`showSkillButtons`(`:1272`),
  `castDeploySkill`(`:752`)↔`commitSkill`(`:1513`).

## Build plan — ordered, tested increments
> One commit per increment; `npx tsc --noEmit` + `npx vitest run` + `npm run build` +
> `npm run test:e2e` green after **each**. `src/core` = `[CORE]`, `src/game` = `[RENDER]`.
> Add an e2e assertion (and a screenshot) when locking each new behavior.

### 1 — Combat FX + log in deployment `[RENDER]` (highest feel value, low risk)
Wire the `unitDamaged` / `unitHealed` / `unitDefeated` bus listeners so deployment trap
springs float damage and write to the combat log.
- **Pitfall — attach once.** `this.battle.bus` is created per encounter (`startEncounter`).
  Move the listener wiring to a single point that runs before deployment (e.g. end of
  `rebuildBoard`/`startCombatNode`, or `enterDeploy`) and **delete the duplicate block in
  `startBattle`** so battle doesn't double-fire. `turnStart` headers are combat-only
  (deployment has no per-unit "— Name —" cadence worth logging) — leave that one in
  `startBattle`, or gate it.
- Verify the existing `checkTrapSprings` / `deployMove` damage path now surfaces a floater
  + a log line during deployment.
- **e2e:** drive a deploy step onto a known concealed trap (the L3/`snares` field, or force
  one) and assert a floater/log entry appears, or assert via a bus spy that `unitDamaged`
  is observed in `phase==="deployment"`.

### 2 — Reach wash + hover path in deployment `[RENDER]` (feel, low risk)
Light the deploy actor's reachable tiles (for its **remaining** `deployMoveBudget`) and the
hover path, reusing the battle path-read — **without** the strike telegraph / enemy intents
(engagement is combat-only).
- Likely cleanest: factor the reach/hover-path portion of `CombatView.drawPreview` so it can
  render for the deploy actor (a `mode: "deploy"` that skips strike/intent), called from the
  deploy redraw (`drawZones` / `onPointerMove` deploy branch). Layer the blue reach wash over
  the green/red deploy zones — **verify visually** (screenshots) that it reads (adjust alpha
  if it muddies the zone washes).
- Deployment already tracks `deployHoverTile`; reuse it for the lit path.
- **e2e:** on a deploy turn, assert reachable tiles are painted (e.g. a reach graphic is
  non-empty) and a hover lights a path.

### 3 — Consolidate the cleanly-identical render twins `[RENDER]` (refactor, medium)
Merge the twins that differ only by phase into one context-parameterized helper each; keep a
**thin** phase branch where behavior genuinely differs. Start with the near-identical ones
(lowest risk): **Search**, **Disarm**, **click-ahead** (`processQueuedClick`/
`processDeployQueuedClick` already share the `queuedTile` field), then **undo**. Treat
movement (`deployMove`/`playerMoveStep`) and the action row
(`refreshDeployButtons`/`showSkillButtons`) carefully — they diverge on the capture-wave and
the one-Act economy; only unify the shared spine, leave the phase-specific bits as branches.
- Behavior-preserving: the full e2e (deploy + battle stages) must stay green unchanged.

## Out of scope (separate follow-on — do NOT attempt here)
**D67 #10–12** — fold `DeployClock` into `CTClock` (front as a strict-lead-tie tempo
source), consolidate `deployRng` + `spotRng` through `Battle.roll`, and merge
`deployNextActor`/`onAdvance` into one controller. These are **determinism-sensitive**; the
D67 brief says land them last behind a golden-trace guard, each revertible. Cross-reference,
don't bundle.

## Invariants (non-negotiable)
- **Core/render split (D2):** logic in `src/core` (no Phaser/DOM, no `Math.random`); this
  brief is almost entirely `[RENDER]`. Flag any core touch separately.
- **Determinism:** `npm run sim` summary stays stable; don't reorder RNG draws.
- **Green at every increment:** `tsc --noEmit`, `vitest run`, `build`, `test:e2e` all pass
  after each commit — not just at the end. Each increment self-contained and revertible.
- Preserve the capture-wave layer + `deployment.test.ts` (79 cases) green.

## Validation
`npx tsc --noEmit` · `npx vitest run` · `npm run build` · `npm run test:e2e`
(screenshots → `screenshots/e2e-deploy-battle/`; use them to confirm the deployment
reach wash + trap-damage floater read well).

## Docs to update
- `docs/design/expedition-hollow-mill.md` feel-pass log — one entry per shipped increment.
- `docs/design/02-deployment.md` — note deployment now surfaces damage feedback + reach
  like combat (the capture-wave layer unchanged).

## Ops
- Develop on the branch the owner specifies (currently `claude/fervent-wozniak-uydkan`); ask
  before pushing elsewhere. Small reviewable commits. PR into `main` → wait for the `test`
  check → squash-merge (one PR per increment, or one PR for #1–2 and another for #3 — ask).
- Commit-message + PR footers per repo convention.

## Completeness checklist
- [ ] Springing a trap **in deployment** floats damage + writes a log line (and battle does
      not double-fire the FX).
- [ ] Deployment lights reachable tiles + the hover path for the remaining move budget; no
      strike telegraph appears in deployment.
- [ ] The consolidated Search/Disarm/click-ahead(/undo) helpers are single
      context-parameterized functions; deploy + battle e2e stages unchanged and green.
- [ ] Capture-wave layer intact (`deployment.test.ts` green); no attacks possible in
      deployment.
- [ ] `tsc`/`vitest`/`build`/`test:e2e`/`sim` green at every increment; feel-log + docs
      updated.
