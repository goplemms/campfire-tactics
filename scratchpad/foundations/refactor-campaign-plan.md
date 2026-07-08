# Refactor campaign — the plan (from the 2026-07-08 audit)

> **Status:** plan authored 2026-07-08 from the full-codebase audit (GitHub issues
> **#111–#153**; index + sequencing in **#152**). This page maps the audit onto the
> memento milestone shape: ordered milestones, each with a **user-testable gate**,
> built one at a time on dedicated branches with green tests at every increment.
> Build briefs are authored per milestone as each is dispatched (R1's exists:
> [`refactor-r1-hardening-build.md`](refactor-r1-hardening-build.md)).

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
| R2 | **Verb-gate closure — no unpaced, unpriced verb** | #112 (step 1), #125, #126 | `bankerBorrow`/`bankerEngageInterest`/`merchantSell` refuse when unpaid/on-cooldown exactly like gated verbs; the D61 load-time invariant extends to standalone verbs (a new ungated verb **fails at import**); the check→commit sandwich is one helper (prices captured at check time); a captured Cook no longer offers stew (named blast radius). |
| R3 | **Module splits — pure code motion** | #119, #120, #121, #127, #128, #129, #130 | `npm run test` green with **zero snapshot/sim deltas**; the barrel keeps every import path working; `node-events`/`turn`/`overworld-actions`/`jobs` each under ~450 lines with one responsibility; `run.ts` carries no Hollow Mill ids (the predicate-on-node mechanic exists); the alias/rename batch lands (`event-bus.ts`, `NightRecord`, …). |
| R4 | **The verb substrate proper — one grammar, one projection** | #112 (steps 2–4), #113, #114, #123, #149 | Economy verbs are `SkillDef`s on `JobDef.skills`; **`availableActions(run)`** drives the OverworldScene camp buttons (no hand-wired verb buttons); one `Cost` type with a clock-domain tag (consumables declared, the undo `stash` special case dies); `JobFaucet` is the general per-step accrual record; `SkillDef.phase` retired for `usableContext` with the battle-flow/UI agreement test; charged skills carry `targetMode` + the target-moved fizzle (owner-ruled, #149). |
| R5 | **Render decomposition** | #131, #132, #133, #134, #135, #137, #138 | BattleScene and OverworldScene each ≲1,200 lines of pure orchestration; the overlay/button kit is the only way panels/buttons are built; the seven core-leaks are core functions with tests; screenshot harness diffs are **empty** for every pure-motion step. |

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
