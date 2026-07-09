# Build prompt — R4: the verb substrate proper — one grammar, one projection

> **Status:** ready to dispatch — the five sub-decisions and the four open questions were
> **ratified by the owner 2026-07-09** (see "Ratified answers" at the bottom).
> Ships as **three batch PRs** (grammar → migration → projection+riders).
> **Campaign context:** milestone R4 of
> [`refactor-campaign-plan.md`](refactor-campaign-plan.md). Consumes issues
> **#112 (steps 2–4), #113, #114, #123, #149** (+ **#153** as the optional content rider).
> **Decision to author:** one entry ≈ *"The Verb Cell named: one grammar, one projection —
> economy verbs are skills, costs are one type, the camp UI is a projection"* (next free
> number at build time). Also author `docs/design/systems/verb-substrate.md` naming the
> cell (the #112 ask).

## Goal (one line)

Finish D72's A3 north star: economy verbs become **data on `JobDef.skills`**, every surface
answers "what can be done here, at what price" through **one projection**
(`availableActions(run)` — the run-tier twin of `availableSkills`), costs collapse into
**one grammar** (pacing in the surface's clock + a price map that includes materials), and
the vestigial `SkillDef.phase` axis retires — so the queued content passes (Banker, the
triad kits, prestige forks) land as records, not plumbing.

## The five sub-decisions (ratify before dispatch)

**A. Verbs onto `JobDef.skills`.** New `OverworldActionEffect` kinds — `sell`, `borrow`,
`engageInterest`, `guardPurse` (Banker protect), `collectIncome` (Noble income if distinct
from the faucet), `triageHeal` stays — each a `SkillDef` on its owning job (Merchant: sell ·
Banker: borrow/interest/protect · Noble: patronize · Medic-or-universal: triage — **owner
call: triage's owner**; today it's job-ungated). `merchantBuy` stays **job-ungated by
design** (M8's recorded call) — it becomes a *universal* overworld skill, the precedent for
universal verbs. The compile-time `OVERWORLD_EFFECT_HANDLERS` mapped type forces handlers.
`VERB_COSTS` dissolves into the SkillDefs' `overworldCost` (the D88 invariant keeps running
over the one home).

**B. `availableActions(run) → ActionView[]`.** Every verb usable at the current node, with
its gate verdict (ok / why-refused) and cost readout — derived, not hand-wired.
`OverworldScene`'s camp verb buttons become a render of this projection (a real render
change — the D80 camp layout stays, the *wiring* changes). This is also the sim
meta-policy's legal-move enumeration (the D56/D57 unlock).

**C. One `Cost` grammar (#113).** A single type with a clock-domain tag: pacing denominated
in the surface's clock (CT | node-steps), price as a resource map **including materials**
(`{ material: { id, count } }`). Migration: fold `SkillDef.usesPerNode` into
`overworldCost` (delete the bridge); declare the Medic herb and trap-kit prices on their
skills with consumption in the commit half (the undo `stash` special case dies — D87's
checkpoint already covers the refund); Vancian charges become a future price resource,
not a fourth grammar.

**D. `SkillDef.phase` retires (#123).** `usableContext` (+ the effect-union partition) is
the one placement axis. **Test-first:** add the agreement test that
`battle-flow.noActionsAvailable` matches `availableSkills(actor, "combat")` — the latent
disagreement is currently untested — then migrate `unlockedSkills(unit, phase)` callers
and delete `phase` (or derive it). D3 stays the documented *sequence* contract (D46).

**E. Charged-ability `targetMode` (#149, owner-ruled).** `targetMode: "tile" | "unit"` on
charged skills + the target-moved fizzle (the reserved seam in `clock.ts`); hostile charges
whiff, friendly (Mend) keep homing. Rider: `bribeEnemy` migrates onto the reserved
`OverworldCost.influence` knob; **JobFaucet generalizes** (#114) into the per-step accrual
record (`goldSkim` for Deft Hands; Banker interest stays eco-state, sourced from a declared
faucet when its per-class pass lands).

**Optional content rider (#153, owner-ruled build):** the thief's real flee/escape posture
(a `steal-then-flee` `STANDING_ORDERS` record + `tallyEscapedThieves` reconciliation) —
sequence it last; it consumes the substrate and is independently droppable.

## Blast radius (named; each needs a pin, none silent)

- The camp UI's verb buttons re-derive from the projection — **screenshot diffs expected**
  (layout parity is the goal; wiring is new). `shots-actions.mjs` is the harness.
- Herb/trap-kit consumption moves from resolver-side to commit-side — behavior identical,
  but undo/telegraph read it as data now (pins: the D87 golden battle + new availability
  telegraph tests).
- Hostile charged skills gain the whiff (today: only Mark Prey's ramp is hostile-adjacent;
  verify which shipped charges are hostile — possibly **zero**, making E structure-only
  until content authors one; say so in the record).
- `bribeEnemy` refusals now standard-shaped (Influence knob), and thieves (rider) really
  flee.
- Sim digest: expect byte-identity **except** where the meta-policy/bot reads change —
  D56/D57 says the bot reads camp levers at 0%, so likely byte-identical; any delta must
  be explained line-by-line in its increment's commit.

## Build shape (three dispatch batches; each increment green + one commit, per house rule)

- **Batch 1 — the grammar (C + D):** 0 characterization (camp-button snapshot per beat,
  agreement-test witness for battle-flow vs availableSkills, sim reference) · 1 the
  `Cost` type + clock-domain tag (additive) · 2 fold `usesPerNode` · 3 material prices
  (herb, trap-kit; stash special-case dies) · 4 the agreement test flips + `phase`
  retirement (widest mechanical blast; compiler-driven).
- **Batch 2 — the migration (A):** 5 the `OverworldActionEffect` kinds + handlers
  (additive, unused) · 6 Merchant sell + Banker borrow/interest/protect as SkillDefs
  (VERB_COSTS rows dissolve one-by-one; the D88 guard keeps passing at every step) ·
  7 Noble patronize + bribe-onto-Influence · 8 triage + universal buy (per the A ruling) ·
  9 `VERB_COSTS` retires (the guard test now proves the *absence* of standalone verbs).
- **Batch 3 — the projection + riders (B + E + #114 + #153):** 10 `availableActions(run)`
  (pure, with parity tests against every hand-wired button state) · 11 OverworldScene
  renders the projection (screenshot parity pass) · 12 `targetMode` + fizzle · 13 JobFaucet
  generalization (Deft Hands migrates) · 14 (optional) the thief flee rider · 15 the
  decision record + `verb-substrate.md` + campaign closeout.

## Invariants & operational (house rules, same as R1–R3)

Pure core / D2; green test/build at every increment; sim byte-identical except the named
deltas; e2e + screenshot harnesses per batch; one PR per batch **or** one PR total (owner
preference — three batches ≈ R1-sized PRs each; say which at dispatch); committer identity
repo-configured; on landing tick #152 + the campaign plan; R5 (render decomposition)
follows, now easier because OverworldScene's verb wiring is a projection.

## Ratified answers (owner, 2026-07-09)

1. **Triage: Medic-owned, universal fallback.** The full-strength triage becomes the
   Medic's overworld SkillDef (today's numbers); a reduced-effect universal fallback lives
   in `UNIVERSAL_OVERWORLD_SKILLS`. **Illustrative default for the fallback:** RP converts
   at half efficiency (2× `rpPerChunk`), same cost menu — a **named behavior change**
   (Medic-less parties heal slower at camp): pin it, flag the number as tunable, and note
   it in the decision record beside D9's `rpPerChunk` dial. Add to the blast-radius list.
2. **`UNIVERSAL_OVERWORLD_SKILLS`: yes** — buy + the triage fallback live there; the
   projection folds it in exactly as `availableSkills` folds combat's `UNIVERSAL_SKILLS`.
3. **Three batch PRs** — grammar → migration → projection+riders, each independently
   CI'd, reviewed, revertible; tick the campaign plan per batch landing.
4. **The thief rider (#153) rides batch 3**, sequenced last, droppable if the batch runs
   long.
