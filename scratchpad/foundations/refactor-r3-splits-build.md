# Build prompt — R3: the module splits — pure code motion

> **Status:** ready to dispatch (R1 + R2 landed — merged PRs #154/#155, decisions D87/D88 —
> so the sim digest, replay pins, and drift tripwires this brief leans on are true guards).
> **Campaign context:** milestone R3 of
> [`refactor-campaign-plan.md`](refactor-campaign-plan.md). Consumes issues
> **#119, #120, #121, #127, #128, #129, #130**.
> **Decision to author:** none — R3 is mechanical (the campaign plan's rule); the
> `events.ts → event-bus.ts` rename and the predicate-on-node seam are noted in commit
> bodies and the PR, not a D-entry.

## Goal (one line)

Split the four god files (`node-events` 1105 · `turn` 895 · `jobs` 844 · `overworld-actions`
689 lines) and extract the recovery economy from `RunLoop`, as **pure code motion** — plus
the alias/rename cleanup batch and the one small mechanic generalization (predicate-on-node)
— with **zero behavior change**: every test green unchanged, sim digest byte-identical.

## The scope rule (read twice)

> **Code moves; code does not change.** A split is: cut a cluster, paste it into its new
> module, fix imports, re-export from the old path or the barrel so every call site keeps
> compiling. If you find yourself editing a function *body* (other than an import path or
> the mechanically-necessary predicate-on-node seam), stop — that's R4 territory or a bug
> to report, not to fix silently.

## Project invariants (non-negotiable)

- Pure core / render split (D2); determinism via `rng-labels.ts` (D87); the D61 total
  invariant (D88) must keep validating at load after every move.
- **Green at every increment:** `npm run test` (1050 at R2 landing), `npm run build`;
  `npm run sim` digest **byte-identical at every increment, no exceptions** — R3 names no
  blast radius. `npm run test:e2e` at the batch ends.
- One commit per increment, repo idiom, issue cited. The game layer imports **only** from
  the barrel (`src/core/index.ts`) — keep that true; new modules get barrel lines, and the
  old module re-exports moved symbols during migration only if something outside the barrel
  imports them directly (verify with grep; core-internal imports should point at the new
  homes).

## Current state (audit-verified 2026-07-08; R1/R2 shifted line numbers — re-verify)

1. **`node-events.ts` (1105 lines) is four systems** (#119): the event engine
   (`EventDef`/`EVENTS`/`eventForNode`/weights/interpreter/`tollFee`), the story sub-engine
   (`StorySpec`/`STORIES`/`PRESTIGE_OFFERS`/`applyStoryChoice`), the D80 early-event/arrival
   layer (`EARLY_EVENT`/`BYPASS`/`BLOCKADE`/`earlyEventForNode`/`tailoredEarlyEventFor`),
   and Hollow Mill authored content (`TRAVELER_GIFT`/`applyProvisionChoice`/`MIRA_SPEC`/
   `applyTownVisit` + the `provision-choice`/`merchant-town` records) — expedition beats in
   the generic registry, with `MIRA_SPEC` re-implementing hollow-mill's `member()` by hand
   (leave that re-implementation as-is — reconciling it would be a behavior risk; note it).
2. **`RunLoop` implements the recovery economy inline** (#120): `restNode()` and
   `inPlaceRest()` carry the D47/D80 rules (Tier-0 gate snapshot, Deep Rest wipe, chip
   floor + RP accelerator ordering, rest-streak cap, gear-debt clear, gold-cap refusal)
   against its own "wiring only" charter; the `REST` tuning block lives there while its
   sibling `RECOVERY` lives in `upkeep.ts` (`tuning.ts` reaches into runloop for one knob).
3. **`turn.ts` (895+ lines) bundles four concerns** (#121): the undo subsystem (~200 lines,
   now exported for the D87 tripwires — keep those exports working), the field-effect
   resolvers (`resolveShove`/`resolveGuardAllies`/`execCleave`/`useHeal`-helpers), the
   replay driver (`replay()`/`planActions()`), and the `Battle` interpreter proper.
4. **`overworld-actions.ts` (~700 lines) stacks state, gate, interpreter, registry, and one
   verb** (#129): `OverworldEconomy` + flags/cooldowns API; the `CostKnob`/`OverworldCost`
   closure gate + load-time validator (post-R2 shape); `useOverworldSkill`;
   `OVERWORLD_EFFECT_HANDLERS`; and `triage` (content, like Patronize which lives in
   economy-actions). The validator loop couples `overworld-actions ⇄ jobs` at load.
5. **`jobs.ts` (844+ lines) mixes engine and content** (#130): the engine (`JobDef` types,
   `JOBS`/`JobId`, capabilities, `stampPassives`, `unitSkills`, the R1 `SKILLS` registry)
   + thirteen job records with kit tuning blocks. Watch the lazy-import trick (~:19,
   `computeUpkeep` for the Cook's computed cost) — the one cyclic edge to preserve.
6. **Hollow Mill's node-access rule is hardcoded in `run.ts`** (#127): `nodeAccessible`
   special-cases `securedWagon` × `flags["medic-freed"]`. The general mechanism exists:
   `grants.ts`' composable `Predicate` + evaluator. This is the one **small mechanic
   generalization** in R3 (a data seam, not a behavior change — the same rule expressed
   as data; `feasibility.test.ts` pins the gating behavior).
7. **Dead aliases + holdover names + stranded helpers** (#128): `useCampJobSkill`,
   `useCampSkillAtNode`, `RunLoop.useCampSkill`, `grantCombatXp`, `intel.scout()`/
   `seerDivine()` (keep a one-line "Seer lane: designed, not built — D10" pointer when
   trimming the header, per the owner's ruling on #148), `Camp.storageCap`;
   `events.ts → event-bus.ts`; `EncounterRecord → NightRecord`;
   `Battle.runEnemyTurn → runPolicyTurn`; `OverworldEconomy → OverworldState`; the
   `SOLDIER` vs `SCOUT_JOB` constant convention (pick `*_JOB` everywhere);
   `describeUnit`/`jobPresenceSummary` → `dossier.ts`.

## Build plan — ordered, tested increments (two batches)

> Batch A = increments 0–4, batch B = 5–9. Green test/build + byte-identical sim after
> **each**; e2e at the end of each batch.

- **0 — Characterization** `[CORE]`, no production code. Pin the **barrel surface**: a test
  snapshotting the sorted export-name list of `src/core/index.ts` (the splits must only
  ADD names; a rename shows up as an explicit expected delta in the increment that makes
  it). Record the sim digest reference.
- **1 — Dead aliases die** `[CORE]` (#128 part A). Delete the six dead/back-compat aliases
  (grep-verify zero production callers first — R2 may have touched some); migrate their
  tests to the canonical entry points; trim the `intel.ts` header (with the Seer pointer).
  Update the barrel-surface snapshot with the named deletions.
- **2 — Split `node-events.ts`** `[CORE]` (#119). → `stories.ts` (story types + `STORIES` +
  `PRESTIGE_OFFERS` + apply/choices), `early-events.ts` (the D80 layer + `BYPASS`/
  `BLOCKADE` tuning), and the Hollow Mill records/resolvers into `hollow-mill-events.ts`
  (registered into `EVENTS` via a small `registerEvent()` instead of weight-0 hardcodes —
  registration order must not change `eventForNode` picks: pin one seeded pick per event
  kind before moving). `node-events.ts` keeps types, core records, seeded pick, weights,
  interpreter.
- **3 — Extract the recovery economy** `[CORE]` (#120). `recovery.ts`: `deepRest(run)` +
  `inPlaceRest(run)` as free functions (the bodies move verbatim); `RunLoop.restNode`/
  `inPlaceRest` become call + `recordNight` + telemetry; `REST` moves beside `RECOVERY`
  (fix `tuning.ts`'s reach-in).
- **4 — Split `overworld-actions.ts`** `[CORE]` (#129). → `overworld-state.ts`
  (`OverworldEconomy` + clone + flags/cooldowns/interest API) and `overworld-cost.ts`
  (knobs + the R2 closure gate + validator — relaxing the load cycle); `triage`/
  `TRIAGE_COST` move beside their economy-verb siblings (keep the `VERB_COSTS` identity
  pin true); `overworld-actions.ts` keeps interpreter + effect registry. **End batch A:**
  full suite + e2e + sim.
- **5 — Split `jobs.ts`** `[CORE]` (#130). `jobs-data/combat.ts` (Soldier/Heavy Knight/
  Hunter/Medic/Snare-Trapper), `jobs-data/scout-line.ts` (Scout/Assassin/Thief +
  `HIDDEN_PASSAGE` + prestige floors), `jobs-data/support.ts` (Cook/Merchant/Noble/Banker/
  Survivalist) + `UNIVERSAL_SKILLS`; `jobs.ts` keeps the engine + assembles `JOBS` +
  derives `SKILLS`. Preserve the `computeUpkeep` lazy import; kit tuning consts move with
  their records (fix `tuning.ts` imports).
- **6 — Split `turn.ts`** `[CORE]` (#121). `battle-undo.ts` (snapshot types +
  `snapshotUnit`/`restoreUnit` + checkpoint capture/restore — keep the D87 tripwire
  imports working), `battle-replay.ts` (`replay()` + `planActions()`),
  `field-effects.ts` (shove/cleave/guard-allies bodies as functions over
  `(grid, units, bus, …)`). `Battle` keeps `apply`/dispatch + clock/bus wiring +
  thin undo delegates. The golden replay pins (`r1-log-totality.test.ts`,
  `deploy-substrate-golden.test.ts`) are the safety net — byte-identical.
- **7 — The predicate-on-node seam** `[CORE]` (#127). `MapNode` (or a run-level rule list)
  gains predicate-shaped access data evaluated via `grants.ts`' `evalPredicate` (add the
  run-level `flagSet` leaf); `nodeAccessible` reads the data; the `securedWagon` rule
  moves into `hollow-mill.ts` as authored data. Same observable behavior —
  `feasibility.test.ts`'s stranded/gate pins prove it. Also fix the stale "STUBBED"
  comment at the hollow-mill spec site (per #147's finding).
- **8 — Renames** `[CORE]` (#128 part B). `events.ts → event-bus.ts` (file + barrel);
  `EncounterRecord → NightRecord`; `Battle.runEnemyTurn → runPolicyTurn`;
  `OverworldEconomy → OverworldState` (type rename; the field name on `RunState` stays
  unless trivially safe); job constants → `*_JOB` convention. Every rename is
  compiler-enforced; the barrel-surface snapshot documents each expected delta.
- **9 — Stranded helpers + closeout** `[CORE]` (#128 part C). `describeUnit` +
  `jobPresenceSummary` → `dossier.ts`; final grep sweep (no import of a moved symbol via
  its old home except sanctioned re-exports); line-count report for the five target files
  in the commit body. **End batch B:** full suite + e2e + sim.

## Completeness checklist

- [ ] `node-events.ts`, `turn.ts`, `jobs.ts`, `overworld-actions.ts` each ≤ ~450 lines with
      one stated responsibility; `runloop.ts` carries no recovery rule bodies.
- [ ] Zero behavior change: every pre-existing test green **unchanged** (mechanical import
      updates only); sim digest byte-identical at every increment; e2e green per batch.
- [ ] The barrel-surface snapshot documents every added/renamed/deleted export by name.
- [ ] The D87 guards still bite: tripwire tests still import the (moved) snapshot machinery;
      the rng-labels grep guard still covers the new modules; the D88 load validators still
      run (registry identity pin true).
- [ ] `run.ts` contains no expedition-specific node id; the Hollow Mill gate is authored
      data in `hollow-mill.ts`; `feasibility` pins green unchanged.
- [ ] The six dead aliases are gone; the renames landed; `dossier.ts` owns the presentation
      helpers; game-layer imports still barrel-only.
- [ ] Issues #119/#120/#121/#127/#129/#130/#128 closed from the PR; #152's R3 row ticked.

## Boundaries

- **No R4 reach:** don't migrate verbs onto `JobDef.skills`, no `availableActions`, no
  `SkillDef.phase` retirement, no one-Cost grammar, no forecast work.
- **No render changes** beyond mechanical import-path updates if any (flag them).
- **No body edits**: if a moved function looks wrong, report it in the final message —
  don't fix it in a motion commit.

## Operational

- Current branch (`claude/codebase-architecture-audit-x8xxux`, restarted from main); one
  commit per increment; one PR at the end. Committer identity is repo-configured — verify
  `git config user.email` = noreply@anthropic.com before the first commit.
- Verification: `npm run test` · `npm run build` · `npm run test:e2e` · `npm run sim`.
- On landing: tick #152's R3 row + the campaign plan; the R4 brief (the substrate milestone)
  is authored next — it deserves its own design review before dispatch.
