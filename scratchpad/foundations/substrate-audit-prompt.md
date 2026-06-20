# Substrate Audit — find the next "chokepoint + log + invariant" refactor

A brief to run an **evaluation pass** over the codebase: hunt for subsystems that would
benefit from the same treatment as our two shipped substrates, and write up the
candidates ranked by leverage. This is an **audit, not a build** — produce a design-eval
doc, implement nothing. Read the two precedents first, in order:

1. [`docs/design/systems/purse-journal.md`](../../docs/design/systems/purse-journal.md)
   — the **transaction** substrate: gold was mutated inline at ~11 sites across six
   modules; now every movement flows through one `earn`/`spend` chokepoint that records a
   provenance log, reconciled by `sum(purseLog) === camp.gold`.
2. [`docs/design/systems/combat-actions.md`](../../docs/design/systems/combat-actions.md)
   — the **command** substrate: each battle action was a bespoke `Battle` method with
   player/AI paths that differed; now every action lowers to data through one
   `Battle.apply` interpreter that appends to `battle.log`, reconciled by
   `replay(log) === state`. (Then the gated features layered on: an RNG seam, then undo.)

## The pattern (the shared DNA to match against)

Both fixed the **same shape**. Look for subsystems with these symptoms:

1. **Scattered mutation of an important value.** One meaningful piece of state is changed
   **inline at many call sites across modules**, often by **divergent code paths** doing
   the same logical operation (the purse: 11 sites; combat: per-action methods, player ≠ AI).
2. **No single chokepoint** — nothing you can point at as *the* place this state changes,
   so a new call site can silently drift.
3. **No provenance** — the system keeps only the *resulting number/state*, not a record of
   **what moved it and why**. Reports are **re-derived after the fact** (the purse's old
   `buildLedger` approximated flow from node history; combat had no trace at all).
4. **No reconciliation invariant** — nothing fails the build when a future change bypasses
   the (missing) chokepoint.

The fix is always: **funnel every mutation through one intent-named chokepoint → record an
append-only log going forward → assert a reconciliation invariant → migrate
behaviour-preservingly → ship the *substrate* first and gate the *product feature*.**

## The invariant is shaped by the state (the one real fork)

- **Conserved scalar → sum.** If the state is one number that's conserved (gold), the
  invariant is `sum(log) === value` — O(n), trivial, cheap to check. (Purse.)
- **Graph → replay.** If the state is a graph (units × hp/pos/status/clock; a roster), you
  can't sum — you **replay** the log from an initial snapshot and assert identical state:
  `replay(initial, log) === state`. More machinery, but the same net. (Combat.)
- **Determinism caveat:** a replay invariant requires the path be a deterministic function
  of `(initial, log)`. If a mutation consumes RNG, the log/checkpoint must capture the draw
  coordinate (we used label-derived `streamFor(seed, label)` so there's no cursor to snapshot).

## Hunting grounds (confirm or reject — and look beyond these)

Seed suspects, not conclusions. For each, grep the mutation sites and judge against the
four symptoms above:

- **The other run currencies.** The purse journal **explicitly defers** the guild
  **treasury**, **Influence**, and **Rest Points (RP)** — "the same `earn`/`spend` shape can
  adopt them later." Are they mutated inline at scattered sites today? (`economy.ts`,
  `upkeep.ts`, `guild.ts`, `run.ts`.) Strongest a-priori candidate: same scalar→sum shape.
- **XP / leveling.** Combat XP is tallied on the bus then committed; ability-use XP and
  job/char levels mutate elsewhere (`leveling.ts`, `grantAbilityUseXp`, `commitCombatXp`).
  Is there one chokepoint for "grant XP", and a record of *why* each grant happened?
- **Morale.** `camp.morale` nudged at many sites (rest, upkeep underfunding, events,
  Chef). A morale journal (scalar→sum) with provenance for "why did morale move"?
- **Inventory / storage.** `addItem`/`removeItem` may already be chokepoints — verify, and
  check whether a *storage journal* (what entered/left, from where) is missing the same way
  the purse's provenance was.
- **Deployment / field verbs.** The combat-actions doc flags **deployment-phase verbs**
  (trap placement, capture, range-back) and `useHeal` as a **separate action set** not yet
  on the log. Same `CombatAction`-style union + interpreter, or its own? (`deployment.ts`,
  `traps.ts`, `theft.ts`, `BattleScene`.)
- **Overworld run-state mutations.** `run.night`/`gearWear`/`fatigue`/cooldowns advanced
  across `run.ts`/`overworld-actions.ts` — is "stepping the run" one chokepoint or many?

## Per-candidate evaluation (the rubric to score each)

For every candidate that survives the symptom check, record:

1. **The scattered sites** — list the inline-mutation call sites (the evidence). A short
   grep + count, like the purse's "~11 sites across six modules."
2. **The proposed chokepoint** — the intent-named pair/verb every site would route through.
3. **The log shape** — the append-only record entry (a signed delta + typed source for a
   scalar; a command for a graph). **Ids, not object refs**, if it must survive a rebuild.
4. **The invariant** — `sum(log) === value` (scalar) or `replay(log) === state` (graph),
   and whether determinism/RNG complicates it.
5. **Migration cost & risk** — can existing sites become **thin wrappers** over the
   chokepoint, suite green after each, **no value/behaviour change**? (Purse was purely
   additive; combat re-routed the loop — higher risk.) Note the riskier ones.
6. **The gated product feature** — the substrate-first payoff deferred behind a gate (the
   purse's ledger/balance-report; combat's undo). Name it; don't design it here.
7. **Leverage score** — how scattered × how load-bearing × how cheap the invariant ÷ risk.

## Deliverable

A single ranked writeup (e.g. `docs/design/systems/substrate-candidates.md`, status
**"audit — evaluated, not started"**, mirroring how combat-actions sat before its build
prompt): the candidates ordered by leverage, each with the seven-point eval above, plus a
one-line **recommendation** (build next / worth it later / not worth it, and why). Where a
candidate clearly merits its own system doc, say so — the highest-ranked one can spawn a
build-prompt in this folder, exactly as `combat-actions-build-prompt.md` did.

## Rules & non-goals

- **Audit only — implement nothing.** No new chokepoints, no logs, no tests. The output is
  a doc.
- **Don't re-litigate the two shipped substrates** (purse journal, combat actions) — they're
  done; they're the *yardstick*, not in scope.
- **Behaviour-preserving lens.** Only flag refactors that can land as additive,
  suite-green, balance-neutral plumbing — call out any candidate that can't.
- **Respect the architecture:** core/render split (D2), ids-not-refs for anything logged,
  and keep the determinism nets (`core`-has-no-`Math.random`) green.

## Definition of done (the audit gate)

- Every hunting-ground suspect is **confirmed or rejected** against the four symptoms, with
  evidence (the grep'd sites).
- Surviving candidates are written up with the **seven-point eval** and ranked by leverage.
- A clear **recommendation** for what (if anything) to build next — and whether it's
  scalar→sum or graph→replay shaped.
- **Nothing is implemented**; the writeup is the deliverable.
