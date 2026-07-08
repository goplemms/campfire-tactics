# Build prompt — R2: verb-gate closure — no unpaced, unpriced verb

> **Status:** ready to dispatch (audit-verified 2026-07-08; R1 landed first — merged PR #154,
> decision D87 — so the sim/replay guards this brief leans on are true).
> **Campaign context:** milestone R2 of
> [`refactor-campaign-plan.md`](refactor-campaign-plan.md). Consumes issues
> **#112 (step 1 only), #125, #126** + the scalar-chokepoint rider from #112.
> **Decision to author:** one entry ≈ *"The D61 invariant is total: every overworld verb is
> paced or priced, by construction"* — confirm the free number at build time (D88 unless the
> save-model session, #117, claimed it).

## Goal (one line)

Close the live D61 invariant holes — every economy verb routes through the shared cost gate
and an **ungated verb becomes unrepresentable** (fails at import) — while the check→commit
sandwich collapses into one helper and the shared party predicates kill the per-class
copy-paste (including the captured-Cook bug, this brief's one named behavior change).

## Project invariants (non-negotiable)

- Pure core / render split (D2); no `Math.random`; determinism via `rng-labels.ts` (D87).
- **Green at every increment:** `npm run test` (1044 at R1 landing), `npm run build`,
  `npm run test:e2e`; `npm run sim` digest **byte-identical except where increment 2's
  named blast radius says otherwise** (verify whether any sim seed actually fields a
  captured Cook at the stew beat — likely not, so expect byte-identity; if it moves,
  the increment-2 commit must say exactly how and why).
- One commit per increment, repo idiom, issue cited; nothing pushed until the batch is green.
- **Numbers are illustrative** (the house D80-brief rule): the new Borrow/Interest costs are
  tunable defaults proving the *structure* — flag them to the owner, don't hunt for balance.

## Current state — the audit (verified 2026-07-08; re-verify against post-R1 code)

1. **Three verbs bypass the D61 gate** (`economy-actions.ts`): `merchantSell` (~:169, justified
   informally by self-limiting stock), `bankerEngageInterest` (~:213) and `bankerBorrow`
   (~:234) — **no pacing, no price**; Borrow is an unbounded gold advance. The load-time
   validator (`overworld-actions.ts:~151`) walks only `JOBS[*].skills`; standalone verbs rely
   on the opt-in hoisted-cost convention (`TRIAGE_COST`, `BANKER_PROTECT_COST`,
   `PATRONIZE_COST`) that these three never opted into. The bug class D61 was built to make
   unrepresentable is still representable anywhere a verb is a free function.
2. **The check→commit sandwich is hand-assembled at six sites** (`useOverworldSkill` ×2,
   `triage`, `merchantBuy`, `bankerProtect`, `patronize`): callers must thread
   `check.fatigueSpend`, apply the effect *between* check and commit, and avoid the documented
   `CostKnob` re-resolution trap (`overworld-actions.ts:~53-58`) — commit re-resolves gold
   knobs **after** the effect, a drift bomb for the first effect that changes party
   composition.
3. **"Party fields a live member of job X" is copy-pasted per class** with drift:
   `economy-actions.ts` ~:189/:203/:279/:311 inline `u.alive && !u.captured &&
   primaryJobOf(u) === "<job>"`; `node-events.ts:~734`'s Cook check **forgot `!u.captured`**
   — a captured Cook still offers to cook the stew (real inconsistency; fixing it is the
   named behavior change). `units.ts` already hoists such idioms (`isActive`, `activeUnits`,
   `primaryJobOf`).
4. **Tier ladders are re-hardcoded**: `arrivals.ts:~149-164` string-keyed
   `MORALE_ORDINAL`/`FATIGUE_ORDINAL` (a renamed tier label → `undefined` → silent `NaN`
   scores) while `fatigue.ts:~74` already exports `fatigueTierIndex`; `bandFor` (`num.ts:~55`)
   is used by only 2 of ~6 ladders (`intelFloor` blocked by the `minIntelligence` key name;
   `moraleTier` an if-chain; market/influence tiers grow bespoke rank/clamp helpers).
5. **Bare scalar mutations** (the #112 rider): RP is mutated directly at ~6 sites
   (`runloop.ts` ×5, `overworld-actions.ts` ×2) and morale at 4+ modules — no chokepoint, so
   future provenance/balance work has no seam.

## Build plan — ordered, tested increments

- **0 — Characterization witnesses** `[CORE]`, no production code. Pin today's behaviors:
  (a) a captured Cook **is** offered the stew choice (flips at increment 2); (b)
  `bankerBorrow`/`bankerEngageInterest` succeed back-to-back with no refusal (flips at 7);
  (c) the committed gold price of a gated verb whose effect changes party composition —
  pin the **current** (re-resolved) price as the witness for increment 5. Record the sim
  digest reference.
- **1 — Shared predicates** `[CORE]` (#125). `fieldedUnits(party)` + `fieldsJob(party, jobId)`
  in `units.ts` beside `isActive`; migrate every inline site **except** the Cook check
  (pure motion; behavior identical, sim byte-identical).
- **2 — The captured-Cook fix** `[CORE]` (#125) — **the named blast radius.** The Cook check
  migrates onto `fieldsJob`; the increment-0 witness flips: a captured Cook no longer offers
  stew. Commit message states the behavior change and cites the audit.
- **3 — Ordinal + fold dedup in arrivals** `[CORE]` (#125). `moraleTierIndex` exported from
  `camp.ts`; `arrivals.ts` uses it + `fatigueTierIndex` (the string tables die); extract the
  shared levelTotal/avg-HP fold used by `scoreArrival`/`arrivalDigest`. Scores unchanged —
  pin one arrival score before/after.
- **4 — `bandFor` adoption + ordered-band helpers** `[CORE]` (#125). Rename
  `INTEL_BREAKPOINTS`' key to `min`; route `intelFloor`/`fatigueTierIndex`/`moraleTier`
  through `bandFor`; add `rankOf(order, v)`/`clampUp(order, a, b)` to `num.ts` and migrate
  `marketRank`/`clampUpMarket` + the `INFLUENCE_ORDER` indexOf math. Pure motion; all tier
  tests green unchanged.
- **5 — The commit closure** `[CORE]` (#126). `checkOverworldCost` returns
  `{ ok: true, prices, commit(): void }` with **prices captured at check time**; migrate the
  six sandwich sites; delete the standalone `commitOverworldCost` (or reduce it to the
  closure's internals). Flip/retire the increment-0 price witness: the committed price now
  matches the checked price even when the effect moves the composition. The D61 guard test
  and `overworld-actions.test.ts` stay green.
- **6 — Gate `merchantSell`** `[CORE]` (#112 step 1). Declare its cost
  (`{ selfLimited: true }` — the informal justification becomes data) and route through
  check/commit. No numbers change; refusal reasons now standard.
- **7 — Gate `bankerBorrow` + `bankerEngageInterest`** `[CORE]` (#112 step 1). Illustrative
  defaults, hoisted + named: Borrow `{ usesPerNode: 1 }` (one loan arrangement per node),
  Engage Interest `{ usesPerNode: 1 }` (a toggle, re-armed per node). Flip increment 0's
  witness (back-to-back now refuses). **Surface to the owner:** these are the structure —
  a debt-ceiling knob is a plausible future price axis; note it in the decision record,
  don't build it.
- **8 — The invariant goes total** `[CORE]` (#112 step 1). A standalone-verb cost registry
  (`VERB_COSTS`: every exported economy verb id → its `OverworldCost`), validated at module
  load exactly like `JOBS[*].skills`; a guard test enumerates the exported verb resolvers in
  `economy-actions.ts`/`overworld-actions.ts` and fails on any without a registered cost —
  **a new ungated verb fails at import/test, by construction.** (Bribe stays on
  `spendInfluence` for now — note it as the D112-step-2 migration target, don't force it.)
- **9 — Scalar chokepoints** `[CORE]` (#112 rider). `spendRp`/`accrueRp` and `nudgeMorale`
  one-line funnels; migrate the ~6 RP and 4+ morale bare-mutation sites. No journals, no
  behavior change; sim byte-identical.

## Completeness checklist

- [ ] Every economy verb (`buy`, `sell`, `borrow`, `engageInterest`, `protect`, `patronize`,
      `triage`, + the skill path) routes through the one check→commit closure.
- [ ] The load-time invariant covers **both** homes (`JOBS[*].skills` + `VERB_COSTS`); the
      guard test proves an unregistered verb fails.
- [ ] Committed prices are captured at check time (the re-resolution trap is dead, pinned).
- [ ] `fieldsJob` is the only "party fields a live X" spelling in `src/core` (grep).
- [ ] A captured Cook does not offer stew (the one behavior change, named in its commit).
- [ ] No string-keyed tier tables remain; ladders ride `bandFor`/`rankOf`/`clampUp`.
- [ ] RP and morale mutate only through their funnels (grep).
- [ ] Tests/build/e2e green at every increment; sim digest byte-identical (or the increment-2
      delta precisely explained).
- [ ] The decision record is authored; #125/#126 closed; #112 gets a "step 1 done" comment
      (steps 2–4 stay open for R4); #152's R2 row ticked.

## Boundaries

- **No R4 reach:** don't move verbs onto `JobDef.skills`, don't build `availableActions(run)`,
  don't touch `SkillDef.phase`, don't start the one-Cost grammar (#113) — R2 only closes the
  gate around today's shapes.
- **No render changes**; no module splits (R3); no number tuning beyond the two named
  illustrative defaults.

## Operational

- Branch off current `main`; one commit per increment; one PR at the end; committer identity
  `Claude <noreply@anthropic.com>` (repo git config already set — verify before the first
  commit).
- Verification: `npm run test` · `npm run build` · `npm run test:e2e` · `npm run sim`.
- On landing: tick #152's R2 row + update the campaign plan; author the R3 brief next.
