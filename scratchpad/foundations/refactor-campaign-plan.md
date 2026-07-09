# Refactor campaign — the plan (from the 2026-07-08 audit)

> **Status: COMPLETE (2026-07-09).** All five milestones landed — R1–R5, decisions
> **D87–D89** (R3/R5 mechanical, no D-entry), PRs **#154–#161** + the batch-C render
> PR pending. Baseline grew 1044 → **1102 tests**, sim byte-identical throughout, the
> render harnesses' diffs empty for every pure-motion step. The one honest miss: R5's
> ≲1,200-line scene target (BattleScene landed at 2538, OverworldScene 1754 — the
> subsystems all extracted, but the scenes still own their interactive state machines;
> see the R5 gate row). The Verb Cell is named and closed; the queued content passes
> can land as records. Original plan status below.
>
> **Status (as authored):** plan authored 2026-07-08 from the full-codebase audit
> (GitHub issues **#111–#153**; index + sequencing in **#152**). This page maps the
> audit onto the memento milestone shape: ordered milestones, each with a
> **user-testable gate**, built one at a time on dedicated branches with green tests
> at every increment. Build briefs are authored per milestone as each is dispatched
> (R1's exists: [`refactor-r1-hardening-build.md`](refactor-r1-hardening-build.md)).

## North star

The audit's core verdict: the codebase has been circling one unnamed architecture —
the **Verb Cell** (registry of typed defs × cost/predicate gate × one exhaustive
interpreter × typed outcome × mirror projections × label-keyed RNG × a provenance
log with a reconciliation invariant). D67 and D72 each unified one seam pair.
This campaign **finishes the stragglers against the named cell** — correctness
first, guards second, substrate third, content-shaped cleanups riding along —
so that the queued content passes (Banker, the triad kits, prestige forks) land
as *records, not plumbing*, and the eventual save system (D27) has a wire format.

## Non-scope

- **No behavior changes** except the ones each brief names as deliberate blast
  radius (e.g. R1's logged-rescue undo reach, R2's captured-Cook fix). The sim
  summary is the tripwire: byte-identical unless the brief says otherwise.
- **No content** (no new classes/kits/nodes) — the campaign is the substrate the
  next content passes consume, mirroring how D72 preceded D70/D71.
- **No doc-accuracy work** — that's the parallel doc campaign (#139–#151, rulings
  recorded 2026-07-08 on #152); only decision records + doc lines that *this*
  campaign's code changes require.

## Milestones

| # | Milestone | Consumes issues | Gate (user-testable) |
|---|-----------|-----------------|----------------------|
| R1 | **Hardening — the log tells the whole truth + permanent guards** — **DONE** (merged PR #154, 2026-07-08; decision **D87**; 1044 tests, sim byte-identical) | #111, #115, #116, #122, #124, #136 | ✅ Gate met: the golden rescue+heal battle **replays byte-identically** through a JSON round-trip of its log (skill-by-id); the snapshot tripwires **fail by name** on an unlisted field; every `streamFor` label rides `rng-labels.ts` (grep-guarded, values pinned); the M5b/D11 models are deleted; the active-unit highlight follows the turn (e2e-verified). |
| R2 | **Verb-gate closure — no unpaced, unpriced verb** — **DONE** (merged PR #155, 2026-07-09; decision **D88**; 1050 tests, sim byte-identical) | #112 (step 1), #125, #126 | ✅ Gate met: the three stragglers are gated; the `VERB_COSTS` registry + export-classification guard make a new ungated verb **fail by name**; the commit closure captures prices at check time (the re-resolution trap is dead); `fieldsJob` is the one predicate spelling; three named behavior changes recorded in D88 (captured-Cook, Banker `usesPerNode`, empty-purse engage refusal). |
| R3 | **Module splits — pure code motion** — **DONE** (merged PR #156, 2026-07-09; no D-entry per the mechanical rule; 1052 tests, sim byte-identical at all ten increments) | #119, #120, #121, #127, #128, #129, #130 | ✅ Gate met: zero behavior change (barrel-surface pin documents every export delta); `jobs.ts` 246 · `overworld-actions.ts` 226 · `node-events.ts` 567 · `turn.ts` 786 lines, one responsibility each (the two above the ~450 soft target keep exactly their designated remainder); `run.ts` carries no expedition ids (predicate-on-node shipped); aliases dead, renames landed. |
| R4 | **The verb substrate proper — one grammar, one projection** — **DONE** (batch-3 PR pending, 2026-07-09; decision **D89**; 1091 tests, sim byte-identical) | #112 (steps 2–4), #113, #114, #123, #149 | ✅ Gate met: economy verbs are `SkillDef`s on `JobDef.skills` (`VERB_COSTS` retired, the D88 guard **inverted** to prove no standalone gated verb); **`availableActions(run)`** drives the OverworldScene camp verb surfaces — the `isMigratingEconomyVerb` seam + hand-wired blocks are gone (screenshot parity: only the ratified universal Triage-fallback row is new); one `Cost` type with a clock-domain tag (materials declared + commit-side, the undo `stash` special case dead); `JobFaucet` generalized to the per-step accrual record (Thief's Deft Hands migrated onto a declared `goldSkim`, `Labels.deft` unchanged ⇒ sim byte-identical); `SkillDef.phase` retired for `usableContext` (battle-flow/UI agreement test flipped); charged skills carry `targetMode` + the target-moved fizzle (owner-ruled #149, **structure-only** — no shipped hostile charge, pinned by a fixture). **#153 thief flee: skipped** (droppable; the steal/skim lifecycle is scene-only + combat is purse-agnostic, so the headless sim can't fire the transition — D89 records the reasoning). |
| R5 | **Render decomposition** — **DONE** (batch-A PR #160, batch-B PR #161, batch-C PR pending; 2026-07-09; no D-entry per the mechanical rule; 1102 tests, sim byte-identical at all 15 increments) | #131, #132, #133, #134, #135, #137, #138 | ✅ Gate **partially** met — the mechanical goals landed, the line target did **not**. Kit: `overlay-card.ts` (`showModal`, backdrop always on) + the `Button` kit are the only way panels/buttons build (the three `makeTextButton` wrappers + two scene probes unified). Core-leaks: the seven render-side rule leaks are tested core functions (`createStarterGuild`/`buyArmoryGear`/`toggleUpkeepSkip`, the bribe-sway verb + `unitSwayed` bus event, `medicalHerbs`/`marketStock`/`deployModifiers`/`marketReadyAt`). Views extracted: OverworldScene → `ledger-sheet`/`map-view`/`camp-panel`/`market-view`/`event-panels` (batch B); BattleScene → `command-menu`/`forecast-cards`/`situation-card`/`resolution-report`/`deploy-zones`/`trap-markers` (batch C, #131's whole map). Screenshots: **empty diffs** for every pure-motion step across all 11 shots-* harnesses + e2e (73 assertions). **❌ Line target NOT met — honest count:** BattleScene **3126 → 2538**, OverworldScene **≈2500 → 1754**; both remain above the ≲1,200 "pure orchestration" aspiration. The six #131 extractions each landed clean, but the designated remainder — the phase state machine, input routing (pointer/key/click-ahead), the deploy↔battle turn-economy flow, skill routing, the theft/bribe/recruit trackers, and the ~20 HUD `refresh*`/`draw*` seams — is genuinely BattleScene's job and #131 maps no further; over-extracting to chase 1,200 was explicitly declined. Net: the scenes are markedly thinner and every subsystem is a testable, independently-owned view module, but "≲1,200-line orchestrator" was an over-optimistic target for a scene that still owns the interactive board state machine. |

Standing riders (any milestone may absorb them opportunistically): #118 (forecast
dry-run convention test), #128's stragglers, #153 (thief flee — content-adjacent,
naturally rides R4's standing-order touch or ships solo).

**Deliberately NOT scheduled:** #117 (the save-model design session — a discussion,
not a build; hold it after R1 lands, since R1's serializable log + label registry
are its groundwork).

## Ordering rationale (why this sequence)

1. **R1 before everything** — replay/undo/sim are the campaign's regression net;
   they must be *true* before refactors lean on them. Every later milestone's gate
   cites "sim byte-identical" — R1 is what makes that guard load-bearing.
2. **R2 before R3/R4** — closing the live D61 invariant holes is small and stops
   the bug class from growing while the bigger moves land.
3. **R3 before R4** — the splits are pure motion best done *before* the substrate
   migration rewrites the same files (no double-touching `overworld-actions.ts`).
4. **R4 is the milestone proper** — the "substrate before content" pass, gating
   the queued Banker/triad/prestige content work.
5. **R5 last (or interleaved)** — render-only, independently shippable
   cluster-by-cluster; safe to run in parallel sessions once R1's net exists.

## Working rules (all milestones)

- One milestone at a time; a dedicated branch off current `main`; **one commit per
  increment**; each increment green (`npm run test` · `npm run build` ·
  `npm run test:e2e` · `npm run sim` stable) and individually revertible.
- **Decision records:** R1, R2, and R4 author decisions when dispatched (numbers
  confirmed at build time against `decisions.md` — the save-model session, #117,
  may also claim one). R3/R5 are mechanical and need none beyond commit messages,
  except the `events.ts → event-bus.ts` rename note riding R3's record-free batch.
- **Issue hygiene:** each increment's commit cites its issue; close issues from
  the PR description; #152 (the index) gets a checklist tick per milestone.
- Core-first; flag every `src/game/` change separately from core.
