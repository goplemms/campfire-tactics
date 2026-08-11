# Discussion kickoff — should every authored encounter be reproducible from JSON?

**Track:** content pipeline / authoring. **Owner-raised** 2026-07-30, from a concrete friction point.
**Status:** discussion, not agreed work. This prompt exists to *settle the question*, not to implement a
foregone conclusion — end it with a decision record (a `## D##`), and only then a build brief.
**Canon to read first:** **D116** (authored-node injection — the JSON→core pipeline already exists),
**D112/D113** (editor soft play + local persistence), **D98** (the `#editor` scene), **D52** (authored
expeditions), **D114** + `docs/design/implementation/conventions.md`.

> Every code claim below was verified against source on 2026-07-30. **Re-verify anything you build on**,
> and if a claim here is wrong, say so rather than routing around it.

---

## Why this came up (keep the concrete case in view)

The playtest launcher (#216) shipped a target picker listing every `content/levels/` level. Selecting
one boots it correctly — but **the editor board does not change**, because the board renders the
*draft* and the target is a separate thing. The owner's reaction was the right one: *"that is actually
a feature I was thinking would be helpful"* — being able to pick an encounter and **see it, edit it,
relaunch it**.

That exposed the real gap. There is **no way to load a shipped encounter into the editor** except
pasting its JSON into the Import box — and for the ~19 encounters that are **TS consts**, there is no
JSON to paste at all. The owner's framing:

> *"At the end of the day, all encounters should be reproducible from a JSON."*

This prompt is about whether that principle is right, what it costs, and where it stops.

---

## Verified state — where encounters actually live today

**JSON (4)** — `src/content/levels/*.json`: `prison-break`, `sample-skirmish`, `the-rescue`,
`the-side-door`.

**TypeScript consts (19)**:
- **The Hollow Mill arc (7)** — `hollow-mill.ts`: `E1_SKIRMISH`, `TRAP_FIELD`, `PRISON_WAGON`,
  `OUTER_YARD`, `CUFFED_CELL`, `THIEVES_DEN`, `PRISON_ASSAULT`.
  ⚠️ `PRISON_ASSAULT` is already slated for replacement by The Rescue (checklist **F1**) — do not spend
  effort converting a body that is being deleted.
- **The scenario harness (12)** — `scenarios/`: `DOCTRINE_HARNESS`, eight `micro.ts` gate/lever
  encounters, `PICK_THE_CELL_ENCOUNTER`, `PRISON_ASSAULT_SCENARIO_ENCOUNTER`.

**The pipeline already exists and is proven.** D116 built content JSON → `injectContentNodes()` → the
core catalog, fail-loud, and The Rescue's finale already rides it (its *body* is JSON while its *map*
is TS). So this is a question about **population and coverage**, not about building a mechanism.

---

## The four questions worth actually settling

### Q1 — Does "reproducible from JSON" mean *loadable*, or *editable*? They are not the same thing.

This is the crux, and it is easy to conflate.

`encounterToDraft` / `draftToEncounter` are a **proven inverse pair** — but lossless **by carrying**,
not by modeling. Fields the editor cannot *edit* still survive: per-entity extras (an enemy's
`id`/`role`/`overrides`/`hidden`, a captive's full `spec`) ride on the draft entity, and un-modeled
top-level scalars (`reward`, `objectives`, `rumors`, `intelDepth`, `grants`) ride in the
`EditorDraft._passthrough` bag.

**So converting an encounter to JSON makes it loadable and round-trippable; it does NOT make it
editable.** You could load `TRAP_FIELD`, see its board, and find its traps un-editable — carried
invisibly in a passthrough bag. If the owner's goal is *"pick it, see it, tune it"*, JSON is necessary
but **not sufficient**, and the editor-milestone work is the larger half. Settle which goal is meant.

### Q2 — What does the round-trip genuinely refuse today?

`encounterToDraft` is **fail-loud** (correctly) on exactly two shapes:

- a **trap** carrying `id`/`damage`/`concealment` — *"trap params aren't editable yet"*;
- a **captive** whose `release.kind` is not `reach`/`lockpick`.

So any TS encounter using those cannot round-trip until those editor milestones land. `TRAP_FIELD` is
the obvious suspect. **Audit all 19 against these two refusals before promising anything** — the answer
determines whether this is a data move or a data move *plus* two editor features.

### Q3 — What do we lose by leaving TypeScript? (the honest counter-argument)

TS encounters are **compile-checked**. `jobId: JobId` is `keyof typeof JOBS`, so a typo is a **build
error**. In JSON it is a runtime string, and the repo has been bitten by exactly this class **twice in
one day**:

- the untyped `run.flags` bag, where a misspelled flag silently drops a gated spawn zone (fixed by
  `run-flags.ts` in #216);
- `EQUIPMENT` ids, where `equipmentDelta` skips an unknown id, so a misspelled item is **silently
  worthless** (now refused at load in `playtest.ts`).

`validateLevel` covers a lot — id/name/dims/spawns, **unknown enemy `templateId`**, objective kinds,
reward, extraction, duplicate ids, spawn zones — but it is a hand-written list, and every field moved
from TS to JSON must be **added to it explicitly** or it becomes a silent-typo surface. Budget that as
part of the work, not as a follow-up.

Second cost: **TS de-duplicates, JSON does not.** `hollow-mill.ts` shares `SELA_MEDIC`,
`CAPTIVE_PRISONER`, `CELL_PRISONER_A/B`, `FINALE_EXIT`; `micro.ts` shares `STATS`, `prisoner`,
`CELL_WALLS`. In JSON these get inlined into each file, so an edit that was one line becomes several,
and they can drift. Decide whether that is acceptable or whether some shared-fragment mechanism is
wanted (**caution:** that is how a data format grows an include system — probably a reason to accept
the duplication instead).

### Q4 — Should the scenario harness convert at all?

The 12 `scenarios/` encounters are **test fixtures**, not content: they exist to pin gate/lever/doctrine
mechanics and they live beside the guards that read them. Making them JSON adds indirection to a test
for no authoring benefit, and they are not things a designer tunes by feel.

**A defensible line: "every encounter a PLAYER can reach is JSON; test fixtures stay in TS."** That
would scope the work to the Hollow Mill's 6 live bodies rather than 19. The counter-argument is that a
single rule is easier to hold than a rule with an exception. Settle it explicitly rather than by drift.

---

## The guard that matters, and why it is not as strong as it looks

`editor-draft.test.ts` asserts *"every content level round-trips structurally"* — it iterates
`listLevels()`, which is **exactly the 4 JSON levels**. So the property is real but its **population is
precisely the set already in JSON**; it says nothing about the 19 TS bodies.

Converting expands that population under a guard **that has already been caught dropping fields**:
`d1a3d83` — *"Fix editor round-trip dropping `dropOnDeath` and `controlRoom`"*. Silent field loss on a
round-trip is the live failure mode of this whole idea. Any conversion must land with the round-trip
assertion extended to the converted body, and ideally a **deep-equality check against the TS const it
replaces**, kept until the const is deleted.

---

## What a good outcome looks like

Not "convert everything." A decision record answering:

1. **The principle** — is "player-reachable encounters are JSON" the rule? What is explicitly exempt?
2. **Loadable vs editable** — which is being promised, and if editable, which editor milestones are
   thereby in scope.
3. **The validation debt** — what `validateLevel` must grow to keep the type-safety we are trading away.
4. **The order** — almost certainly one encounter first, end-to-end, with the equality guard against its
   TS original, before any bulk move.
5. **The de-dup cost** — accepted, or mitigated.

---

## Out of scope for this discussion

Arc promotion (**F1**/#210) · the finale's reference party · balance tuning · `BoardCamera` ·
in-UI kit authoring · the "Load into editor" button itself (**it is small and useful, and it does not
need this discussion to land — it works on the 4 JSON levels today**; do not let it block on the
principle).

## Working agreement

- **Discuss first, decide, then brief.** This ends in a `## D##`, not a PR.
- **Verify before asserting.** This track has been bitten repeatedly by plausible-but-false claims about
  shipped machinery; three of the four sections above exist because a claim did not survive checking.
- **Disagree in the report.** If "everything as JSON" is the wrong principle, say so — the counter-case
  in Q3/Q4 is deliberately argued, not decoration.
