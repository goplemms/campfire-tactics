# Review — "should every authored encounter be reproducible from JSON?"

**Reviews:** `encounters-as-json-kickoff.md`. **Written** 2026-07-30.
**Status: SETTLED — see `## D122`.** Kept as the audit record behind that decision; the numbers and the
method here are what it rests on. Two items shipped with D122: the `extractionIssues` fix (§ "The blocker")
and the whole-repo validator sweep. The validator growth is briefed in
`encounters-as-json-validator-brief.md`.
Every claim below was produced by *running* code against the repo at `f361219`, not by reading it. The
probe harnesses were temporary and have been deleted; the method is described so anyone can re-run it.

**Verdict up front:** the principle is right, but adopt it in **Q4's scoped form** — *player-reachable
encounters are JSON; test fixtures stay TS* — and promise **loadable**, not editable. Two of the kickoff's
four cost arguments do not survive checking, and one thing that isn't in the document at all is a
**load-time blocker** that must be fixed before the first conversion.

---

## What I actually ran

Three probes, all against real source:

1. **The round-trip audit** the kickoff asks for in Q2 but doesn't have — `draftToEncounter(encounterToDraft(e))`
   over *every* authored body in the repo (Hollow Mill + scenarios + the 4 JSON levels), with strict
   deep-equality, a normalized comparison, and per-field diffs.
2. **A typo-surface probe** — 13 single-field corruptions of a minimal valid level, each run through
   `validateLevel`, to measure exactly what the type-safety trade in Q3 costs.
3. **Reference counting** on the consts Q3 names as shared.

---

## Correction 1 — the population is 18, not 19

The kickoff's own breakdown sums to 18: 7 Hollow Mill bodies + 11 scenario encounters
(`DOCTRINE_HARNESS` + **8** `micro.ts` + `PICK_THE_CELL` + `PRISON_ASSAULT_SCENARIO`). The prose labels
that second group "12". `MICRO_SCENARIOS` has exactly 8 entries. Minor, but this is a canon document.

## Q2, answered — 16 of 18 round-trip today; the refusals are *one* milestone, not two

| Result | Count | Bodies |
|---|---|---|
| Round-trips (semantically) | 16 | everything below except ↓ |
| **Refused** | **2** | `TRAP_FIELD`, `OUTER_YARD` |

Both refusals are the **same** cause — traps carrying `damage`/`concealment`. The kickoff's second
refusal (a captive `release.kind` outside `reach`/`lockpick`) is **currently vacuous**: no body in the repo
uses one. So Q2's real answer is *"a data move plus **one** editor feature (trap params),"* not two.

## Correction 2 — the recommended equality guard would fail on 7 healthy bodies

The kickoff's outcome #4 asks for "a **deep-equality check** against the TS const it replaces." Run as
written, that guard reports **7 false failures**, from two purely cosmetic normalizations:

- an omitted `release` becomes the explicit default `{ kind: "reach" }` — `E1_SKIRMISH`,
  `micro-gate-lockpick`, `micro-gate-keyholder`, `micro-gate-destructible`, `micro-key-drop`;
- `captives: []` becomes omitted entirely — `micro-lever-seal`, `micro-gate-remnant`, `micro-gate-reseal`.

Under a normalizing comparison **all 16 are exact**. So the guard is still the right idea, but it needs a
canonicalizer (absent `release` ⇒ `reach`; empty collections ⇒ absent), or the conversion must emit the
canonical form and diff against *that*. Specifying the guard without this is how a real conversion gets
abandoned as "lossy" when it isn't.

## Correction 3 — the de-duplication cost is real *only* in the files Q4 wants to exempt

Q3 claims `hollow-mill.ts` "shares `SELA_MEDIC`, `CAPTIVE_PRISONER`, `CELL_PRISONER_A/B`, `FINALE_EXIT`."
Counted references tell a different story — **every one of them is used exactly once**:

| Const | Uses in an encounter body |
|---|---|
| `SELA_MEDIC` | 1 (a `grants.recruit`) |
| `CAPTIVE_PRISONER` | 1 |
| `CELL_PRISONER_A` / `_B` | 1 each |
| `PIP_COOK` | 1 |
| `FINALE_EXIT` | 1 |
| `MIRA_MERCHANT` | **0** (defined, never placed) |

These are **readability aliases, not shared fragments** — inlining them into JSON duplicates nothing.
The genuine sharing is entirely in `micro.ts`: `STATS` (10 refs), `prisoner` (6), `CELL_WALLS` (5).

That is the whole ballgame for two questions at once: **the de-dup cost falls exclusively on the test
fixtures Q4 proposes to exempt.** Take Q4's line and Q3's second cost goes to zero — no shared-fragment
mechanism, no include system, no decision needed. Q3 and Q4 should be settled together, not separately.

## Q3's *first* cost is real, and the kickoff understates it

Measured against `validateLevel`, of 13 typo classes it catches **2**:

| Caught | Silent |
|---|---|
| enemy `templateId` | captive `spec.jobId` · `spec.primaryJob` · `spec.role` · enemy `role` · enemy `overrides.*` · `reward.materials[].id` · `grants.flag` · `intelDepth` out of range · trap `concealment` as a string |
| objective `kind` | **captive `release.kind`** |

A typo'd `jobId` resolves through `getJob()` to `undefined`, producing a unit with **no job and no skills** —
silently worthless, precisely the third instance of the class that already bit twice in one day.

Note the last row especially: **a bad `release.kind` is fail-loud on editor *import* but silent at
JSON *load*.** The editor is stricter than the pipeline. That inversion should be fixed regardless of what
is decided here — it is a two-line addition to `validateLevel`.

---

## The blocker the kickoff doesn't have: `extractionIssues` reads the wrong position

**Converting `PRISON_ASSAULT` to JSON today would throw at load** — with a false error.

- `buildAuthoredCaptives` (`authored.ts:242`) places a captive at the **placement** `c.pos`; `spec.pos` is
  ignored at staging.
- `extractionIssues` (`levels.ts:54`) measures the walkover distance from **`s.pos`** — the *spec's* pos.
- `member()` (`hollow-mill.ts:52`) hardcodes every spec to `pos: { col: 0, row: 0 }`.
- `FINALE_EXIT[0]` is `{ col: 0, row: 0 }`.

So the finale's prisoners — actually at col 8, eight tiles from the exit — validate as **"starts 0 tile(s)
from the exit … trivializes extraction (D97/D99 walkover)"**. `loadLevels()` throws on any issue, so this
is a hard load failure, not a warning.

Why it has never fired: **all 5 captives across the 4 JSON levels happen to have `spec.pos` identical to
their placement `pos`**, because they were hand-written that way. The guard is accidentally correct for
the current population and wrong for every `member()`-built body.

Two consequences worth stating plainly:

1. This is a **prerequisite**, not a follow-up. The first conversion trips it.
2. The D97/D99 walkover guard has never been exercised against a body where the two positions differ, so
   it protects less than it appears to.

**This is also the strongest argument *for* the kickoff's principle, and the document doesn't make it:**
TS bodies bypass `validateLevel` **entirely** — nothing validates the 18. Moving content to JSON puts it
under a fail-loud gate it currently escapes. The very first thing a conversion audit did was surface a
latent bug in that gate. That is the feature working.

---

## Q1 — the sharpest form of "loadable ≠ editable"

The kickoff is right, and there's a harder version of it: **the encounter that most needs editing is the
one the editor can least edit.** `TRAP_FIELD` *is* its traps — "the threat is the terrain," per its own
docstring. Loading it into an editor that carries trap params invisibly delivers a board with the
encounter's entire design invisible. Same for `OUTER_YARD`.

So the honest split for the 6 live Hollow Mill bodies:

- **4** (`E1_SKIRMISH`, `PRISON_WAGON`, `CUFFED_CELL`, `THIEVES_DEN`) — convert now, genuinely loadable, and
  meaningfully editable *today* (bodies, spawns, walls, gates, objectives, reward are all first-class).
- **2** (`TRAP_FIELD`, `OUTER_YARD`) — blocked on the trap-params milestone. Converting them before that
  buys a board you cannot tune.

`PRISON_ASSAULT` is correctly excluded (checklist F1 deletes it).

---

## What I'd put in the decision record

1. **Principle — adopt Q4's scoped form.** *Every encounter a player can reach is JSON; the `scenarios/`
   harness stays TS.* The exception isn't drift, it's load-bearing: it's the only place real fragment
   sharing exists, and those fixtures live beside the guards that read them. One rule with one
   well-argued exception is cheaper than a shared-fragment mechanism in a data format.
2. **Promise loadable, not editable.** Keep editor milestones out of scope; sequence trap-params as its
   own decision. Scope is then **4 bodies now, 2 after trap-params**.
3. **Fix `extractionIssues` first** (measure from the placement `pos`), with a regression test using a body
   where `spec.pos ≠ pos`. Blocker, not follow-up.
4. **Validation debt, concretely** — `validateLevel` grows: `jobId`/`primaryJob` against `JOBS`,
   `role`/`escort` tags against the tag registry, `release.kind` (closing the editor/loader inversion),
   `reward.materials[].id` and `grants.recruit`/`grants.flag` against their registries, `intelDepth`
   range. The `run-flags.ts` and `playtest.ts` fixes from #216 are the exemplars to copy.
5. **Order — one body end-to-end first: `THIEVES_DEN` or `CUFFED_CELL`.** Both round-trip exactly today
   and carry captives + gates + lockpick releases, so they exercise the interesting machinery without the
   trap blocker. Land it with the *normalized* equality guard against the TS const, kept until the const
   is deleted.
6. **De-dup cost — dismissed, with evidence.** Not "accepted" — it doesn't apply to the converted set.

## Where I disagree with the kickoff

Only on emphasis, not direction. The document frames this as *principle vs. cost* and treats validation
debt as a tax on a convenience feature. The audit inverts that: **validation is the point.** The
authoring win is real but secondary — the durable gain is that content stops living in a place where
nothing checks it. Framed that way, the validation work in item 4 isn't debt budgeted against the move;
it's the deliverable, and the JSON is how you get it.

---

## Re-running any of this

The round-trip audit is ~40 lines: enumerate `hollow-mill` exports structurally (`cols`/`rows`/`enemies`),
`Object.values(SCENARIOS).map(s => s.encounter)`, and `listLevels()`; run each through
`draftToEncounter(encounterToDraft(e))`; compare with sorted-key `JSON.stringify` both raw and canonicalized.
It runs in ~3s under `npx vitest run`. Worth landing as a permanent guard once a conversion starts — it is
the population-expanding version of the `editor-draft.test.ts` property the kickoff correctly flags as
narrow (it iterates `listLevels()`, i.e. exactly the 4 files already in JSON).
